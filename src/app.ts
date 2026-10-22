import Fastify, { type FastifyInstance, type FastifyReply, LogController } from 'fastify';
import type { Socket } from 'node:net';
import type { Writable } from 'node:stream';
import { registrarPermisos } from './auth/permisos.js';
import type { BaseDeDatos } from './bd/pool.js';
import type { Config } from './config.js';
import type { Contrato } from './contrato/cargar.js';
import { prepararRutas405, registrarOperaciones, type Manejadores } from './contrato/operaciones.js';
import { crearCompilador } from './contrato/validacion.js';
import { idCorrelacion } from './correlacion.js';
import { crearClientErrorHandler, crearFrameworkErrors, responderProblema } from './errores-fastify.js';
import { Deteniendose, NoEncontrado } from './errores.js';
import { CAMPO_ID_CORRELACION, opcionesLogger, registrarSolicitud, secretosDeConfig } from './logs.js';
import { registrarSaludAMano } from './salud.js';

// `pool` es la base de datos que usan los manejadores (`request.server.pool`): la app no la crea ni la cierra, eso lo hace el
// arranque. `flujoLog` es adonde van los logs; sin él, a la salida estándar.
export type OpcionesApp = {
  config: Config;
  pool: BaseDeDatos;
  contrato: Contrato;
  manejadores: Manejadores;
  flujoLog?: Writable;
};

declare module 'fastify' {
  interface FastifyInstance {
    // Si el servicio se está deteniendo. Lo pone en true `detener` (arranque.ts): desde ahí, lo que llega recibe 503.
    deteniendose: boolean;
    // Las respuestas que todavía no terminaron: las que la parada corta si no terminan a tiempo.
    enCurso: ReadonlySet<FastifyReply>;
  }
}

// El cuerpo de una solicitud pesa 1 MiB como máximo (RNF-03.2). Es lo que Fastify hace por defecto, escrito para que se vea.
const LIMITE_CUERPO = 1024 * 1024;

// Lo que la app hace para la parada (plan, Lógica 13). Cada solicitud queda en `enCurso` hasta que su respuesta termina o
// se cierra su conexión. Desde que el servicio se detiene, lo que llega por una conexión abierta recibe 503, y cada
// respuesta que termina cierra las conexiones que quedaron sin solicitudes: una respuesta que empezó antes de la parada sale
// con keep-alive, y app.close() esperaría a que el cliente cerrara su conexión.
function prepararParada(app: FastifyInstance): void {
  const enCurso = new Set<FastifyReply>();
  app.decorate('deteniendose', false);
  app.decorate('enCurso', enCurso);
  app.addHook('onRequest', async (_request, reply) => {
    enCurso.add(reply);
    reply.raw.once('close', () => {
      enCurso.delete(reply);
      if (app.deteniendose) app.server.closeIdleConnections();
    });
    if (app.deteniendose) throw new Deteniendose();
  });
  // Una respuesta que espera detrás de otra en la misma conexión no emite 'close' si la conexión se cierra antes de que le
  // toque salir: sale de enCurso cuando se cierra la conexión.
  app.server.on('connection', (socket: Socket) => {
    socket.once('close', () => {
      for (const reply of enCurso) if (reply.request.raw.socket === socket) enCurso.delete(reply);
    });
  });
}

