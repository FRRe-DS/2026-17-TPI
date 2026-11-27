import Fastify from 'fastify';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { construirApp } from '../../../panel/servidor/app.js';
import { cargarConfigPanel, type ConfigPanelOidc } from '../../../panel/servidor/config.js';
import { registrarEncabezadosDeSeguridad, POLITICA_DE_SEGURIDAD } from '../../../panel/servidor/estaticos.js';
import { registrarSeguridad } from '../../../panel/servidor/seguridad.js';
import { registrarInicioAuth } from '../../../panel/servidor/auth/rutas.js';
import { crearAlmacenTransacciones } from '../../../panel/servidor/auth/transacciones.js';
import { capturarLogs } from '../../ayudas/logs.js';

const ENV = { PANEL_MODO_AUTH: 'oidc', PANEL_ORIGEN_PUBLICO: 'http://localhost:8083',
  PANEL_OIDC_EMISOR: 'http://localhost:8080/realms/movilidad', PANEL_OIDC_URL_INTERNA: 'http://keycloak:8080/realms/movilidad' };
const resultado = cargarConfigPanel(ENV);
if (!resultado.config || resultado.config.modoAuth !== 'oidc') throw new Error('Configuración OIDC de prueba inválida');
const CONFIG: ConfigPanelOidc = resultado.config;
const HEADERS = { host: 'localhost:8083', origin: 'http://localhost:8083' };
const abiertas: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(abiertas.splice(0).map((app) => app.close())); });

function crear() {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } } });
  abiertas.push(app);
  const transacciones = crearAlmacenTransacciones();
  app.addHook('onClose', async () => transacciones.cerrar());
  registrarSeguridad(app, CONFIG); registrarEncabezadosDeSeguridad(app, CONFIG);
  app.register(registrarInicioAuth, { config: CONFIG, transacciones, comprobarIdentidad: async () => {} });
  return { app, transacciones };
}

function vinculoDe(respuesta: { headers: Record<string, unknown> }): string {
  const valor = respuesta.headers['set-cookie'];
  const cookie = Array.isArray(valor) ? valor[0] as string : valor as string;
  return cookie.split(';')[0].slice('m2_transaccion='.length);
}

