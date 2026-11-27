import { it, expect } from 'vitest';
import { construirApp } from '../../../panel/servidor/app.js';
import { cargarConfigPanel } from '../../../panel/servidor/config.js';
import { crearAlmacenSesiones } from '../../../panel/servidor/auth/sesiones.js';
import { crearAlmacenTransacciones } from '../../../panel/servidor/auth/transacciones.js';
import { capturarLogs } from '../../ayudas/logs.js';
const config = cargarConfigPanel({ PANEL_MODO_AUTH: 'oidc', PANEL_ORIGEN_PUBLICO: 'http://localhost:8083',
  PANEL_OIDC_EMISOR: 'http://localhost:8080/realms/prueba', PANEL_OIDC_URL_INTERNA: 'http://localhost:8080/realms/prueba', PANEL_TIEMPO_IDENTIDAD_MS: '50' }).config!;
const headers = { host: 'localhost:8083', origin: 'http://localhost:8083' };
it('el diagnóstico de sesión retiene las últimas 100 entradas según el plan', () => {
  const sesiones = crearAlmacenSesiones(); const ahora = Date.now();
  try {
    const id = sesiones.crear({ sub: 'usuario', roles: [], scopes: [], credenciales: { accessToken: 'secreto', refreshToken: 'secreto',
      accessTokenVenceEn: ahora + 60_000, refreshTokenVenceEn: ahora + 300_000 } });
    for (let n = 0; n < 101; n++) sesiones.registrarPedido(id, { requestId: String(n), hora: '', metodo: 'GET', ruta: '/health', encabezados: {}, conToken: true, estado: 200, duracionMs: 0 });
    const pedidos = sesiones.obtener(id)!.pedidos!;
    expect(pedidos).toHaveLength(100); expect(pedidos[0].requestId).toBe('100'); expect(pedidos.at(-1)!.requestId).toBe('1');
  } finally { sesiones.cerrar(); }
});
it.each(['error', 'timeout', '503'])('Keycloak caído (%s): ingreso vuelve con aviso y cierre invalida antes de comprobar disponibilidad', async (modo) => {
  const sesiones = crearAlmacenSesiones(); const transacciones = crearAlmacenTransacciones();
  const ahora = Date.now(); const id = sesiones.crear({ sub: 'usuario', roles: [], scopes: [], credenciales: {
    accessToken: 'secreto', refreshToken: 'secreto', accessTokenVenceEn: ahora + 60_000, refreshTokenVenceEn: ahora + 300_000 } });
  let cerrando = false; let pedidos = 0; const logs = capturarLogs();
  const app = construirApp({ config, flujoLog: logs.flujo, auth: { sesiones, transacciones, pedir: async (url, opciones) => {
    pedidos++; expect(String(url)).toContain('/.well-known/openid-configuration');
    expect(opciones?.signal).toBeInstanceOf(AbortSignal);
    if (cerrando) expect(sesiones.obtener(id)).toBeUndefined();
    if (modo === '503') return new Response('secreto', { status: 503 });
    if (modo === 'timeout') await new Promise((_, rechazar) => opciones!.signal!.addEventListener('abort', () => rechazar(new Error('secreto')), { once: true }));
    throw new Error('secreto');
  } } });
  try {
    const ingreso = await app.inject({ method: 'POST', url: '/auth/iniciar', headers });
    expect(ingreso.headers.location).toBe('/?acceso=no-disponible'); expect(transacciones.cantidad()).toBe(0);
    cerrando = true;
    const salida = await app.inject({ method: 'POST', url: '/auth/cerrar', headers: { ...headers, cookie: `m2_sesion=${id}` } });
    expect(salida.headers.location).toBe('/?salida=no-confirmada'); expect(sesiones.obtener(id)).toBeUndefined();
    expect(salida.cookies.find(c => c.name === 'm2_sesion')?.value).toBe('');
    expect(pedidos).toBe(2); expect(logs.texto()).not.toContain('secreto');
  } finally { await app.close(); }
});
