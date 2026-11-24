import { describe, it, expect, vi } from 'vitest';
import { construirApp } from '../../../panel/servidor/app.js';
import { cargarConfigPanel } from '../../../panel/servidor/config.js';
import { crearAlmacenSesiones } from '../../../panel/servidor/auth/sesiones.js';
import { IdentidadNoDisponible } from '../../../panel/servidor/auth/validacion.js';
import { SesionRechazada } from '../../../panel/servidor/auth/oidc.js';
const config = cargarConfigPanel({ PANEL_MODO_AUTH: 'oidc', PANEL_ORIGEN_PUBLICO: 'http://localhost:8083',
  PANEL_OIDC_EMISOR: 'http://localhost:8080/realms/prueba', PANEL_OIDC_URL_INTERNA: 'http://localhost:8080/realms/prueba' }).config!;
const headers = { host: 'localhost:8083', origin: 'http://localhost:8083' };
describe('consulta y cierre de sesión real', () => {
  it('expone identidad mínima, no credenciales, sin prolongar actividad', async () => {
    const sesiones = crearAlmacenSesiones(); const ahora = Date.now();
    const id = sesiones.crear({ sub: 'usuario', roles: ['CLIENTE'], scopes: ['clientes:read'], credenciales: {
      accessToken: 'acceso-secreto', refreshToken: 'refresh-secreto', accessTokenVenceEn: ahora + 100_000, refreshTokenVenceEn: ahora + 300_000 } });
    const app = construirApp({ config, auth: { sesiones } });
    try {
      const antes = sesiones.obtener(id)!.ultimaActividadEn;
      const respuesta = await app.inject({ url: '/auth/sesion', headers: { ...headers, cookie: `m2_sesion=${id}` } });
      expect(respuesta.statusCode).toBe(200); expect(respuesta.json()).toEqual({ sub: 'usuario', roles: ['CLIENTE'], scopes: ['clientes:read'] });
      expect(respuesta.headers['cache-control']).toBe('no-store'); expect(respuesta.body).not.toContain('secreto');
      expect(sesiones.obtener(id)!.ultimaActividadEn).toBe(antes);
      expect((await app.inject({ url: '/auth/sesion', headers })).statusCode).toBe(401);
    } finally { await app.close(); }
  });
  it.each([new IdentidadNoDisponible(), new SesionRechazada()])('clasifica fallas de renovación: %s', async (falla) => {
    const sesiones = crearAlmacenSesiones(); const ahora = Date.now();
    const id = sesiones.crear({ sub: 'usuario', roles: [], scopes: [], credenciales: {
      accessToken: 'secreto', refreshToken: 'secreto', accessTokenVenceEn: ahora - 1, refreshTokenVenceEn: ahora + 300_000 } });
    const app = construirApp({ config, auth: { sesiones, oidc: { ingresar: vi.fn(), renovar: async () => { throw falla; } } } });
    try {
      const respuesta = await app.inject({ url: '/auth/sesion', headers: { ...headers, cookie: `m2_sesion=${id}` } });
      expect(respuesta.statusCode).toBe(falla instanceof SesionRechazada ? 401 : 503);
    } finally { await app.close(); }
  });
});
