import Fastify from 'fastify';
import type { Config } from './config.js';
import type { Contrato } from './contrato/cargar.js';
import { registrarOperaciones, type Manejadores } from './contrato/operaciones.js';
import { crearCompilador } from './contrato/validacion.js';
import { aProblema } from './errores.js';

export type OpcionesApp = { config: Config; contrato: Contrato; manejadores: Manejadores };

// La app de Fastify armada desde el contrato: valida con sus esquemas, responde los errores con aProblema y expone solo
// las operaciones que tienen manejador. No escucha en ningún puerto; eso lo hace el arranque.
export function construirApp({ config, contrato, manejadores }: OpcionesApp) {
  const app = Fastify();
  app.setValidatorCompiler(crearCompilador(contrato));
  app.setErrorHandler((error, request, reply) => {
    const { codigo, cuerpo, encabezados } = aProblema(error, request.url);
    return reply.code(codigo).headers(encabezados).send(cuerpo);
  });
  registrarOperaciones(app, contrato, manejadores, config.encabezadoCorrelacion);
  return app;
}
