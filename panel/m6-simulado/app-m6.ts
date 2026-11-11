import Fastify, { LogController, type FastifyInstance, type FastifyReply } from 'fastify';
import { jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import { setTimeout as esperar } from 'node:timers/promises';
import type { ConfigM6 } from '../servidor/config.js';
import { errorM6, ESTADOS_DE_VIAJE, pagina, PROBLEMAS, resumen, type CodigoDeProblema, type EstadoDeViaje } from './cuerpos.js';
import type { EstadoM6 } from './estado.js';

// La API del M6 simulado: las dos consultas de `contrato/dependencias/m6.yml` que usa M2 (`listTrips` y `getTrip`), en el mismo
// puerto y las mismas rutas que el M6 del Grupo 12 (`/trips`, sin prefijo), así M2 lo llama con su `M2_URL_M6` (RNF-13.7).
// De ese contrato deja afuera lo que M2 no usa: los filtros `from` y `to`, el GET condicional (`ETag`, `If-None-Match`, `304`)
// y el límite de pedidos (`RateLimit-*`, `429`). El rol y el encabezado de correlación son los que M2 manda hoy (ADR 096).

export type OpcionesAppM6 = { config: ConfigM6; estado: EstadoM6; flujoLog?: Writable };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_VALIDO = /^[A-Za-z0-9._-]{1,128}$/;
// Los mismos 30 segundos de tolerancia de reloj que M2 (RNF-12.2).
const TOLERANCIA_RELOJ_SEGUNDOS = 30;

const ROL_DE_SERVICIO = 'SERVICIO';
// El campo de roles del acuerdo del consorcio (ADR 009). Es el que usa M2 en su token de servicio, aunque `M2_CAMPO_ROLES`
// cambie el campo que lee M2 en los tokens que recibe.
const CAMPO_ROLES = 'roles';

// Un error con el `code` de `Problem` que le corresponde; el código HTTP sale de ese `code`.
class ErrorM6 extends Error {
  constructor(
    readonly codigo: CodigoDeProblema,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

const noAutenticado = () => new ErrorM6('UNAUTHENTICATED', 'Token de servicio ausente o inválido');

// Si el pedido trae un token de servicio de este consorcio para M6: HS256 con la clave, el emisor, la audiencia de M6
// (`M2_AUDIENCIA_M6`), que no venció y con `SERVICIO` en la lista de roles. Cualquier otra cosa es 401, sin decir qué falló:
// no hace falta para probar M2, y no le da pistas a quien prueba tokens.
async function verificarTokenDeServicio(encabezado: string | undefined, config: ConfigM6): Promise<void> {
  const token = typeof encabezado === 'string' ? /^Bearer +(\S+)$/i.exec(encabezado)?.[1] : undefined;
  if (token === undefined) throw noAutenticado();
  let roles: unknown;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(config.claveTokens), {
      algorithms: ['HS256'],
      issuer: config.emisorTokens,
      audience: config.audienciaM6,
      clockTolerance: TOLERANCIA_RELOJ_SEGUNDOS,
      requiredClaims: ['exp', 'sub'],
    });
    roles = payload[CAMPO_ROLES];
  } catch {
    throw noAutenticado();
  }
  if (!Array.isArray(roles) || !roles.includes(ROL_DE_SERVICIO)) throw noAutenticado();
}

const parametroInvalido = (nombre: string) => new ErrorM6('VALIDATION', `El parámetro ${nombre} no es válido`);

function leerUuid(valor: unknown, nombre: string): string | undefined {
  if (valor === undefined) return undefined;
  if (typeof valor !== 'string' || !UUID.test(valor)) throw parametroInvalido(nombre);
  return valor;
}

function leerEntero(valor: unknown, nombre: string, porDefecto: number, minimo: number, maximo: number): number {
  if (valor === undefined) return porDefecto;
  const numero = typeof valor === 'string' && /^\d+$/.test(valor) ? Number(valor) : Number.NaN;
  if (!Number.isSafeInteger(numero) || numero < minimo || numero > maximo) throw parametroInvalido(nombre);
  return numero;
}

// `state` es una lista separada por comas: uno o más estados.
function leerEstados(valor: unknown): EstadoDeViaje[] | undefined {
  if (valor === undefined) return undefined;
  const estados = typeof valor === 'string' ? valor.split(',') : [];
  if (estados.length === 0 || !estados.every((estado) => (ESTADOS_DE_VIAJE as readonly string[]).includes(estado))) {
    throw parametroInvalido('state');
  }
  return estados as EstadoDeViaje[];
}

// Modo lento: espera el retardo antes de contestar. Si la conexión se corta antes (M2 se cansó de esperar, o el modo pasó a
// caído), deja de esperar para no mantener vivo el proceso.
async function esperarRetardo(reply: FastifyReply, ms: number): Promise<void> {
  const cortar = new AbortController();
  reply.raw.once('close', () => cortar.abort());
  await esperar(ms, undefined, { signal: cortar.signal }).catch(() => undefined);
}

export function construirAppM6({ config, estado, flujoLog }: OpcionesAppM6): FastifyInstance {
  const app = Fastify({
    // El modo caído cierra el puerto con `close()`: tiene que cortar también los pedidos en espera del modo lento.
    forceCloseConnections: true,
    exposeHeadRoutes: false,
    requestIdHeader: false,
    genReqId: (req) => {
      const recibido = req.headers['x-request-id'];
      return typeof recibido === 'string' && ID_VALIDO.test(recibido) ? recibido : `m6-${randomUUID()}`;
    },
    logger: { level: 'info', stream: flujoLog },
    logController: new LogController({ requestIdLogLabel: 'idCorrelacion', disableRequestLogging: true }),
  });

  const responder = (reply: FastifyReply, codigo: CodigoDeProblema, mensaje: string) =>
    reply
      .code(PROBLEMAS[codigo][0])
      .header('content-type', 'application/problem+json')
      .send(JSON.stringify(errorM6(codigo, mensaje, reply.request.id)));
  const responderError = (reply: FastifyReply, error: ErrorM6) => responder(reply, error.codigo, error.message);

  // El token antes que todo, también en una ruta que no existe, y después la espera del modo lento: un token que no sirve
  // no hace esperar a nadie.
  app.addHook('onRequest', async (request, reply) => {
    await verificarTokenDeServicio(request.headers.authorization, config);
    if (estado.modo() === 'lento') await esperarRetardo(reply, config.retardoLentoMs);
  });

  app.addHook('onResponse', async (request, reply) => {
    const ruta = request.is404 ? request.url.split('?', 1)[0] : request.routeOptions.url;
    request.log.info({ metodo: request.method, ruta, estado: reply.statusCode, duracionMs: reply.elapsedTime }, 'Pedido terminado');
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof ErrorM6) return responderError(reply, error);
    request.log.error({ err: { tipo: error instanceof Error ? error.name : typeof error } }, 'Error interno');
    return responder(reply, 'INTERNAL_ERROR', 'Error interno del M6 simulado');
  });

  app.setNotFoundHandler((_request, reply) => responder(reply, 'ROUTE_NOT_FOUND', 'Ruta no encontrada'));

  app.get('/trips', async (request) => {
    const query = request.query as Record<string, unknown>;
    const filtro = {
      clientId: leerUuid(query['clientId'], 'clientId'),
      driverId: leerUuid(query['driverId'], 'driverId'),
      state: leerEstados(query['state']),
    };
    const page = leerEntero(query['page'], 'page', 1, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = leerEntero(query['pageSize'], 'pageSize', 20, 1, 100);
    // El contrato le exige `clientId` o `driverId` a un token de servicio: un servicio no lista los viajes de todos.
    if (filtro.clientId === undefined && filtro.driverId === undefined) {
      throw new ErrorM6('VALIDATION', 'Un servicio tiene que indicar clientId o driverId');
    }
    const viajes = estado.listar(filtro);
    const inicio = (page - 1) * pageSize;
    return pagina(viajes.slice(inicio, inicio + pageSize).map(resumen), page, pageSize, viajes.length);
  });

  app.get('/trips/:tripId', async (request) => {
    const { tripId } = request.params as { tripId: string };
    const viaje = UUID.test(tripId) ? estado.buscar(tripId) : undefined;
    if (viaje === undefined) throw new ErrorM6('TRIP_NOT_FOUND', 'Viaje no encontrado');
    return viaje;
  });

  return app;
}
