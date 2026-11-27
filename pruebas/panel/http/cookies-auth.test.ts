import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearCookiesAuth } from '../../../panel/servidor/auth/cookies.js';
import { nuevoIdentificador } from '../../../panel/servidor/auth/almacen.js';
import { crearAlmacenSesiones } from '../../../panel/servidor/auth/sesiones.js';
import { crearAlmacenTransacciones } from '../../../panel/servidor/auth/transacciones.js';
import { registrarSeguridad } from '../../../panel/servidor/seguridad.js';

const abiertas: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(abiertas.splice(0).map((app) => app.close())); });

const DATOS = () => ({ sub: 'cliente-1', roles: ['CLIENTE'], scopes: ['clientes:read'],
  credenciales: { accessToken: 'access-no-exponer', refreshToken: 'refresh-no-exponer',
    accessTokenVenceEn: Date.now() + 60_000, refreshTokenVenceEn: Date.now() + 3600_000 } });

function crear(origenPublico = 'http://localhost:8083') {
  const app = Fastify(); abiertas.push(app);
  const sesiones = crearAlmacenSesiones(); const transacciones = crearAlmacenTransacciones();
  app.addHook('onClose', async () => { sesiones.cerrar(); transacciones.cerrar(); });
  const cookies = crearCookiesAuth({ origenPublico });
  registrarSeguridad(app, { origenPublico });
  const ejecutada = vi.fn();
  // Rutas de prueba del transporte: no implementan ni sustituyen la validación de identidad OIDC de T5/T6.
  app.post('/emitir', (_request, reply) => {
    ejecutada(); cookies.emitirSesion(reply, DATOS(), sesiones); return { estado: 'ok' };
  });
  app.get('/sesion', (request, reply) => {
    const actual = cookies.leerSesion(request, sesiones);
    return actual ? { sub: actual.sesion.sub } : reply.code(401).send({ estado: 'sin-sesion' });
  });
  app.post('/vinculo', (_request, reply) => {
    const transaccion = transacciones.crear({ tipo: 'ingreso', nonce: 'nonce-no-exponer', verifier: 'verifier-no-exponer', retorno: '/' });
    cookies.establecerTransaccion(reply, transaccion.vinculo); return { state: transaccion.state };
  });
  app.get('/auth/retorno', (request, reply) => {
    const state = (request.query as { state?: string }).state;
    const actual = transacciones.consumir(state, cookies.leerTransaccion(request));
    return actual ? { estado: 'ok' } : reply.code(400).send({ estado: 'retorno-invalido' });
  });
  app.post('/ambas', (_request, reply) => {
    cookies.emitirSesion(reply, DATOS(), sesiones);
    cookies.establecerTransaccion(reply, nuevoIdentificador()); return { estado: 'ok' };
  });
  app.post('/borrar', (_request, reply) => {
    cookies.borrarSesion(reply); cookies.borrarTransaccion(reply); return { estado: 'ok' };
  });
  app.post('/vinculo-invalido', (request, reply) => {
    cookies.establecerTransaccion(reply, (request.body as { vinculo: string }).vinculo); return { estado: 'ok' };
  });
  const propio = new URL(origenPublico);
  const headers = { host: propio.host, origin: propio.origin };
  return { app, sesiones, cookies, ejecutada, headers };
}

function valores(respuesta: { headers: Record<string, unknown> }): string[] {
  const cookie = respuesta.headers['set-cookie'];
  return Array.isArray(cookie) ? cookie as string[] : typeof cookie === 'string' ? [cookie] : [];
}