describe('POST /auth/iniciar (083/T4)', () => {
  it('redirige al endpoint público con PKCE S256 y guarda el verifier solo en el servidor', async () => {
    const { app, transacciones } = crear();
    const respuesta = await app.inject({ method: 'POST', url: '/auth/iniciar', headers: HEADERS });
    expect(respuesta.statusCode).toBe(303);
    expect(respuesta.headers['cache-control']).toBe('no-store');
    const destino = new URL(respuesta.headers.location!);
    expect(destino.origin + destino.pathname).toBe(`${CONFIG.oidcEmisor}/protocol/openid-connect/auth`);
    expect(Object.fromEntries(destino.searchParams)).toMatchObject({ response_type: 'code', client_id: 'm2-front',
      redirect_uri: 'http://localhost:8083/auth/retorno', code_challenge_method: 'S256',
      scope: 'openid clientes:read clientes:write clientes.estado:read' });
    const state = destino.searchParams.get('state')!; const nonce = destino.searchParams.get('nonce')!;
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const transaccion = transacciones.consumir(state, vinculoDe(respuesta));
    expect(transaccion).toMatchObject({ tipo: 'ingreso', nonce, retorno: '/' });
    if (transaccion?.tipo !== 'ingreso') throw new Error('Falta transacción de ingreso');
    expect(transaccion.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(destino.searchParams.get('code_challenge')).toBe(createHash('sha256').update(transaccion.verifier).digest('base64url'));
    expect(destino.searchParams.has('code_verifier')).toBe(false);
    expect(JSON.stringify(respuesta.headers) + respuesta.body).not.toContain(transaccion.verifier);
    expect(transacciones.consumir(state, vinculoDe(respuesta))).toBeUndefined();
  });

  it('cada inicio usa una transacción, nonce y challenge nuevos', async () => {
    const { app } = crear();
    const primera = await app.inject({ method: 'POST', url: '/auth/iniciar', headers: HEADERS });
    const segunda = await app.inject({ method: 'POST', url: '/auth/iniciar', headers: { ...HEADERS, cookie: `m2_transaccion=${vinculoDe(primera)}` } });
    const a = new URL(primera.headers.location!); const b = new URL(segunda.headers.location!);
    for (const campo of ['state', 'nonce', 'code_challenge']) expect(a.searchParams.get(campo)).not.toBe(b.searchParams.get(campo));
    expect(vinculoDe(primera)).not.toBe(vinculoDe(segunda));
  });

  it.each(['', 'retorno=%2F'])('admite un formulario de navegador con retorno local (%s)', async (payload) => {
    const { app } = crear();
    const respuesta = await app.inject({ method: 'POST', url: '/auth/iniciar',
      headers: { ...HEADERS, 'content-type': 'application/x-www-form-urlencoded' }, payload });
    expect(respuesta.statusCode).toBe(303);
  });

  it.each(['https://ajeno.test', '//ajeno.test', '/%2f%2fajeno.test', '/\\ajeno.test', '/?retorno=https://ajeno.test'])(
    'rechaza un retorno no permitido (%s) sin crear una transacción', async (retorno) => {
      const { app, transacciones } = crear();
      const respuesta = await app.inject({ method: 'POST', url: '/auth/iniciar', headers: HEADERS, payload: { retorno } });
      expect(respuesta.statusCode).toBe(400); expect(transacciones.cantidad()).toBe(0);
      expect(respuesta.headers.location).toBeUndefined(); expect(respuesta.headers['set-cookie']).toBeUndefined();
    },
  );

  it.each(['retorno=%2F&retorno=https%3A%2F%2Fajeno.test', 'password=no-publicar', 'client_id=ajeno'])(
    'rechaza parámetros de formulario duplicados o ajenos (%s)', async (payload) => {
      const { app, transacciones } = crear();
      const respuesta = await app.inject({ method: 'POST', url: '/auth/iniciar',
        headers: { ...HEADERS, 'content-type': 'application/x-www-form-urlencoded' }, payload });
      expect(respuesta.statusCode).toBe(400); expect(transacciones.cantidad()).toBe(0);
      expect(respuesta.body).not.toContain('no-publicar');
    },
  );

  it('no permite que JSON ni query cambien el cliente, el callback o la identidad', async () => {
    const { app, transacciones } = crear();
    for (const payload of [{ client_id: 'ajeno' }, { redirect_uri: 'https://ajeno.test' }, { sub: 'otro' }, { password: 'no-publicar' }]) {
      expect((await app.inject({ method: 'POST', url: '/auth/iniciar', headers: HEADERS, payload })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: 'POST', url: '/auth/iniciar?retorno=https://ajeno.test', headers: HEADERS })).statusCode).toBe(400);
    expect(transacciones.cantidad()).toBe(0);
  });

  it('rechaza un cuerpo demasiado grande y un GET no inicia autorización', async () => {
    const { app, transacciones } = crear();
    expect((await app.inject({ method: 'POST', url: '/auth/iniciar', headers: HEADERS, payload: { retorno: 'a'.repeat(2000) } })).statusCode).toBe(413);
    expect((await app.inject({ method: 'GET', url: '/auth/iniciar', headers: { host: HEADERS.host } })).statusCode).toBe(404);
    expect(transacciones.cantidad()).toBe(0);
  });

  it('rechaza el origen ajeno antes de crear state o cookie', async () => {
    const { app, transacciones } = crear();
    const respuesta = await app.inject({ method: 'POST', url: '/auth/iniciar', headers: { ...HEADERS, origin: 'http://ajeno.test' } });
    expect(respuesta.statusCode).toBe(403); expect(transacciones.cantidad()).toBe(0);
    expect(respuesta.headers.location).toBeUndefined(); expect(respuesta.headers['set-cookie']).toBeUndefined();
  });

  it('la capacidad agotada responde 503 controlado sin expulsar transacciones', async () => {
    const { app, transacciones } = crear();
    const primera = transacciones.crear({ tipo: 'salida', retorno: '/' });
    for (let i = 1; i < 1000; i++) transacciones.crear({ tipo: 'salida', retorno: '/' });
    const respuesta = await app.inject({ method: 'POST', url: '/auth/iniciar', headers: HEADERS });
    expect(respuesta.statusCode).toBe(503); expect(respuesta.headers['retry-after']).toBe('5');
    expect(respuesta.json()).toMatchObject({ type: '/panel/errores/identidad-no-disponible', status: 503 });
    expect(respuesta.headers['set-cookie']).toBeUndefined(); expect(respuesta.headers.location).toBeUndefined();
    expect(transacciones.cantidad()).toBe(1000);
    expect(transacciones.consumir(primera.state, primera.vinculo)).toEqual({ tipo: 'salida', retorno: '/' });
  });
});

