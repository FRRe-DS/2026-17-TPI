// Lo que va a los logs: qué secretos se ocultan, cómo se guarda un error, la línea de cada solicitud y las opciones del
// logger de Fastify (plan, Lógicas 10 y 11). No importa nada del servicio salvo el tipo de la configuración.
import type { FastifyBaseLogger, FastifyLoggerOptions, FastifyReply, FastifyRequest, FastifyServerOptions } from 'fastify';
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
// no `detail` ni `where`, que traen datos de la fila; de uno de datos (SQLSTATE 22…), tampoco el mensaje.
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

// Lo que se guarda en vez del mensaje de un error de datos de la base: los de la clase 22 de SQLSTATE (data_exception) citan
// el valor que rechazaron, por ejemplo `date/time field value out of range: "0000-01-01"` (spec 004, RNF-19). Quedan el
// código y la pila para diagnosticarlo.
const MENSAJE_OMITIDO = 'Error de datos de la base: mensaje omitido';
const esErrorDeDatos = (code: unknown) => typeof code === 'string' && code.startsWith('22');

// La pila sin su encabezado, que repite el mensaje (puede tener varias líneas): desde la primera línea `at …`. Sin ninguna,
// `undefined`.
function soloLaPila(traza: string): string | undefined {
  const lineas = traza.split('\n');
  const primera = lineas.findIndex((linea) => /^\s+at /.test(linea));
  return primera === -1 ? undefined : lineas.slice(primera).join('\n');
}

