import Fastify, { LogController, type FastifyInstance, type FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { STATUS_CODES } from 'node:http';
import type { Writable } from 'node:stream';
import { responderProblema, type Problema } from '../servidor/problemas.js';
import type { ConfigM6 } from '../servidor/config.js';
import { hostsPermitidos } from '../servidor/seguridad.js';
import { MODOS, type EstadoM6, type Modo } from './estado.js';
import type { PuertoApi } from './puerto-api.js';

// El canal de control del M6 simulado: lo que el servidor del panel le pide para cambiar de escenario y de modo sin tocar Docker
// (RNF-13.5). Va en su propio puerto (`M6_PUERTO_CONTROL`), aparte del de la API, que el modo caído cierra y este tiene que
// seguir abierto para volver a normal. No lleva token: lo protege dónde se publica (solo `127.0.0.1`, plan) y las dos defensas de
// abajo, que cierran el camino a una página web.

export type OpcionesAppControl = { config: ConfigM6; estado: EstadoM6; api: PuertoApi; flujoLog?: Writable };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_VALIDO = /^[A-Za-z0-9._-]{1,128}$/;
const METODOS_DE_CONSULTA = new Set(['GET', 'HEAD', 'OPTIONS']);
// El nombre del servicio en compose: el panel en su contenedor llama a `http://m6:3007`.
const NOMBRE_DEL_SERVICIO = 'm6';

const HOST_AJENO: Problema = {
  type: '/m6-control/errores/host-no-permitido',
  title: 'Host no permitido',
  status: 403,
  detail: 'El canal de control solo responde en localhost, 127.0.0.1, [::1] o m6, con su puerto.',
};

const CON_ORIGEN: Problema = {
  type: '/m6-control/errores/origen-no-permitido',
  title: 'Origen no permitido',
  status: 403,
  detail: 'El canal de control lo usa el servidor del panel, no una página: un pedido que cambia algo con Origin se rechaza.',
};

const invalido = (detail: string): Problema => ({ type: '/m6-control/errores/pedido-invalido', title: 'Pedido inválido', status: 400, detail });

// Función pura: el problema a responder, o undefined si el pedido puede seguir.
// - `Host`: frena el DNS rebinding, que lleva a una página de otro sitio a llegar acá por un nombre que ella controla.
// - `Origin`: frena que una página mande un pedido directo (un `POST` sin cuerpo es un pedido «simple» y el navegador lo manda
//   sin preguntar). El que llama de verdad, el servidor del panel con `fetch` de Node, nunca manda `Origin`; el navegador lo manda
//   siempre en lo que cambia algo. Las consultas se dejan pasar: sin CORS, la página que las pide no puede leer la respuesta.
export function revisarAccesoDeControl(
  pedido: { metodo: string; host: string | undefined; origin: string | undefined },
  puerto: number,
): Problema | undefined {
  const host = pedido.host?.toLowerCase();
  const permitidos = [...hostsPermitidos(puerto), `${NOMBRE_DEL_SERVICIO}:${puerto}`];
  if (host === undefined || !permitidos.includes(host)) return HOST_AJENO;
  if (!METODOS_DE_CONSULTA.has(pedido.metodo.toUpperCase()) && pedido.origin !== undefined) return CON_ORIGEN;
  return undefined;
}

// Los errores de Fastify por un pedido mal formado (JSON roto, tipo no admitido…) traen su código 4xx.
function estadoDe(error: unknown): number {
  const estado = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof estado === 'number' && estado >= 400 && estado < 500 ? estado : 500;
}

function leerModo(cuerpo: unknown): Modo | undefined {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) return undefined;
  const modo = (cuerpo as Record<string, unknown>)['modo'];
  return (MODOS as readonly unknown[]).includes(modo) ? (modo as Modo) : undefined;
}

