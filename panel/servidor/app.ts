import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { STATUS_CODES } from 'node:http';
import type { Writable } from 'node:stream';
import type { ConfigPanel } from './config.js';
import { registrarEncabezadosDeSeguridad, registrarEstaticos } from './estaticos.js';
import { ESPERA_CONTROL_MS, registrarControlM6 } from './m6-control.js';
import { crearDependenciasDemo, registrarDemo, type DependenciasDemo } from './demo/rutas.js';
import { crearRegistroDePedidos, registrarPedidos } from './pedidos.js';
import { responderProblema } from './problemas.js';
import { ESPERA_M2_MS, registrarReenvio } from './proxy.js';
import { registrarSeguridad } from './seguridad.js';

export type OpcionesApp = {
  config: ConfigPanel;
  // Adonde van los logs; sin él, a la salida estándar.
  flujoLog?: Writable;
  // Cuánto se espera a M2. Solo las pruebas lo cambian.
  esperaM2Ms?: number | undefined;
  // Cuánto se espera al canal de control del M6 simulado. Solo las pruebas lo cambian.
  esperaControlMs?: number | undefined;
  // La carpeta con el cliente compilado (`panel/dist/cliente`). Sin ella, el panel no sirve archivos.
  directorioCliente?: string | undefined;
  // La base de M2 y Docker de la vista de demostración. Sin ella, los de la configuración (PANEL_URL_BD, PANEL_DOCKER). Solo las
  // pruebas la pasan.
  demo?: DependenciasDemo | undefined;
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

// La app del panel: seguridad de acceso, salud, logs, reenvío a M2, detalle técnico de sus pedidos y reenvío al canal de control del
// M6 simulado y, si se le da la carpeta, los archivos del cliente. No escucha en ningún puerto; eso lo hace el arranque.
export function construirApp({ config, flujoLog, esperaM2Ms = ESPERA_M2_MS, esperaControlMs = ESPERA_CONTROL_MS, directorioCliente, demo }: OpcionesApp): FastifyInstance {
  const app = Fastify({
    // El cuerpo se pasa tal cual a M2, que es quien lo valida; el límite de 1 MiB es el de M2 (RNF-03.2).
    bodyLimit: 1024 * 1024,
    exposeHeadRoutes: false,
    requestIdHeader: false,
    // Los esquemas de las rutas /panel/demo/… rechazan lo que sobra y no convierten tipos: por defecto Fastify quita los campos de
    // más y vuelve número un «10», y la vista tiene que poder decirle a la persona que su pedido no es válido.
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } },
    genReqId: (req) => idDePedido(req.headers['x-request-id']),
    logger: { level: 'info', stream: flujoLog },
    // Fastify no escribe sus líneas por pedido: traen la URL con su query string. Las que se registran son las propias.
    logController: new LogController({ requestIdLogLabel: 'idCorrelacion', disableRequestLogging: true }),
  });

  // Antes que toda ruta: el 403 va primero, también en una ruta que no existe.
  registrarSeguridad(app, config.puerto);
  registrarEncabezadosDeSeguridad(app);

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
  const pedidos = crearRegistroDePedidos();
  registrarPedidos(app, pedidos, config.urlM2Publica);
  app.register(registrarReenvio, { config, esperaMs: esperaM2Ms, pedidos });
  app.register(registrarControlM6, { config, esperaMs: esperaControlMs });
  // Con las dependencias de la configuración, el pool de la base se cierra con la app; las que se pasan las cierra quien las creó.
  const propias = demo === undefined ? crearDependenciasDemo(config) : undefined;
  if (propias !== undefined) app.addHook('onClose', async () => propias.cerrar());
  app.register(registrarDemo, { config, demo: demo ?? propias!, esperaM2Ms: esperaM2Ms === ESPERA_M2_MS ? undefined : esperaM2Ms });
  if (directorioCliente !== undefined) registrarEstaticos(app, directorioCliente);

  return app;
}
