import Fastify, { LogController, type FastifyInstance, type FastifyReply } from 'fastify';
import { jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import { setTimeout as esperar } from 'node:timers/promises';
import type { ConfigM6 } from '../servidor/config.js';
import { errorM6, ESTADOS_DE_VIAJE, pagina, resumen, type EstadoDeViaje } from './cuerpos.js';
import type { EstadoM6 } from './estado.js';

// La API del M6 simulado: las dos consultas de `contrato/dependencias/m6.yml` que usa M2, en el mismo puerto y con la misma
// ruta base que el M6 del Grupo 12 (`/api/v1`), así M2 lo llama con su `M2_URL_M6` sin cambiar nada (RNF-13.7).

export type OpcionesAppM6 = { config: ConfigM6; estado: EstadoM6; flujoLog?: Writable };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_VALIDO = /^[A-Za-z0-9._-]{1,128}$/;
// Los mismos 30 segundos de tolerancia de reloj que M2 (RNF-12.2).
const TOLERANCIA_RELOJ_SEGUNDOS = 30;

const ROL_DE_SERVICIO = 'SERVICIO';
// El campo de roles del acuerdo del consorcio (ADR 009). Es el que usa M2 en su token de servicio, aunque `M2_CAMPO_ROLES`
// cambie el campo que lee M2 en los tokens que recibe.
const CAMPO_ROLES = 'roles';

class ErrorM6 extends Error {
  constructor(
    readonly estado: number,
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

const noAutenticado = () => new ErrorM6(401, 'UNAUTHORIZED', 'Token de servicio ausente o inválido');

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

const parametroInvalido = (nombre: string) => new ErrorM6(400, 'BAD_REQUEST', `El parámetro ${nombre} no es válido`);

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

function leerEstado(valor: unknown): EstadoDeViaje | undefined {
  if (valor === undefined) return undefined;
  if (!(ESTADOS_DE_VIAJE as readonly unknown[]).includes(valor)) throw parametroInvalido('state');
  return valor as EstadoDeViaje;
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

  const responderError = (reply: FastifyReply, error: ErrorM6) =>
    reply.code(error.estado).send(errorM6(error.codigo, error.message, reply.request.id));

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
    return reply.code(500).send(errorM6('INTERNAL_ERROR', 'Error interno del M6 simulado', request.id));
  });

  app.setNotFoundHandler((_request, reply) => responderError(reply, new ErrorM6(404, 'NOT_FOUND', 'Recurso no encontrado')));

  app.get('/api/v1/trips', async (request) => {
    const query = request.query as Record<string, unknown>;
    const filtro = {
      clientId: leerUuid(query['clientId'], 'clientId'),
      driverId: leerUuid(query['driverId'], 'driverId'),
      state: leerEstado(query['state']),
    };
    const page = leerEntero(query['page'], 'page', 1, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = leerEntero(query['pageSize'], 'pageSize', 20, 1, 100);
    // El M6 del Grupo 12 exige al menos un filtro a un token de servicio, para no exponer los viajes de todos.
    if (filtro.clientId === undefined && filtro.driverId === undefined && filtro.state === undefined) {
      throw new ErrorM6(400, 'FILTER_REQUIRED', 'Hace falta al menos un filtro: clientId, driverId o state');
    }
    const viajes = estado.listar(filtro);
    const inicio = (page - 1) * pageSize;
    return pagina(viajes.slice(inicio, inicio + pageSize).map(resumen), page, pageSize, viajes.length);
  });

  app.get('/api/v1/trips/:id', async (request) => {
    const { id } = request.params as { id: string };
    const viaje = UUID.test(id) ? estado.buscar(id) : undefined;
    if (viaje === undefined) throw new ErrorM6(404, 'NOT_FOUND', 'Viaje no encontrado');
    return viaje;
  });

  return app;
}
