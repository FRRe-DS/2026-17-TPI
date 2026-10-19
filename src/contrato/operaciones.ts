import type { FastifyInstance, HTTPMethods, RouteHandlerMethod } from 'fastify';
import { METHODS } from 'node:http';
import { MetodoNoPermitido } from '../errores.js';
import type { Contrato } from './cargar.js';
import { ID_CONTRATO } from './validacion.js';

// Un manejador es un manejador de ruta de Fastify, anotado con su operationId en src/operaciones/index.ts.
export type Manejador = RouteHandlerMethod;
export type Manejadores = Readonly<Record<string, Manejador>>;

// publica: la operación no exige token. roles: los que admite; con la lista vacía, cualquiera de los conocidos (RNF-12.3).
export type Permisos = { publica: boolean; roles: string[] };

declare module 'fastify' {
  interface FastifyContextConfig {
    permisos?: Permisos;
  }
}

// Una operación del contrato. Sin operationId no puede tener manejador (se buscan por ese nombre), así que queda pendiente.
export type Operacion = { operationId?: string; metodo: string; ruta: string };

export type OperacionesDelContrato = {
  implementadas: (Operacion & { operationId: string })[];
  pendientes: Operacion[];
};

// Los métodos de un Path Item de OpenAPI 3.1. Las demás claves de una ruta (parameters, summary, servers, $ref, x-…) no
// son operaciones.
const METODOS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

const esObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === 'object' && valor !== null && !Array.isArray(valor);

// Reparte las operaciones de paths, en el orden del contrato, según tengan o no manejador (RNF-03.4). Las pendientes no
// hacen fallar la prueba de contrato (RNF-07.2). La ruta queda como está en el contrato, con {param}.
export function listarOperaciones(contrato: Contrato, manejadores: Readonly<Record<string, unknown>>): OperacionesDelContrato {
  const listas: OperacionesDelContrato = { implementadas: [], pendientes: [] };
  if (!esObjeto(contrato.paths)) return listas;

  for (const [ruta, item] of Object.entries(contrato.paths)) {
    if (!esObjeto(item)) continue;
    for (const [clave, operacion] of Object.entries(item)) {
      if (!METODOS.has(clave) || !esObjeto(operacion)) continue;
      const metodo = clave.toUpperCase();
      const { operationId } = operacion;
      if (typeof operationId !== 'string') listas.pendientes.push({ metodo, ruta });
      // hasOwn y no `in`: un operationId como toString no tiene que encontrar el de Object.prototype.
      else if (Object.hasOwn(manejadores, operationId)) listas.implementadas.push({ operationId, metodo, ruta });
      else listas.pendientes.push({ operationId, metodo, ruta });
    }
  }
  return listas;
}

type Camino = string[];
type Parte = 'params' | 'querystring' | 'headers';
type Parametro = { parte: Parte; nombre: string; requerido: boolean; esquema: object };

const PARTES = new Map<unknown, Parte>([
  ['path', 'params'],
  ['query', 'querystring'],
  ['header', 'headers'],
]);

// OpenAPI manda ignorar estos encabezados como parámetros: los resuelven HTTP y la seguridad.
const ENCABEZADOS_IGNORADOS = new Set(['accept', 'content-type', 'authorization']);

// Un segmento de JSON Pointer dentro de un $ref: ~0 por ~ y ~1 por /, y como va en el fragmento de una URI, lo demás
// codificado ({ y } quedan %7B y %7D). Al leer, al revés y en ese orden: ~1 antes que ~0.
const escapar = (segmento: string) => encodeURIComponent(segmento.replaceAll('~', '~0').replaceAll('/', '~1'));
const desescapar = (segmento: string) => decodeURIComponent(segmento).replaceAll('~1', '/').replaceAll('~0', '~');

// El camino como fragmento de un $ref (#/paths/~1x/get), que también nombra en un error dónde está el problema.
const puntero = (camino: Camino) => `#/${camino.map(escapar).join('/')}`;

// Los esquemas de la ruta apuntan al contrato, que Ajv tiene cargado con ID_CONTRATO (Lógica 7).
const refAlContrato = (camino: Camino) => ({ $ref: `${ID_CONTRATO}${puntero(camino)}` });

function valorEn(contrato: Contrato, camino: Camino): unknown {
  let actual: unknown = contrato;
  for (const segmento of camino) {
    if (typeof actual !== 'object' || actual === null || !Object.hasOwn(actual, segmento)) return undefined;
    actual = (actual as Record<string, unknown>)[segmento];
  }
  return actual;
}