describe('CSP e integración del modo real (083/T4)', () => {
  it('amplía solo form-action al origen público de Keycloak, también en errores y redirecciones', async () => {
    const { app } = crear();
    for (const respuesta of [await app.inject({ method: 'POST', url: '/auth/iniciar', headers: HEADERS }),
      await app.inject({ method: 'GET', url: '/inexistente', headers: { host: HEADERS.host } })]) {
      expect(respuesta.headers['content-security-policy']).toBe(`${POLITICA_DE_SEGURIDAD} http://localhost:8080`);
      expect(respuesta.headers['content-security-policy']).not.toContain('keycloak:8080');
      expect(respuesta.headers['x-content-type-options']).toBe('nosniff');
      expect(respuesta.headers['referrer-policy']).toBe(respuesta.statusCode === 303 ? 'no-referrer' : 'same-origin');
    }
  });

  it.each(['https://*.ejemplo.test/realms/movilidad', 'https://usuario:clave@id.test/realms/movilidad'])(
    'rechaza un emisor inseguro en configuración y CSP (%s)', (oidcEmisor) => {
      expect(cargarConfigPanel({ ...ENV, PANEL_OIDC_EMISOR: oidcEmisor }).config).toBeUndefined();
      const app = Fastify(); abiertas.push(app);
      expect(() => registrarEncabezadosDeSeguridad(app, { ...CONFIG, oidcEmisor })).toThrow('Emisor OIDC inválido para CSP');
    },
  );

  it('desarrollo conserva su CSP y no agrega el destino de Keycloak', async () => {
    const app = Fastify(); abiertas.push(app); registrarEncabezadosDeSeguridad(app);
    app.get('/', async () => ({ estado: 'ok' }));
    expect((await app.inject('/')).headers['content-security-policy']).toBe(POLITICA_DE_SEGURIDAD);
  });

  it('la app real protege cuenta y sesión, mantiene cerradas herramientas y no registra credenciales', async () => {
    const logs = capturarLogs(); const app = construirApp({ config: CONFIG, flujoLog: logs.flujo, auth: { comprobarIdentidad: async () => {} } }); abiertas.push(app);
    expect((await app.inject({ url: '/salud-panel', headers: { host: HEADERS.host } })).statusCode).toBe(200);
    const inicio = await app.inject({ method: 'POST', url: '/auth/iniciar', headers: HEADERS });
    expect(inicio.statusCode).toBe(303);
    for (const ruta of ['/api/v1/clientes', '/auth/sesion', '/panel/pedidos']) {
      expect((await app.inject({ url: ruta, headers: { host: HEADERS.host } })).statusCode).toBe(401);
    }
    const retorno = await app.inject({ url: '/auth/retorno', headers: { host: HEADERS.host } });
    expect(retorno.statusCode).toBe(303); expect(retorno.headers.location).toBe('/?acceso=invalido');
    for (const ruta of ['/panel/demo/estado', '/panel/m6/estado']) {
      expect((await app.inject({ url: ruta, headers: { host: HEADERS.host } })).statusCode).toBe(404);
    }
    expect(logs.texto()).not.toContain(vinculoDe(inicio));
    expect(logs.texto()).not.toContain(inicio.headers.location);
    expect(inicio.headers['x-request-id']).toMatch(/^panel-/);
  });
});
