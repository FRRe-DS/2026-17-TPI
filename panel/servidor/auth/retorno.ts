import type { FastifyInstance } from 'fastify';
import type { ConfigPanelOidc } from '../config.js';
import { crearCookiesAuth } from './cookies.js';
import type { ClienteOidc } from './oidc.js';
import type { crearAlmacenSesiones } from './sesiones.js';
import type { crearAlmacenTransacciones } from './transacciones.js';
import { IdentidadNoDisponible } from './validacion.js';

export type ContextoAuth = {
  config: ConfigPanelOidc; sesiones: ReturnType<typeof crearAlmacenSesiones>;
  transacciones: ReturnType<typeof crearAlmacenTransacciones>; oidc: ClienteOidc;
};
export function parametrosUnicos(url: string, permitidos: string[]): URLSearchParams | undefined {
  const parametros = new URL(url, 'http://local').searchParams;
  return [...parametros.keys()].every(nombre => permitidos.includes(nombre) && parametros.getAll(nombre).length === 1) ? parametros : undefined;
}
export async function registrarRetornoAuth(app: FastifyInstance, { config, sesiones, transacciones, oidc }: ContextoAuth) {
  const cookies = crearCookiesAuth(config);
  app.get('/auth/retorno', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const retornoInvalido = () => reply.code(303).header('location', '/?acceso=invalido').send();
    const parametros = parametrosUnicos(request.url, ['code', 'state', 'error', 'error_description', 'session_state', 'iss']);
    const transaccion = parametros && transacciones.consumir(parametros.get('state') ?? undefined, cookies.leerTransaccion(request));
    if (!transaccion || transaccion.tipo !== 'ingreso') return retornoInvalido();
    cookies.borrarTransaccion(reply);
    const code = parametros!.get('code');
    if (!code || parametros!.has('error') || (parametros!.has('iss') && parametros!.get('iss') !== config.oidcEmisor)) {
      return retornoInvalido();
    }
    try {
      const datos = await oidc.ingresar(code, transaccion.verifier, transaccion.nonce);
      const anterior = cookies.leerSesion(request, sesiones);
      // Primero admitir la nueva sesión: si no hay capacidad, no se destruye la anterior.
      cookies.emitirSesion(reply, datos, sesiones);
      if (anterior) sesiones.invalidar(anterior.id);
      return reply.code(303).header('location', transaccion.retorno).send();
    } catch (error) {
      return error instanceof IdentidadNoDisponible
        ? reply.code(303).header('location', '/?acceso=no-disponible').send() : retornoInvalido();
    }
  });
}
