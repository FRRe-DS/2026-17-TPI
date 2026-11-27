import type { FastifyInstance } from 'fastify';
import { crearCookiesAuth } from './cookies.js';
import { parametrosUnicos, type ContextoAuth } from './retorno.js';
import { comprobarDisponibilidad } from './oidc.js';

export async function registrarSalidaAuth(app: FastifyInstance, { config, sesiones, transacciones, comprobarIdentidad = () => comprobarDisponibilidad(config) }: ContextoAuth & { comprobarIdentidad?: () => Promise<void> }) {
  const cookies = crearCookiesAuth(config);
  // Acepta el formulario nativo vacío. No usa campos aportados por el navegador.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, _body, listo) => listo(null, {}));
  app.post('/auth/cerrar', { bodyLimit: 1024 }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const encontrada = cookies.leerSesion(request, sesiones);
    if (encontrada) sesiones.invalidar(encontrada.id);
    cookies.borrarSesion(reply);
    try {
      await comprobarIdentidad();
      const tx = transacciones.crear({ tipo: 'salida', retorno: '/' });
      cookies.establecerTransaccion(reply, tx.vinculo);
      const destino = new URL(`${config.oidcEmisor}/protocol/openid-connect/logout`);
      destino.search = new URLSearchParams({ client_id: config.oidcCliente, post_logout_redirect_uri: config.urlSalida, state: tx.state }).toString();
      return reply.code(303).header('location', destino.href).send();
    } catch { return reply.code(303).header('location', '/?salida=no-confirmada').send(); }
  });
  app.get('/auth/salida', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const parametros = parametrosUnicos(request.url, ['state']);
    const tx = parametros && transacciones.consumir(parametros.get('state') ?? undefined, cookies.leerTransaccion(request));
    cookies.borrarTransaccion(reply);
    return reply.code(303).header('location', tx?.tipo === 'salida' ? '/?salida=completa' : '/?salida=no-confirmada').send();
  });
}