export function construirAppControl({ config, estado, api, flujoLog }: OpcionesAppControl): FastifyInstance {
  const app = Fastify({
    exposeHeadRoutes: false,
    requestIdHeader: false,
    genReqId: (req) => {
      const recibido = req.headers['x-request-id'];
      return typeof recibido === 'string' && ID_VALIDO.test(recibido) ? recibido : `m6-control-${randomUUID()}`;
    },
    logger: { level: 'info', stream: flujoLog },
    logController: new LogController({ requestIdLogLabel: 'idCorrelacion', disableRequestLogging: true }),
  });

  // Antes que toda ruta: el 403 va primero, también en una ruta que no existe y antes de leer el cuerpo.
  app.addHook('onRequest', async (request, reply) => {
    const problema = revisarAccesoDeControl(
      { metodo: request.method, host: request.headers.host, origin: request.headers.origin },
      config.puertoControl,
    );
    if (problema !== undefined) return responderProblema(reply, problema);
    return undefined;
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // Una línea por pedido con la plantilla de la ruta: ni el clienteId ni el cuerpo llegan al log.
  app.addHook('onResponse', async (request, reply) => {
    const ruta = request.is404 ? request.url.split('?', 1)[0] : request.routeOptions.url;
    request.log.info({ metodo: request.method, ruta, estado: reply.statusCode, duracionMs: reply.elapsedTime }, 'Pedido terminado');
  });

  app.setNotFoundHandler((_request, reply) =>
    responderProblema(reply, { type: '/m6-control/errores/no-encontrado', title: 'No encontrado', status: 404 }),
  );

  app.setErrorHandler((error: unknown, request, reply) => {
    const codigo = estadoDe(error);
    if (codigo === 500) {
      const { name, message } = error instanceof Error ? error : { name: typeof error, message: 'Error no identificado' };
      request.log.error({ err: { tipo: name, mensaje: message } }, 'Error interno');
    }
    return responderProblema(reply, {
      type: codigo === 500 ? '/m6-control/errores/error-interno' : '/m6-control/errores/pedido-invalido',
      title: STATUS_CODES[codigo] ?? 'Error',
      status: codigo,
    });
  });

  // Un cambio de modo cierra o abre el puerto de la API: de a uno por vez, para que dos pedidos juntos no se pisen y el puerto
  // quede como dice el último modo.
  let cola: Promise<unknown> = Promise.resolve();
  const enCola = <T>(tarea: () => Promise<T>): Promise<T> => {
    const resultado = cola.then(tarea);
    cola = resultado.catch(() => undefined);
    return resultado;
  };

  const estadoDelCanal = () => ({ modo: estado.modo(), retardoLentoMs: config.retardoLentoMs });
  const responderInvalido = (reply: FastifyReply, detail: string) => responderProblema(reply, invalido(detail));

  app.get('/control/estado', async () => estadoDelCanal());

  app.put('/control/modo', async (request, reply) => {
    const modo = leerModo(request.body);
    if (modo === undefined) return responderInvalido(reply, `El cuerpo tiene que ser {"modo": ${MODOS.map((m) => `"${m}"`).join(' | ')}}`);
    await enCola(async () => {
      // Se cambia el puerto antes que el modo: si no se puede abrir (el puerto está ocupado), el modo no cambia.
      await (modo === 'caido' ? api.cerrar() : api.abrir());
      estado.cambiarModo(modo);
    });
    return estadoDelCanal();
  });

  // Repone los viajes de ejemplo del cliente y responde sus escenarios. Repetirlo da lo mismo: es idempotente (RF-2.1.11).
  app.post('/control/clientes/:clienteId/ejemplo', async (request, reply) => {
    const { clienteId } = request.params as { clienteId: string };
    if (!UUID.test(clienteId)) return responderInvalido(reply, 'El clienteId no es un UUID');
    const cliente = clienteId.toLowerCase();
    estado.cargarEjemplo(cliente);
    return { clienteId: cliente, escenarios: estado.escenarios(cliente) };
  });

  return app;
}
