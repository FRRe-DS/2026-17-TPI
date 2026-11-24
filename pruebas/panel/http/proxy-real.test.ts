import { describe, it, expect, vi, afterEach } from 'vitest';
import { construirApp } from '../../../panel/servidor/app.js';
import { cargarConfigPanel } from '../../../panel/servidor/config.js';
import { crearAlmacenSesiones } from '../../../panel/servidor/auth/sesiones.js';
const config = cargarConfigPanel({ PANEL_MODO_AUTH: 'oidc', PANEL_ORIGEN_PUBLICO: 'http://localhost:8083',
  PANEL_OIDC_EMISOR: 'http://localhost:8080/realms/prueba', PANEL_OIDC_URL_INTERNA: 'http://localhost:8080/realms/prueba' }).config!;
afterEach(() => vi.unstubAllGlobals());
describe('proxy real', () => {
  it('aísla diagnósticos entre sesiones y no registra rutas de evaluación', async () => {
    const sesiones = crearAlmacenSesiones(); const ahora = Date.now();
    const crear = () => sesiones.crear({ sub: 'usuario', roles: [], scopes: [], credenciales: { accessToken: 'secreto', refreshToken: 'secreto',
      accessTokenVenceEn: ahora + 100_000, refreshTokenVenceEn: ahora + 300_000 } });
    const uno = crear(); const dos = crear(); vi.stubGlobal('fetch', async () => Response.json({ ok: true }));
    const app = construirApp({ config, auth: { sesiones } });
    const encabezados = (id: string) => ({ host: 'localhost:8083', cookie: `m2_sesion=${id}` });
    try {
      await app.inject({ url: '/api/v1/clientes/dato-personal?nombre=privado', headers: encabezados(uno) });
      const propio = await app.inject({ url: '/panel/pedidos', headers: encabezados(uno) });
      expect(propio.json().pedidos).toHaveLength(1); expect(propio.body).not.toMatch(/dato-personal|privado|secreto/);
      expect((await app.inject({ url: '/panel/pedidos', headers: encabezados(dos) })).json().pedidos).toEqual([]);
      for (const url of ['/panel/demo', '/panel/m6', '/panel/docker']) expect((await app.inject({ url, headers: encabezados(uno) })).statusCode).toBe(404);
    } finally { await app.close(); }
  });
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
        expect((await app.inject({ method: 'POST', url: '/api/v1/clientes', headers: { ...headers, ...extra }, payload: '{}' })).json())
          .toMatchObject({ status: 403, type: '/panel/errores/identidad-no-admitida' });
      }
      const respuesta = await app.inject({ method: 'POST', url: '/api/v1/clientes', headers, payload: '{ "nombre": "persona" }' });
      expect(respuesta.statusCode).toBe(401); expect(respuesta.json().type).toBe('rechazo-m2'); expect(pedir).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });
});