describe('cookies de sesión y transacción (083/T3)', () => {
  it.each(['http://localhost:8083', 'http://127.0.0.1:8083', 'http://[::1]:8083', 'https://app.ejemplo.test'])(
    'usa HttpOnly, Lax y Path=/ sin Domain; Secure depende de %s', async (origen) => {
      const { app, headers } = crear(origen);
      const respuesta = await app.inject({ method: 'POST', url: '/ambas', headers });
      expect(respuesta.statusCode).toBe(200);
      const emitidas = valores(respuesta); expect(emitidas).toHaveLength(2);
      expect(emitidas[0]).toMatch(/^m2_sesion=[A-Za-z0-9_-]{43};/);
      expect(emitidas[1]).toMatch(/^m2_transaccion=[A-Za-z0-9_-]{43};/);
      for (const cookie of emitidas) {
        expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Lax'); expect(cookie).toContain('Path=/');
        expect(cookie).not.toMatch(/Domain=/i);
        expect(cookie.includes('; Secure')).toBe(origen.startsWith('https:'));
        for (const secreto of ['access-no-exponer', 'refresh-no-exponer', 'cliente-1', 'nonce-no-exponer', 'verifier-no-exponer']) {
          expect(cookie).not.toContain(secreto); expect(respuesta.body).not.toContain(secreto);
        }
      }
      expect(emitidas[1]).toContain('Max-Age=300');
    },
  );

  it('reconoce una sesión emitida por el servidor usando solo su cookie', async () => {
    const { app, headers } = crear();
    const alta = await app.inject({ method: 'POST', url: '/emitir', headers });
    const cookie = valores(alta)[0].split(';')[0];
    const consulta = await app.inject({ method: 'GET', url: '/sesion', headers: { host: headers.host, cookie } });
    expect(consulta.statusCode).toBe(200); expect(consulta.json()).toEqual({ sub: 'cliente-1' });
  });

  it('emite un identificador nuevo aunque el navegador aporte uno conocido en cookie, cuerpo o encabezado', async () => {
    const { app, headers, sesiones } = crear(); const previo = sesiones.crear(DATOS());
    const respuesta = await app.inject({ method: 'POST', url: `/emitir?sesion=${previo}`,
      headers: { ...headers, cookie: `m2_sesion=${previo}`, 'x-panel-sub': previo }, payload: { sesion: previo } });
    expect(respuesta.statusCode).toBe(200);
    expect(valores(respuesta)[0]).not.toContain(previo);
    const nueva = valores(respuesta)[0].split(';')[0];
    expect((await app.inject({ method: 'GET', url: '/sesion', headers: { host: headers.host, cookie: nueva } })).statusCode).toBe(200);
  });

  it('no acepta una cookie elegida por el cliente si no existe en el almacén', async () => {
    const { app, headers, sesiones } = crear();
    const respuesta = await app.inject({ method: 'GET', url: '/sesion', headers: { host: headers.host, cookie: `m2_sesion=${nuevoIdentificador()}` } });
    expect(respuesta.statusCode).toBe(401); expect(sesiones.cantidad()).toBe(0);
    expect(respuesta.headers['set-cookie']).toBeUndefined();
  });

  it('no toma la identidad de query, Authorization ni encabezados de desarrollo', async () => {
    const { app, headers, sesiones } = crear(); const id = sesiones.crear(DATOS());
    const respuesta = await app.inject({ method: 'GET', url: `/sesion?m2_sesion=${id}`,
      headers: { host: headers.host, authorization: `Bearer ${id}`, 'x-panel-sub': id, 'x-panel-rol': 'OPERADOR' } });
    expect(respuesta.statusCode).toBe(401);
  });

  it.each(['m2_sesion=; m2_sesion=ID', 'm2_sesion=ID; m2_sesion=ID',
    'm2_sesion=%49D', 'm2_sesion="ID"', 'm2_sesion=ID=', 'otra=ID', 'm2_sesion=incorrecta'])(
    'rechaza una cookie duplicada, codificada o mal formada (%s)', async (plantilla) => {
      const { app, headers, sesiones } = crear(); const id = sesiones.crear(DATOS());
      const cookie = plantilla.replaceAll('ID', id);
      const respuesta = await app.inject({ method: 'GET', url: '/sesion', headers: { host: headers.host, cookie } });
      expect(respuesta.statusCode).toBe(401);
      expect(sesiones.obtener(id)).toBeDefined();
    },
  );

  it('lee su cookie junto a cookies ajenas sin confundir nombres', async () => {
    const { app, headers, sesiones } = crear(); const id = sesiones.crear(DATOS());
    const respuesta = await app.inject({ method: 'GET', url: '/sesion',
      headers: { host: headers.host, cookie: `otra=x; m2_sesion=${id}; otra_m2_sesion=y` } });
    expect(respuesta.statusCode).toBe(200);
  });

  it.each(['http://localhost:8083', 'https://app.ejemplo.test'])('borra ambas cookies con el mismo alcance (%s)', async (origen) => {
    const { app, headers } = crear(origen);
    const respuesta = await app.inject({ method: 'POST', url: '/borrar', headers });
    expect(respuesta.statusCode).toBe(200); expect(valores(respuesta)).toHaveLength(2);
    for (const cookie of valores(respuesta)) {
      expect(cookie).toContain('=;'); expect(cookie).toContain('Max-Age=0');
      expect(cookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
      expect(cookie).toContain('Path=/'); expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Lax');
      expect(cookie.includes('; Secure')).toBe(origen.startsWith('https:'));
      expect(cookie).not.toMatch(/Domain=/i);
    }
  });

  it('vincula el retorno a la cookie del navegador y no consume el state con otra cookie', async () => {
    const { app, headers } = crear();
    const inicio = await app.inject({ method: 'POST', url: '/vinculo', headers });
    const state = inicio.json().state as string; const cookie = valores(inicio)[0].split(';')[0];
    const url = `/auth/retorno?state=${state}`;
    for (const ajena of ['', `m2_transaccion=${nuevoIdentificador()}`, `${cookie}; ${cookie}`]) {
      expect((await app.inject({ method: 'GET', url, headers: { host: headers.host, cookie: ajena } })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: 'GET', url, headers: { host: headers.host, cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url, headers: { host: headers.host, cookie } })).statusCode).toBe(400);
  });

  it('Secure se decide por la configuración y no por encabezados reenviados', async () => {
    for (const origen of ['http://localhost:8083', 'https://app.ejemplo.test']) {
      const { app, headers } = crear(origen);
      const respuesta = await app.inject({ method: 'POST', url: '/emitir',
        headers: { ...headers, 'x-forwarded-proto': origen.startsWith('https:') ? 'http' : 'https' } });
      expect(valores(respuesta)[0].includes('; Secure')).toBe(origen.startsWith('https:'));
    }
  });

  it('no serializa caracteres arbitrarios ni incluye el valor inválido en errores', async () => {
    const { app, headers } = crear(); const secreto = 'valor-secreto; Domain=ajeno.test';
    const respuesta = await app.inject({ method: 'POST', url: '/vinculo-invalido', headers, payload: { vinculo: secreto } });
    expect(respuesta.statusCode).toBe(500); expect(respuesta.headers['set-cookie']).toBeUndefined();
    expect(respuesta.body).not.toContain(secreto);
  });
});

describe('origen público del frontend (083/T3)', () => {
  it.each([undefined, 'null', 'http://ajeno.test', 'http://localhost:8083.ajeno.test',
    'https://localhost:8083', 'http://localhost:8084', 'http://localhost:8083/',
    'http://localhost:8083?retorno=ajeno', 'http://localhost:8083 http://ajeno.test'])(
    'rechaza POST sin origen propio (%s) antes de leer cuerpo o ejecutar la ruta', async (origin) => {
      const { app, headers, ejecutada } = crear();
      const respuesta = await app.inject({ method: 'POST', url: '/emitir',
        headers: { host: headers.host, ...(origin === undefined ? {} : { origin }), 'content-type': 'application/json' }, payload: '{malformado' });
      expect(respuesta.statusCode).toBe(403);
      expect(respuesta.json()).toMatchObject({ type: '/panel/errores/origen-no-permitido' });
      expect(ejecutada).not.toHaveBeenCalled(); expect(respuesta.headers['set-cookie']).toBeUndefined();
    },
  );

  it.each(['app.ejemplo.test.ajeno.test', 'app.ejemplo.test:444', 'localhost:8083', 'app.ejemplo.test@ajeno.test'])(
    'rechaza Host ajeno %s aunque Origin y X-Forwarded-Host sean propios', async (host) => {
      const { app, headers, ejecutada } = crear('https://app.ejemplo.test');
      const respuesta = await app.inject({ method: 'POST', url: '/emitir',
        headers: { ...headers, host, 'x-forwarded-host': headers.host } });
      expect(respuesta.statusCode).toBe(403);
      expect(respuesta.json()).toMatchObject({ type: '/panel/errores/host-no-permitido' });
      expect(ejecutada).not.toHaveBeenCalled();
    },
  );

  it('un Referer propio no reemplaza al Origin ausente', async () => {
    const { app, headers, ejecutada } = crear();
    const respuesta = await app.inject({ method: 'POST', url: '/emitir', headers: { host: headers.host, referer: `${headers.origin}/` } });
    expect(respuesta.statusCode).toBe(403); expect(ejecutada).not.toHaveBeenCalled();
  });

  it.each(['PUT', 'PATCH', 'DELETE'] as const)('protege también las escrituras %s', async (method) => {
    const { app, headers } = crear();
    const respuesta = await app.inject({ method, url: '/inexistente', headers: { ...headers, origin: 'http://ajeno.test' } });
    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json()).toMatchObject({ type: '/panel/errores/origen-no-permitido' });
  });

  it('compara Host sin distinguir mayúsculas y no acepta encabezados reenviados como origen', async () => {
    const { app, headers } = crear('https://app.ejemplo.test');
    const respuesta = await app.inject({ method: 'POST', url: '/emitir', headers: { ...headers, host: 'APP.EJEMPLO.TEST' } });
    expect(respuesta.statusCode).toBe(200);
    const ajena = await app.inject({ method: 'POST', url: '/emitir',
      headers: { host: headers.host, 'x-forwarded-host': headers.host, 'x-forwarded-proto': 'https' } });
    expect(ajena.statusCode).toBe(403);
  });

  it('protege también rutas inexistentes y no habilita CORS', async () => {
    const { app, headers } = crear();
    const respuesta = await app.inject({ method: 'POST', url: '/inexistente', headers: { host: headers.host, origin: 'http://ajeno.test' } });
    expect(respuesta.statusCode).toBe(403); expect(respuesta.headers['access-control-allow-origin']).toBeUndefined();
  });
});