// La app de Fastify armada desde el contrato: valida con sus esquemas, responde los errores con aProblema (también los que
// Fastify y Node contestan antes de entrar a una ruta) y expone solo las operaciones que tienen manejador; a una ruta que no
// existe responde 404, y a un método que la ruta no tiene, 405. Exige el token y el rol que pide la security de cada
// operación: 401 y 403. Tiene también GET /health, que comprueba la base.
// Cada solicitud lleva un identificador de correlación y cada respuesta lo devuelve; cada solicitud que termina deja una
// línea en el log, y un error no previsto, su detalle. Lleva la cuenta de las solicitudes en curso (`enCurso`) y, desde que
// el servicio se detiene (`deteniendose`), responde 503.
// No escucha en ningún puerto ni se detiene sola; eso lo hace el arranque.
export function construirApp({ config, pool, contrato, manejadores, flujoLog }: OpcionesApp) {
  // Node entrega los nombres de los encabezados de la solicitud en minúscula; el configurado se conserva como se escribió.
  const encabezadoMinuscula = config.encabezadoCorrelacion.toLowerCase();
  const app = Fastify({
    bodyLimit: LIMITE_CUERPO,
    // Sin el HEAD que Fastify suma a cada GET: un HEAD que el contrato no declara da 405, como otro método (Lógica 8).
    exposeHeadRoutes: false,
    // El id de la solicitud sale de idCorrelacion, que valida lo que llega. Con requestIdHeader Fastify tomaría el valor sin
    // validarlo (RNF-14.3); ya es false por defecto en Fastify 5, y se escribe para que se vea.
    requestIdHeader: false,
    genReqId: (req) => idCorrelacion(req.headers[encabezadoMinuscula]),
    logger: opcionesLogger(secretosDeConfig(config), flujoLog),
    // El id de la solicitud va a cada línea del log como idCorrelacion. Fastify no escribe sus líneas por solicitud: traen la
    // URL con su query string (RNF-19.2), y las líneas que se registran son las propias. Las opciones sueltas
    // requestIdLogLabel y disableRequestLogging están deprecadas desde Fastify 5.12 (FSTDEP023 y FSTDEP024).
    logController: new LogController({ requestIdLogLabel: CAMPO_ID_CORRELACION, disableRequestLogging: true }),
    // La URL mal codificada, el parámetro de ruta largo y el HTTP que Node no puede leer no llegan a una ruta: sin esto,
    // Fastify los responde con su propio JSON, sin el encabezado de correlación ni la línea de log (Lógica 9).
    frameworkErrors: crearFrameworkErrors(config.encabezadoCorrelacion),
    clientErrorHandler: crearClientErrorHandler(config.encabezadoCorrelacion),
    // Al cerrarse, Fastify responde un 503 propio que no es problem+json. El de la parada lo da prepararParada (Lógica 13).
    return503OnClosing: false,
  });
  // A un Expect que no es 100-continue, Node responde 417 por su cuenta si nadie atiende checkExpectation: sin pasar por
  // Fastify, sin el encabezado de correlación ni la línea de log. El RFC 9110 deja ignorar una expectativa que el servidor no
  // conoce, y así la solicitud sigue como cualquier otra. Va en el servidor principal, como el clientError de Fastify:
  // escuchando en 0.0.0.0 no hay otro.
  app.server.on('checkExpectation', (req, res) => app.routing(req, res));
  // Fastify lee también text/plain; sin ese lector, ese cuerpo da 415 como cualquier otro que no es JSON (RNF-03.2).
  app.removeContentTypeParser('text/plain');
  app.decorate('pool', pool);
  app.setValidatorCompiler(crearCompilador(contrato));
  app.setErrorHandler(responderProblema);
  // Todas las respuestas pasan por onSend, también las de error y las que un hook onRequest responde, sin depender del orden
  // en que se registren los hooks (RNF-14.4).
  app.addHook('onSend', async (request, reply) => {
    reply.header(config.encabezadoCorrelacion, request.id);
  });
  // Al terminar cada solicitud, su línea de log (RNF-14.6). Pasan por acá todas las respuestas, también las de error y las
  // que un hook onRequest responde; las que Fastify contesta antes de entrar a una ruta escriben la suya en
  // errores-fastify.ts.
  app.addHook('onResponse', async (request, reply) => {
    registrarSolicitud(request, reply);
  });
  // Los hooks onRequest corren en el orden en que se registran. Primero el de la parada: su 503 va antes que todo lo que no
  // sea el 400 por la URL, que Fastify responde antes de llegar a los hooks (RNF-03.5).
  prepararParada(app);
  // Una ruta que no existe da 404 acá, antes de que Fastify lea el cuerpo: si no, uno de más de 1 MiB daría 413 y un JSON
  // roto, 400 (RNF-03.5).
  app.addHook('onRequest', async (request) => {
    if (request.is404) throw new NoEncontrado();
  });
  // Después del 404 y antes de leer el cuerpo: el 401 y el 403 van antes que cualquier error del cuerpo (RNF-03.5). Y antes de
  // registrar cualquier ruta: desde acá, una que no declara sus permisos no se registra (Lógica 4).
  registrarPermisos(app, config);
  const registrarRutas405 = prepararRutas405(app);
  const { implementadas } = registrarOperaciones(app, contrato, manejadores, config.encabezadoCorrelacion);
  registrarSaludAMano(app, implementadas);
  // Al final, con todas las rutas ya registradas.
  registrarRutas405();
  return app;
}
