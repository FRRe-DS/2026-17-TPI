import Fastify, { LogController } from 'fastify';
import type { Writable } from 'node:stream';
import { registrarPermisos } from './auth/permisos.js';
import type { Config } from './config.js';
import type { Contrato } from './contrato/cargar.js';
import { prepararRutas405, registrarOperaciones, type Manejadores } from './contrato/operaciones.js';
import { crearCompilador } from './contrato/validacion.js';
import { idCorrelacion } from './correlacion.js';
import { crearClientErrorHandler, crearFrameworkErrors, responderProblema } from './errores-fastify.js';
import { NoEncontrado } from './errores.js';
import { CAMPO_ID_CORRELACION, opcionesLogger, registrarSolicitud, secretosDeConfig } from './logs.js';

// `flujoLog` es adonde van los logs; sin él, a la salida estándar.
export type OpcionesApp = { config: Config; contrato: Contrato; manejadores: Manejadores; flujoLog?: Writable };

// El cuerpo de una solicitud pesa 1 MiB como máximo (RNF-03.2). Es lo que Fastify hace por defecto, escrito para que se vea.
const LIMITE_CUERPO = 1024 * 1024;

// La app de Fastify armada desde el contrato: valida con sus esquemas, responde los errores con aProblema (también los que
// Fastify y Node contestan antes de entrar a una ruta) y expone solo las operaciones que tienen manejador; a una ruta que no
// existe responde 404, y a un método que la ruta no tiene, 405. Exige el token y el rol que pide la security de cada
// operación: 401 y 403.
// Cada solicitud lleva un identificador de correlación y cada respuesta lo devuelve; cada solicitud que termina deja una
// línea en el log, y un error no previsto, su detalle.
// No escucha en ningún puerto; eso lo hace el arranque.
export function construirApp({ config, contrato, manejadores, flujoLog }: OpcionesApp) {
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
  });
  // A un Expect que no es 100-continue, Node responde 417 por su cuenta si nadie atiende checkExpectation: sin pasar por
  // Fastify, sin el encabezado de correlación ni la línea de log. El RFC 9110 deja ignorar una expectativa que el servidor no
  // conoce, y así la solicitud sigue como cualquier otra. Va en el servidor principal, como el clientError de Fastify:
  // escuchando en 0.0.0.0 no hay otro.
  app.server.on('checkExpectation', (req, res) => app.routing(req, res));
  // Fastify lee también text/plain; sin ese lector, ese cuerpo da 415 como cualquier otro que no es JSON (RNF-03.2).
  app.removeContentTypeParser('text/plain');
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
  // Los hooks onRequest corren en el orden en que se registran. Una ruta que no existe da 404 acá, antes de que Fastify lea
  // el cuerpo: si no, uno de más de 1 MiB daría 413 y un JSON roto, 400 (RNF-03.5).
  app.addHook('onRequest', async (request) => {
    if (request.is404) throw new NoEncontrado();
  });
  // Después del 404 y antes de leer el cuerpo: el 401 y el 403 van antes que cualquier error del cuerpo (RNF-03.5).
  registrarPermisos(app, config);
  const registrarRutas405 = prepararRutas405(app);
  registrarOperaciones(app, contrato, manejadores, config.encabezadoCorrelacion);
  // Al final, con todas las rutas ya registradas.
  registrarRutas405();
  return app;
}
