import Fastify, { LogController } from 'fastify';
import type { Writable } from 'node:stream';
import type { Config } from './config.js';
import type { Contrato } from './contrato/cargar.js';
import { prepararRutas405, registrarOperaciones, type Manejadores } from './contrato/operaciones.js';
import { crearCompilador } from './contrato/validacion.js';
import { idCorrelacion } from './correlacion.js';
import { aProblema, NoEncontrado } from './errores.js';
import { opcionesLogger, registrarErrorInterno, secretosDeAutorizacion, secretosDeConfig } from './logs.js';

// `flujoLog` es adonde van los logs; sin él, a la salida estándar.
export type OpcionesApp = { config: Config; contrato: Contrato; manejadores: Manejadores; flujoLog?: Writable };

// El cuerpo de una solicitud pesa 1 MiB como máximo (RNF-03.2). Es lo que Fastify hace por defecto, escrito para que se vea.
const LIMITE_CUERPO = 1024 * 1024;

// La app de Fastify armada desde el contrato: valida con sus esquemas, responde los errores con aProblema y expone solo
// las operaciones que tienen manejador; a una ruta que no existe responde 404, y a un método que la ruta no tiene, 405.
// Cada solicitud lleva un identificador de correlación y cada respuesta lo devuelve; un error no previsto queda en el log.
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
    logController: new LogController({ requestIdLogLabel: 'idCorrelacion', disableRequestLogging: true }),
  });
  // Fastify lee también text/plain; sin ese lector, ese cuerpo da 415 como cualquier otro que no es JSON (RNF-03.2).
  app.removeContentTypeParser('text/plain');
  app.setValidatorCompiler(crearCompilador(contrato));
  app.setErrorHandler((error, request, reply) => {
    const { codigo, cuerpo, encabezados } = aProblema(error, request.url);
    // Solo un error no previsto se registra acá: los demás son respuestas que el servicio da a propósito (RNF-03.3).
    if (codigo === 500) registrarErrorInterno(request.log, error, secretosDeAutorizacion(request.headers.authorization));
    return reply.code(codigo).headers(encabezados).send(cuerpo);
  });
  // Todas las respuestas pasan por onSend, también las de error y las que un hook onRequest responde, sin depender del orden
  // en que se registren los hooks (RNF-14.4).
  app.addHook('onSend', async (request, reply) => {
    reply.header(config.encabezadoCorrelacion, request.id);
  });
  // Los hooks onRequest corren en el orden en que se registran. Una ruta que no existe da 404 acá, antes de que Fastify lea
  // el cuerpo: si no, uno de más de 1 MiB daría 413 y un JSON roto, 400 (RNF-03.5).
  app.addHook('onRequest', async (request) => {
    if (request.is404) throw new NoEncontrado();
  });
  const registrarRutas405 = prepararRutas405(app);
  registrarOperaciones(app, contrato, manejadores, config.encabezadoCorrelacion);
  // Al final, con todas las rutas ya registradas.
  registrarRutas405();
  return app;
}
