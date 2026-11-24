import { describe, it, expect, vi, afterEach } from 'vitest';
import { construirApp } from '../../../panel/servidor/app.js';
import { cargarConfigPanel } from '../../../panel/servidor/config.js';
import { crearAlmacenSesiones } from '../../../panel/servidor/auth/sesiones.js';
const config = cargarConfigPanel({ PANEL_MODO_AUTH: 'oidc', PANEL_ORIGEN_PUBLICO: 'http://localhost:8083',
  PANEL_OIDC_EMISOR: 'http://localhost:8080/realms/prueba', PANEL_OIDC_URL_INTERNA: 'http://localhost:8080/realms/prueba' }).config!;
afterEach(() => vi.unstubAllGlobals());
describe('proxy real', () => {
  it('usa solo token servidor, preserva bytes/idempotencia/401 y nunca repite escritura', async () => {
    const sesiones = crearAlmacenSesiones(); const ahora = Date.now();
    const id = sesiones.crear({ sub: 'usuario', roles: ['CLIENTE'], scopes: [], credenciales: {
      accessToken: 'acceso-servidor', refreshToken: 'refresh', accessTokenVenceEn: ahora + 100_000, refreshTokenVenceEn: ahora + 300_000 } });
    const pedir = vi.fn(async (_url, opciones) => {
      expect(opciones.headers.authorization).toBe('Bearer acceso-servidor');
      expect(opciones.headers['idempotency-key']).toBe('misma-clave');
      expect(Buffer.from(opciones.body).toString()).toBe('{ "nombre": "persona" }');
      return new Response('{"type":"rechazo-m2"}', { status: 401, headers: { 'content-type': 'application/problem+json' } });
    }); vi.stubGlobal('fetch', pedir);
    const app = construirApp({ config, auth: { sesiones } });
    const headers = { host: 'localhost:8083', origin: 'http://localhost:8083', cookie: `m2_sesion=${id}`, 'content-type': 'application/json', 'idempotency-key': 'misma-clave' };
    try {
      for (const extra of [{ authorization: 'Bearer ajeno' }, { 'x-panel-sub': 'otro' }, { 'x-panel-rol': 'OPERADOR' }]) {
        expect((await app.inject({ method: 'POST', url: '/api/v1/clientes', headers: { ...headers, ...extra }, payload: '{}' })).statusCode).toBe(400);
      }
      const respuesta = await app.inject({ method: 'POST', url: '/api/v1/clientes', headers, payload: '{ "nombre": "persona" }' });
      expect(respuesta.statusCode).toBe(401); expect(respuesta.json().type).toBe('rechazo-m2'); expect(pedir).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });
});
