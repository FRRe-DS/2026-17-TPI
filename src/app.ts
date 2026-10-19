import Fastify from 'fastify';
import type { Config } from './config.js';
import type { Contrato } from './contrato/cargar.js';
import { prepararRutas405, registrarOperaciones, type Manejadores } from './contrato/operaciones.js';
import { crearCompilador } from './contrato/validacion.js';
import { idCorrelacion } from './correlacion.js';
import { aProblema, NoEncontrado } from './errores.js';

export type OpcionesApp = { config: Config; contrato: Contrato; manejadores: Manejadores };

// El cuerpo de una solicitud pesa 1 MiB como máximo (RNF-03.2). Es lo que Fastify hace por defecto, escrito para que se vea.
const LIMITE_CUERPO = 1024 * 1024;

// La app de Fastify armada desde el contrato: valida con sus esquemas, responde los errores con aProblema y expone solo
// las operaciones que tienen manejador; a una ruta que no existe responde 404, y a un método que la ruta no tiene, 405.
// Cada solicitud lleva un identificador de correlación y cada respuesta lo devuelve. No escucha en ningún puerto; eso lo
// hace el arranque.
export function construirApp({ config, contrato, manejadores }: OpcionesApp) {
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
  });
  // Fastify lee también text/plain; sin ese lector, ese cuerpo da 415 como cualquier otro que no es JSON (RNF-03.2).
  app.removeContentTypeParser('text/plain');
  app.setValidatorCompiler(crearCompilador(contrato));
  app.setErrorHandler((error, request, reply) => {
    const { codigo, cuerpo, encabezados } = aProblema(error, request.url);
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
