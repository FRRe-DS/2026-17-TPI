import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { STATUS_CODES } from 'node:http';
import type { Writable } from 'node:stream';
import type { ConfigPanel } from './config.js';
import { responderProblema } from './problemas.js';
import { ESPERA_M2_MS, registrarReenvio } from './proxy.js';
import { registrarSeguridad } from './seguridad.js';

export type OpcionesApp = {
  config: ConfigPanel;
  // Adonde van los logs; sin él, a la salida estándar.
  flujoLog?: Writable;
  // Cuánto se espera a M2. Solo las pruebas lo cambian.
  esperaM2Ms?: number | undefined;
};

// El mismo patrón que M2 (RNF-14.3): de 1 a 128 caracteres de letras, números, punto, guion bajo y guion.
const ID_VALIDO = /^[A-Za-z0-9._-]{1,128}$/;

// El identificador de un pedido: el `X-Request-Id` recibido si cumple el patrón, y si no uno propio con el prefijo `panel-`.
// Lo que llega se valida porque vuelve en las respuestas y llega a los logs.
export function idDePedido(valor: string | string[] | undefined): string {
  return typeof valor === 'string' && ID_VALIDO.test(valor) ? valor : `panel-${randomUUID()}`;
}

// Los errores de Fastify por un pedido mal formado (cuerpo muy grande, tipo no admitido…) traen su código 4xx; todo lo demás es
// un error del panel.
function estadoDe(error: unknown): number {
  const estado = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof estado === 'number' && estado >= 400 && estado < 500 ? estado : 500;
}

// La app del panel: seguridad de acceso, salud, logs y reenvío a M2. Las demás rutas se suman después (canal de control del
// M6 simulado, archivos del cliente). No escucha en ningún puerto; eso lo hace el arranque.
export function construirApp({ config, flujoLog, esperaM2Ms = ESPERA_M2_MS }: OpcionesApp): FastifyInstance {
  const app = Fastify({
    // El cuerpo se pasa tal cual a M2, que es quien lo valida; el límite de 1 MiB es el de M2 (RNF-03.2).
    bodyLimit: 1024 * 1024,
    exposeHeadRoutes: false,
    requestIdHeader: false,
    genReqId: (req) => idDePedido(req.headers['x-request-id']),
    logger: { level: 'info', stream: flujoLog },
    // Fastify no escribe sus líneas por pedido: traen la URL con su query string. Las que se registran son las propias.
    logController: new LogController({ requestIdLogLabel: 'idCorrelacion', disableRequestLogging: true }),
  });

  // Antes que toda ruta: el 403 va primero, también en una ruta que no existe.
  registrarSeguridad(app, config.puerto);

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // Una línea JSON por pedido terminado: método, ruta sin query string, código y duración. Lista cerrada de campos, sin
  // encabezados ni cuerpos, para que ni el token ni lo que la persona escribió lleguen al log (RNF-19.3).
  app.addHook('onResponse', async (request, reply) => {
    const ruta = request.routeOptions.url ?? request.url.split('?', 1)[0];
    request.log.info({ metodo: request.method, ruta, estado: reply.statusCode, duracionMs: reply.elapsedTime }, 'Pedido terminado');
  });

  app.setNotFoundHandler((_request, reply) =>
    responderProblema(reply, { type: '/panel/errores/no-encontrado', title: 'No encontrado', status: 404 }),
  );

  app.setErrorHandler((error: unknown, request, reply) => {
    const estado = estadoDe(error);
    if (estado === 500) {
      const { name, message } = error instanceof Error ? error : { name: typeof error, message: 'Error no identificado' };
      request.log.error({ err: { tipo: name, mensaje: message } }, 'Error interno');
    }
    return responderProblema(reply, {
      type: estado === 500 ? '/panel/errores/error-interno' : '/panel/errores/pedido-invalido',
      title: STATUS_CODES[estado] ?? 'Error',
      status: estado,
    });
  });

  app.get('/salud-panel', async () => ({ estado: 'ok' }));
  app.register(registrarReenvio, { config, esperaMs: esperaM2Ms });

  return app;
}
