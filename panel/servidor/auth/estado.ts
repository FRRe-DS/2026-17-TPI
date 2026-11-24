import type { FastifyInstance, FastifyReply } from 'fastify';
import { responderProblema } from '../problemas.js';
import { crearCookiesAuth } from './cookies.js';
import type { ContextoAuth } from './retorno.js';
import type { Renovacion } from './renovacion.js';
import { SesionRechazada } from './oidc.js';

export function responderFallaSesion(reply: FastifyReply, error: unknown) {
  const rechazada = error instanceof SesionRechazada;
  if (!rechazada) reply.header('retry-after', '5');
  return responderProblema(reply, { status: rechazada ? 401 : 503,
    type: rechazada ? '/panel/errores/sesion-vencida' : '/panel/errores/identidad-no-disponible',
    title: rechazada ? 'Volvé a ingresar' : 'Identidad no disponible' });
}
export async function registrarEstadoAuth(app: FastifyInstance, { config, sesiones, renovacion }: ContextoAuth & { renovacion: Renovacion }) {
  const cookies = crearCookiesAuth(config);
  app.get('/auth/sesion', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const encontrada = cookies.leerSesion(request, sesiones);
    if (!encontrada) return responderFallaSesion(reply, new SesionRechazada());
    try {
      const sesion = await renovacion.obtener(encontrada.id);
      return { sub: sesion.sub, roles: sesion.roles, scopes: sesion.scopes };
    } catch (error) { return responderFallaSesion(reply, error); }
  });
}
