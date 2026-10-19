// Lo que va a los logs: qué secretos se ocultan, cómo se guarda un error y las opciones del logger de Fastify (plan,
// Lógica 10). No importa nada del servicio salvo el tipo de la configuración.
import type { FastifyBaseLogger, FastifyLoggerOptions } from 'fastify';
import type { Writable } from 'node:stream';
import { inspect } from 'node:util';
import type { Config } from './config.js';

// Lo que reemplaza a un secreto en cualquier texto que llegue al log (RNF-19.1).
export const OCULTO = '[oculto]';

const escaparPatron = (texto: string) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Reemplaza por OCULTO cada aparición de un secreto en `texto`. Un secreto vacío se ignora (ocultaría todo el texto). Va
// primero el más largo, para que si un secreto contiene a otro se oculte entero, y en una sola pasada, para que el reemplazo
// no se vuelva a leer.
export function limpiarSecretos(texto: string, secretos: readonly string[]): string {
  const buscados = secretos.filter((secreto) => secreto !== '').sort((a, b) => b.length - a.length);
  if (buscados.length === 0) return texto;
  return texto.replace(new RegExp(buscados.map(escaparPatron).join('|'), 'g'), OCULTO);
}

function decodificar(texto: string): string {
  try {
    return decodeURIComponent(texto);
  } catch {
    return texto;
  }
}

// Los secretos que se conocen al arrancar: la clave de los tokens y la contraseña de la base, sacada de su URL (de donde
// va el usuario, o de la query string), como está escrita y decodificada. El usuario no se oculta: un nombre corto como m2
// desfiguraría los mensajes, y el plan pide la contraseña.
export function secretosDeConfig({ claveTokens, urlBd }: Pick<Config, 'claveTokens' | 'urlBd'>): string[] {
  const secretos = new Set([claveTokens]);
  if (URL.canParse(urlBd)) {
    const url = new URL(urlBd);
    for (const contrasena of [url.password, /[?&]password=([^&]*)/.exec(url.search)?.[1] ?? '']) {
      if (contrasena === '') continue;
      secretos.add(contrasena);
      secretos.add(decodificar(contrasena));
    }
  }
  return [...secretos];
}

// Los secretos de una solicitud: el encabezado Authorization entero y, si tiene esquema (Bearer, Basic…), cada palabra que
// le sigue, que es el token.
export function secretosDeAutorizacion(valor: string | undefined): string[] {
  if (valor === undefined || valor.trim() === '') return [];
  return [valor, ...valor.trim().split(/\s+/).slice(1)];
}

// Lo que el log guarda de un error. Es una lista cerrada de campos, no el error entero: sus demás propiedades pueden traer
// encabezados, la configuración o datos de una fila. De un error de pg guarda la tabla, la columna y la restricción, pero
// no `detail` ni `where`, que traen datos de la fila.
export type ErrorRegistrado = {
  tipo: string;
  codigo?: string;
  mensaje: string;
  traza?: string;
  tabla?: string;
  columna?: string;
  restriccion?: string;
  causa?: ErrorRegistrado;
};

const CAMPOS_DE_PG = [
  ['table', 'tabla'],
  ['column', 'columna'],
  ['constraint', 'restriccion'],
] as const;

// Cuántos errores de la cadena de `cause` se guardan, contado el primero: corta también una cadena que se cierra en círculo.
const NIVELES = 5;

function serializar(valor: unknown, limpiar: (texto: string) => string, nivel: number): ErrorRegistrado {
  const error = valor as Record<string, unknown> | null;
  if (typeof error !== 'object' || error === null || typeof error.message !== 'string') {
    const tipo = valor === null ? 'null' : typeof valor;
    return { tipo, mensaje: limpiar(typeof valor === 'string' ? valor : inspect(valor, { depth: 3 })) };
  }

  const constructor: unknown = error.constructor;
  const registrado: ErrorRegistrado = {
    tipo: limpiar(typeof constructor === 'function' ? constructor.name : String(error.name)),
    mensaje: limpiar(error.message),
  };
  if (typeof error.code === 'string' || typeof error.code === 'number') registrado.codigo = limpiar(String(error.code));
  if (typeof error.stack === 'string') registrado.traza = limpiar(error.stack);
  for (const [campo, destino] of CAMPOS_DE_PG) {
    const dato = error[campo];
    if (typeof dato === 'string') registrado[destino] = limpiar(dato);
  }
  if (error.cause !== undefined && error.cause !== null && nivel < NIVELES) {
    registrado.causa = serializar(error.cause, limpiar, nivel + 1);
  }
  return registrado;
}

// Guarda `error` como lo describe ErrorRegistrado, con los secretos ocultos en cada texto. Nunca lanza: un error que no se
// puede leer deja un registro mínimo, porque se llama desde el manejador de errores y ahí una excepción borraría la respuesta.
export function serializarError(error: unknown, secretos: readonly string[]): ErrorRegistrado {
  try {
    return serializar(error, (texto) => limpiarSecretos(texto, secretos), 1);
  } catch {
    return { tipo: 'desconocido', mensaje: 'El error no se pudo serializar' };
  }
}

// Un error junto con los secretos que solo se conocen en la solicitud (el token). Es lo que recibe el serializador del
// logger; así el manejador de errores y los demás errores que se registren pasan por el mismo camino.
class ErrorConSecretos {
  readonly error: unknown;
  readonly secretos: readonly string[];

  constructor(error: unknown, secretos: readonly string[]) {
    this.error = error;
    this.secretos = secretos;
  }
}

// Registra un error no previsto con el id de correlación de `log` (RNF-03.3), sin los secretos fijos ni los de la solicitud.
export function registrarErrorInterno(log: FastifyBaseLogger, error: unknown, secretosDeLaSolicitud: readonly string[]): void {
  log.error({ err: new ErrorConSecretos(error, secretosDeLaSolicitud) }, 'Error interno');
}

// Fastify tipa el serializador de `err` con la forma de pino (type, message, stack); el nuestro devuelve ErrorRegistrado.
type SerializadorDeErr = NonNullable<NonNullable<FastifyLoggerOptions['serializers']>['err']>;

// Las opciones del logger de Fastify: JSON, una línea por evento, a `flujoLog` o a la salida estándar si no se pasa uno
// (RNF-14.5). Todo lo que se registre bajo `err`, venga de donde venga, pasa por serializarError con los secretos fijos.
export function opcionesLogger(secretosFijos: readonly string[], flujoLog?: Writable) {
  const serializadorDeErr = (valor: unknown) =>
    valor instanceof ErrorConSecretos
      ? serializarError(valor.error, [...secretosFijos, ...valor.secretos])
      : serializarError(valor, secretosFijos);
  return {
    level: 'info',
    stream: flujoLog,
    serializers: { err: serializadorDeErr as unknown as SerializadorDeErr },
  };
}