// Sigue los $ref internos (#/…) hasta lo que describen, y devuelve eso y su camino dentro del contrato.
function resolver(contrato: Contrato, valor: unknown, camino: Camino): { valor: unknown; camino: Camino } {
  const vistos = new Set<string>();
  while (esObjeto(valor) && typeof valor.$ref === 'string') {
    const ref = valor.$ref;
    if (!ref.startsWith('#/')) throw new Error(`el $ref ${ref} no apunta adentro del contrato`);
    if (vistos.has(ref)) throw new Error(`el $ref ${ref} es circular`);
    vistos.add(ref);
    camino = ref.slice(2).split('/').map(desescapar);
    valor = valorEn(contrato, camino);
    if (valor === undefined) throw new Error(`el $ref ${ref} no lleva a nada`);
  }
  return { valor, camino };
}

// {param} pasa a :param, la sintaxis de Fastify. Su enrutador corta el nombre de un parámetro en '-' o '.', así que solo
// se admiten letras, dígitos y _.
function rutaDeFastify(ruta: string): string {
  return ruta.replace(/\{([^}]*)\}/g, (_, nombre: string) => {
    if (!/^\w+$/.test(nombre)) throw new Error(`el parámetro de ruta {${nombre}} solo puede tener letras, dígitos y _`);
    return `:${nombre}`;
  });
}

// Un parámetro del contrato, listo para el esquema de su parte. Con un compilador propio, Fastify no pasa a minúscula los
// encabezados del esquema, y Node los entrega en minúscula. Ajv no aplica un default que queda detrás de un $ref, así que
// se copia al lado.
function parametroDe(contrato: Contrato, original: unknown, caminoOriginal: Camino): Parametro {
  const { valor: parametro, camino } = resolver(contrato, original, caminoOriginal);
  if (!esObjeto(parametro) || typeof parametro.name !== 'string') {
    throw new Error(`el parámetro ${puntero(caminoOriginal)} no tiene nombre`);
  }
  const parte = PARTES.get(parametro.in);
  if (parte === undefined) {
    throw new Error(`el parámetro ${parametro.name} está en ${String(parametro.in)}, y solo se admiten path, query y header`);
  }
  if (parametro.schema === undefined) throw new Error(`el parámetro ${parametro.name} no tiene schema`);

  const caminoEsquema = [...camino, 'schema'];
  const { valor: esquema } = resolver(contrato, parametro.schema, caminoEsquema);
  const ref = refAlContrato(caminoEsquema);
  return {
    parte,
    nombre: parte === 'headers' ? parametro.name.toLowerCase() : parametro.name,
    requerido: parametro.required === true,
    esquema: esObjeto(esquema) && esquema.default !== undefined ? { ...ref, default: esquema.default } : ref,
  };
}

// Los esquemas de params, querystring y headers. Un parámetro de la operación reemplaza al de la ruta con el mismo nombre
// y lugar. El encabezado de correlación queda afuera: si no es válido, se reemplaza en vez de dar 400 (RNF-14.3).
function esquemasDeParametros(contrato: Contrato, camino: Camino, encabezadoCorrelacion: string) {
  const parametros = new Map<string, Parametro>();
  for (const caminoLista of [[...camino.slice(0, 2), 'parameters'], [...camino, 'parameters']]) {
    const lista = valorEn(contrato, caminoLista);
    if (!Array.isArray(lista)) continue;
    lista.forEach((original, i) => {
      const parametro = parametroDe(contrato, original, [...caminoLista, String(i)]);
      parametros.set(`${parametro.parte} ${parametro.nombre}`, parametro);
    });
  }

  const ignorados = new Set([...ENCABEZADOS_IGNORADOS, encabezadoCorrelacion.toLowerCase()]);
  const partes: Partial<Record<Parte, { type: 'object'; properties: Record<string, object>; required: string[] }>> = {};
  for (const { parte, nombre, requerido, esquema } of parametros.values()) {
    if (parte === 'headers' && ignorados.has(nombre)) continue;
    const destino = (partes[parte] ??= { type: 'object', properties: {}, required: [] });
    destino.properties[nombre] = esquema;
    if (requerido) destino.required.push(nombre);
  }
  return partes;
}

// Solo application/json: el servicio no acepta otro tipo de cuerpo. Fastify valida como null un cuerpo que no llegó, así
// que, si el contrato no lo exige (required: true), null también vale.
function esquemaDelCuerpo(contrato: Contrato, camino: Camino): object | undefined {
  const original = valorEn(contrato, [...camino, 'requestBody']);
  if (original === undefined) return undefined;
  const { valor: cuerpo, camino: caminoCuerpo } = resolver(contrato, original, [...camino, 'requestBody']);
  const contenido = esObjeto(cuerpo) && esObjeto(cuerpo.content) ? cuerpo.content['application/json'] : undefined;
  if (!esObjeto(cuerpo) || !esObjeto(contenido) || contenido.schema === undefined) {
    throw new Error('el cuerpo no tiene un esquema application/json, el único tipo de cuerpo que acepta el servicio');
  }
  const esquema = refAlContrato([...caminoCuerpo, 'content', 'application/json', 'schema']);
  return cuerpo.required === true ? esquema : { if: { type: 'null' }, then: true, else: esquema };
}