function serializar(valor: unknown, limpiar: (texto: string) => string, nivel: number): ErrorRegistrado {
  const error = valor as Record<string, unknown> | null;
  if (typeof error !== 'object' || error === null || typeof error.message !== 'string') {
    const tipo = valor === null ? 'null' : typeof valor;
    return { tipo, mensaje: limpiar(typeof valor === 'string' ? valor : inspect(valor, { depth: 3 })) };
  }

  const constructor: unknown = error.constructor;
  const deDatos = esErrorDeDatos(error.code);
  const registrado: ErrorRegistrado = {
    tipo: limpiar(typeof constructor === 'function' ? constructor.name : String(error.name)),
    mensaje: deDatos ? MENSAJE_OMITIDO : limpiar(error.message),
  };
  if (typeof error.code === 'string' || typeof error.code === 'number') registrado.codigo = limpiar(String(error.code));
  const traza = typeof error.stack === 'string' ? (deDatos ? soloLaPila(error.stack) : error.stack) : undefined;
  if (traza !== undefined) registrado.traza = limpiar(traza);
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

// Registra la causa de un 503 por la base o por otro módulo (RNF-14.8): una línea de error con el id de correlación de `log`,
// el `detail` como texto y el error con su `cause`, sin los secretos fijos ni los de la solicitud (RNF-19.1).
export function registrarNoDisponible(
  log: FastifyBaseLogger,
  error: Error,
  secretosDeLaSolicitud: readonly string[],
): void {
  log.error({ err: new ErrorConSecretos(error, secretosDeLaSolicitud) }, error.message);
}

// El campo con el id de correlación en cada línea del log. En las de una solicitud lo pone `request.log`
// (requestIdLogLabel de Fastify).
export const CAMPO_ID_CORRELACION = 'idCorrelacion';

const SOLICITUD_TERMINADA = 'Solicitud terminada';

// La ruta de una línea de solicitud: la plantilla de la operación que la atendió (`/api/v1/clientes/:clienteId/calificaciones/:calificacionId`)
// y no la URL pedida, porque los valores de la URL son identificadores de clientes, calificaciones, direcciones y bloqueos que
// no van al log (RNF-19). Si ninguna operación la atendió (ruta inexistente, URL ilegible), la URL sin query string, como siempre.
function rutaDe(request: FastifyRequest): string {
  const plantilla = request.is404 ? undefined : request.routeOptions?.url;
  return plantilla ?? request.url.split('?', 1)[0] ?? '';
}

// Registra la línea de una solicitud que terminó (RNF-14.6): el método, la ruta sin query string, el código de la respuesta y
// cuánto tardó, en milisegundos desde que Fastify la recibió. `duracionMs` se pasa para lo que Fastify responde antes de
// entrar a una ruta, donde su reloj no arranca y `reply.elapsedTime` da 0 (Lógica 9). El id de correlación lo pone
// `request.log`. Es una lista cerrada de campos, como la del error: ni encabezados ni cuerpos ni la query string, que puede
// traer datos personales (RNF-19.2).
export function registrarSolicitud(request: FastifyRequest, reply: FastifyReply, duracionMs = reply.elapsedTime): void {
  request.log.info(
    { metodo: request.method, ruta: rutaDe(request), estado: reply.statusCode, duracionMs },
    SOLICITUD_TERMINADA,
  );
}

const SOLICITUD_CORTADA = 'Solicitud cortada por la parada';

// La línea de una solicitud que la parada cortó sin responderla (Lógica 13): los campos de la de una solicitud que terminó,
// salvo el código, porque no salió ninguno. Va como advertencia: el cliente se quedó sin respuesta.
export function registrarSolicitudCortada(request: FastifyRequest, reply: FastifyReply): void {
  request.log.warn(
    { metodo: request.method, ruta: rutaDe(request), duracionMs: reply.elapsedTime },
    SOLICITUD_CORTADA,
  );
}

// La línea de una solicitud que no se pudo leer como HTTP (Lógica 9): sin el método ni la ruta, que no se llegaron a leer, y
// con el id de correlación que se generó para la respuesta. `log` es el de la app, que no lleva ningún id.
export function registrarSolicitudIlegible(
  log: FastifyBaseLogger,
  idCorrelacion: string,
  estado: number,
  duracionMs: number,
): void {
  log.info({ [CAMPO_ID_CORRELACION]: idCorrelacion, estado, duracionMs }, SOLICITUD_TERMINADA);
}

// Fastify tipa el serializador de `err` con la forma de pino (type, message, stack); el nuestro devuelve ErrorRegistrado.
type SerializadorDeErr = NonNullable<NonNullable<FastifyLoggerOptions['serializers']>['err']>;
// Las opciones de pino que Fastify acepta en `logger`: Fastify no exporta su tipo con un nombre.
type OpcionesDePino = Exclude<FastifyServerOptions['logger'], boolean | undefined>;
type LogMethod = NonNullable<NonNullable<OpcionesDePino['hooks']>['logMethod']>;

// El texto de una línea que registra un error sin texto.
const TEXTO_DE_UN_ERROR = 'Error';

// Si el primer argumento de una llamada al log es un error, o un objeto con un error bajo `err` y sin `msg`. Sin un texto,
// pino copia en `msg` el mensaje de ese error tal cual: `msg` no pasa por el serializador de `err`.
function llevaError(valor: unknown): boolean {
  if (valor instanceof Error) return true;
  if (typeof valor !== 'object' || valor === null) return false;
  const { err, msg } = valor as { err?: unknown; msg?: unknown };
  return Boolean(err) && msg === undefined;
}

// Las opciones del logger de Fastify: JSON, una línea por evento, a `flujoLog` o a la salida estándar si no se pasa uno
// (RNF-14.5). Todo lo que se registre bajo `err`, venga de donde venga, pasa por serializarError con los secretos fijos.
// Antes de armar cada línea, un error sin texto recibe TEXTO_DE_UN_ERROR, y cada texto de la llamada pasa por
// limpiarSecretos con los secretos fijos (RNF-19.1). Lo que va dentro de un objeto no es un texto de la llamada: el error lo
// limpia su serializador, y lo demás se registra como llega.
export function opcionesLogger(secretosFijos: readonly string[], flujoLog?: Writable) {
  const serializadorDeErr = (valor: unknown) =>
    valor instanceof ErrorConSecretos
      ? serializarError(valor.error, [...secretosFijos, ...valor.secretos])
      : serializarError(valor, secretosFijos);
  const logMethod: LogMethod = function (args, metodo) {
    const [primero, segundo, ...resto] = args as unknown[];
    const completos: unknown[] = llevaError(primero) && segundo === undefined ? [primero, TEXTO_DE_UN_ERROR, ...resto] : args;
    const limpios = completos.map((arg) => (typeof arg === 'string' ? limpiarSecretos(arg, secretosFijos) : arg));
    Reflect.apply(metodo, this, limpios);
  };
  return {
    level: 'info',
    stream: flujoLog,
    serializers: { err: serializadorDeErr as unknown as SerializadorDeErr },
    hooks: { logMethod },
  };
}