// Una alternativa de security: por cada esquema, la lista de roles que pide.
type Alternativa = Record<string, string[]>;
const esAlternativa = (valor: unknown): valor is Alternativa =>
  esObjeto(valor) &&
  Object.values(valor).every((roles) => Array.isArray(roles) && roles.every((rol) => typeof rol === 'string'));

// security: [] la hace pública (RNF-12.1), y sin security en la operación vale la global. Cada elemento es una
// alternativa: una vacía ({}) no pide nada, y una sin roles admite cualquier rol conocido (RNF-12.3). Sin security en
// ningún lado, exige token con cualquier rol, porque RNF-12.1 pide token salvo en las que el contrato declara públicas.
// Una security con otra forma hace fallar el registro: adivinar qué quiso decir podría abrir la operación de más.
function permisosDe(contrato: Contrato, camino: Camino): Permisos {
  const seguridad = valorEn(contrato, [...camino, 'security']) ?? contrato.security;
  if (seguridad === undefined) return { publica: false, roles: [] };
  if (!Array.isArray(seguridad) || !seguridad.every(esAlternativa)) {
    throw new Error('la security no es una lista de alternativas, cada una con una lista de roles (textos) por esquema');
  }
  if (seguridad.length === 0 || seguridad.some((alternativa) => Object.keys(alternativa).length === 0)) {
    return { publica: true, roles: [] };
  }
  const listas = seguridad.flatMap((alternativa) => Object.values(alternativa));
  if (listas.some((roles) => roles.length === 0)) return { publica: false, roles: [] };
  return { publica: false, roles: [...new Set(listas.flat())] };
}

// Registra en Fastify cada operación del contrato que tiene manejador, con los esquemas del contrato para validar y los
// permisos de su security (RNF-03.4, ADR de la base). Las demás no se registran: dan 404 o 405 y quedan pendientes.
export function registrarOperaciones(
  app: FastifyInstance,
  contrato: Contrato,
  manejadores: Manejadores,
  encabezadoCorrelacion: string,
): OperacionesDelContrato {
  const operaciones = listarOperaciones(contrato, manejadores);
  for (const { operationId, metodo, ruta } of operaciones.implementadas) {
    const camino = ['paths', ruta, metodo.toLowerCase()];
    try {
      const cuerpo = esquemaDelCuerpo(contrato, camino);
      app.route({
        method: metodo as HTTPMethods,
        url: rutaDeFastify(ruta),
        schema: { ...esquemasDeParametros(contrato, camino, encabezadoCorrelacion), ...(cuerpo && { body: cuerpo }) },
        config: { permisos: permisosDe(contrato, camino) },
        handler: manejadores[operationId],
      });
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error);
      throw new Error(`No se pudo registrar la operación ${operationId} (${metodo} ${ruta}): ${motivo}`, { cause: error });
    }
  }
  return operaciones;
}

// Lógica 8 (RNF-03.2). Suma a Fastify los métodos de Node que no trae, salvo CONNECT (Node lo atiende aparte y, sin un
// oyente de connect, cierra la conexión), y anota los métodos de cada ruta que se registre desde ahora. La función que
// devuelve, llamada al terminar de registrar, le suma a cada ruta una comodín con los métodos que le faltan, que responde
// 405 con Allow en su onRequest, antes de leer el cuerpo. Una ruta registrada después queda sin 405, y si tiene la URL de
// otra, choca con su comodín.
export function prepararRutas405(app: FastifyInstance): () => void {
  for (const metodo of METHODS) {
    if (metodo !== 'CONNECT' && !app.supportedMethods.includes(metodo)) app.addHttpMethod(metodo);
  }
  const metodosPorRuta = new Map<string, Set<string>>();
  let comodinesRegistradas = false;
  app.addHook('onRoute', ({ url, method }) => {
    // Las comodines no se anotan: sus métodos no son los de la ruta.
    if (comodinesRegistradas) return;
    const metodos = metodosPorRuta.get(url) ?? new Set<string>();
    for (const metodo of [method].flat()) metodos.add(metodo);
    metodosPorRuta.set(url, metodos);
  });

  return () => {
    comodinesRegistradas = true;
    for (const [url, metodos] of metodosPorRuta) {
      const permitidos = [...metodos].sort();
      const responder405 = async () => {
        throw new MetodoNoPermitido(permitidos);
      };
      // Fastify exige un manejador. No llega a correr, porque el onRequest responde antes; si corriera, respondería lo mismo.
      app.route({
        method: app.supportedMethods.filter((metodo) => !metodos.has(metodo)) as HTTPMethods[],
        url,
        onRequest: responder405,
        handler: responder405,
      });
    }
  };
}
