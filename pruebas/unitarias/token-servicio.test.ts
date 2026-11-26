import { decodeProtectedHeader, jwtVerify } from 'jose';
import { createServer } from 'node:net';
import { inspect } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearTokenServicio, crearTokenServicioHs256 } from '../../src/auth/token-servicio.js';
import { ErrorDeIntegracion, ModuloNoDisponible } from '../../src/errores.js';
import { CONFIG } from '../ayudas/app.js';
import { crearServidorModulo, type Comportamiento } from '../ayudas/servidor-modulo.js';

// Una URL a la que no escucha nadie: el puerto que acaba de dejar libre un servidor que se cerró.
async function urlSinServidor(): Promise<string> {
  const servidor = createServer();
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const { port } = servidor.address() as { port: number };
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

// El token con el que M2 se presenta ante M6 (spec 125). Sin las variables de Keycloak es el HS256 de siempre (RF-2.4.11.2): uno
// nuevo en cada pedido, que nunca se guarda ni se reutiliza.
describe('token de servicio HS256 (spec 125, RF-2.4.11.2)', () => {
  const config = { ...CONFIG, audienciaM6: 'm6-de-prueba' };

  // Como lo verificaría M6: con la clave del consorcio, el emisor de M1 y su propia audiencia.
  const comoM6 = (token: string) =>
    jwtVerify(token, new TextEncoder().encode(config.claveTokens), {
      algorithms: ['HS256'],
      issuer: config.emisorTokens,
      audience: 'm6-de-prueba',
      requiredClaims: ['exp'],
    });

  it('es el modo hs256', () => {
    expect(crearTokenServicioHs256(config).modo).toBe('hs256');
  });

  it('da el token de RF-2.4.11: HS256, sub m2-clientes, roles SERVICIO, la audiencia de M6 y 60 s de vida', async () => {
    const { token, reutilizado } = await crearTokenServicioHs256(config).obtener('id-de-correlacion');

    expect(reutilizado).toBe(false);
    expect(decodeProtectedHeader(token)).toStrictEqual({ alg: 'HS256', typ: 'JWT' });
    const { payload } = await comoM6(token);
    expect(payload).toMatchObject({ sub: 'm2-clientes', roles: ['SERVICIO'], aud: 'm6-de-prueba' });
    expect(payload.exp! - payload.iat!).toBe(60);
  });

  it('cada pedido firma uno nuevo, nunca reutilizado, y descartar no cambia nada', async () => {
    const tokenServicio = crearTokenServicioHs256(config);

    const primero = await tokenServicio.obtener('id-1');
    tokenServicio.descartar(primero.token);
    const segundo = await tokenServicio.obtener('id-2');

    expect([primero.reutilizado, segundo.reutilizado]).toEqual([false, false]);
    await expect(comoM6(segundo.token)).resolves.toBeDefined();
  });

  it('sin las variables de Keycloak, crearTokenServicio elige el HS256', () => {
    expect(crearTokenServicio({ ...config, tokenServicio: undefined }).modo).toBe('hs256');
  });
});

// El pedido a Keycloak por `client_credentials` (spec 125, T3). `servidor-modulo.ts` hace de endpoint de tokens. Sin caché todavía:
// cada `obtener` hace su pedido (la caché llega en T4).
describe('token de servicio de Keycloak: el pedido (spec 125, RF-2.4.11.1, RF-2.4.11.6, RF-2.4.11.7, RF-2.4.11.10)', () => {
  const keycloak = crearServidorModulo();
  const TIEMPO_MS = 200;
  const CLIENTE = 'grupo-17';
  const SECRETO = 'secreto-de-prueba';
  const TOKEN = 'eyJ.token-de-keycloak.firma';
  const RESPUESTA_OK = { tipo: 'ok', cuerpo: { access_token: TOKEN, expires_in: 300, token_type: 'Bearer' } } as const;

  const tokenServicioDe = (cambios: Partial<{ cliente: string; secreto: string; urlTokens: string }> = {}) =>
    crearTokenServicio({
      ...CONFIG,
      audienciaM6: 'm6-de-prueba',
      tiempoModulosMs: TIEMPO_MS,
      reintentosModulos: 1,
      reintentarDespuesS: 7,
      tokenServicio: { urlTokens: `${keycloak.url}/realms/r/protocol/openid-connect/token`, cliente: CLIENTE, secreto: SECRETO, ...cambios },
    });

  // Lo que se espera cuando Keycloak no está disponible: el 503 genérico con el Retry-After configurado (RF-2.4.11.6).
  const noDisponible = {
    codigo: 503,
    type: 'about:blank',
    detail: 'Keycloak no está disponible',
    encabezados: { 'Retry-After': '7' },
  };

  beforeAll(async () => {
    await keycloak.levantar();
  });

  afterAll(async () => {
    await keycloak.cerrar();
  });

  it('con las tres variables es el modo keycloak', () => {
    expect(tokenServicioDe().modo).toBe('keycloak');
  });

  it('pide en formulario con grant_type=client_credentials y el cliente en Basic, y entrega el access_token tal cual', async () => {
    keycloak.responderCon(RESPUESTA_OK);

    const obtenido = await tokenServicioDe().obtener('id-1');

    expect(obtenido).toStrictEqual({ token: TOKEN, reutilizado: false });
    expect(keycloak.llamadas).toBe(1);
    expect(keycloak.metodoRecibido).toBe('POST');
    expect(keycloak.rutaRecibida).toBe('/realms/r/protocol/openid-connect/token');
    expect(keycloak.encabezadosRecibidos.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(keycloak.cuerpoRecibido.toString()).toBe('grant_type=client_credentials');
    expect(keycloak.autorizaciones[0]).toBe(`Basic ${Buffer.from(`${CLIENTE}:${SECRETO}`).toString('base64')}`);
  });

  it('codifica el cliente y el secreto como formulario antes de Basic (RFC 6749, 2.3.1)', async () => {
    keycloak.responderCon(RESPUESTA_OK);

    await tokenServicioDe({ cliente: 'un cliente', secreto: 'a:b%c&d' }).obtener('id-1');

    expect(keycloak.autorizaciones[0]).toBe(`Basic ${Buffer.from('un+cliente:a%3Ab%25c%26d').toString('base64')}`);
  });

  it('no mira el token: cualquier texto no vacío sirve (RF-2.4.11.10)', async () => {
    keycloak.responderCon({ tipo: 'ok', cuerpo: { access_token: 'no-es-un-jwt', expires_in: 1 } });

    await expect(tokenServicioDe().obtener('id-1')).resolves.toStrictEqual({ token: 'no-es-un-jwt', reutilizado: false });
  });

  it('un 5xx se reintenta una vez y vale el token del reintento', async () => {
    keycloak.responderCon([{ tipo: '5xx', estado: 502 }, RESPUESTA_OK]);

    await expect(tokenServicioDe().obtener('id-1')).resolves.toStrictEqual({ token: TOKEN, reutilizado: false });
    expect(keycloak.llamadas).toBe(2);
  });

  it('un corte por tiempo se reintenta una vez y vale el token del reintento', async () => {
    keycloak.responderCon([{ tipo: 'demora-cuerpo', retardoMs: TIEMPO_MS * 4, cuerpo: RESPUESTA_OK.cuerpo }, RESPUESTA_OK]);

    await expect(tokenServicioDe().obtener('id-1')).resolves.toStrictEqual({ token: TOKEN, reutilizado: false });
    expect(keycloak.llamadas).toBe(2);
  });

  it.each<[string, Comportamiento]>([
    ['un 5xx', { tipo: '5xx', estado: 500 }],
    ['un corte por tiempo', { tipo: 'cuelga' }],
    ['una conexión cortada', { tipo: 'corta' }],
    ['un 200 que no es JSON', { tipo: 'no-json' }],
    ['un 200 que no es un objeto', { tipo: 'ok', cuerpo: [TOKEN] }],
    ['un 200 sin access_token', { tipo: 'ok', cuerpo: { expires_in: 300 } }],
    ['un 200 con access_token vacío', { tipo: 'ok', cuerpo: { access_token: '', expires_in: 300 } }],
    ['un 200 con access_token que no es texto', { tipo: 'ok', cuerpo: { access_token: 123, expires_in: 300 } }],
    ['un 200 sin expires_in', { tipo: 'ok', cuerpo: { access_token: TOKEN } }],
    ['un 200 con expires_in 0', { tipo: 'ok', cuerpo: { access_token: TOKEN, expires_in: 0 } }],
    ['un 200 con expires_in negativo', { tipo: 'ok', cuerpo: { access_token: TOKEN, expires_in: -300 } }],
    ['un 200 con expires_in en texto', { tipo: 'ok', cuerpo: { access_token: TOKEN, expires_in: '300' } }],
    ['un 200 con expires_in decimal', { tipo: 'ok', cuerpo: { access_token: TOKEN, expires_in: 299.5 } }],
    ['un 204', { tipo: 'ok', estado: 204 }],
  ])('%s, dos veces, da 503 genérico con Retry-After tras un solo reintento', async (_caso, comportamiento) => {
    keycloak.responderCon(comportamiento);

    const error = await tokenServicioDe().obtener('id-1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ModuloNoDisponible);
    expect(error).toMatchObject(noDisponible);
    expect(keycloak.llamadas).toBe(2);
  });

  it('un Keycloak al que no se llega da 503 con Retry-After', async () => {
    const error = await tokenServicioDe({ urlTokens: `${await urlSinServidor()}/token` })
      .obtener('id-1')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ModuloNoDisponible);
    expect(error).toMatchObject(noDisponible);
  });

  it.each([400, 401, 403])('un %i es un rechazo: 500 sin reintento y sin el cuerpo de Keycloak (RF-2.4.11.7)', async (estado) => {
    keycloak.responderCon({ tipo: '4xx', estado, cuerpo: { error: 'unauthorized_client', error_description: 'secreto-en-el-cuerpo' } });

    const error = await tokenServicioDe().obtener('id-1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ErrorDeIntegracion);
    expect(error).toMatchObject({ codigo: 500, detail: 'Ocurrió un error interno' });
    expect((error as Error).cause).toBeInstanceOf(Error);
    expect(((error as Error).cause as Error).message).toBe(`Keycloak respondió ${estado}`);
    expect(inspect(error, { depth: 5 })).not.toContain('secreto-en-el-cuerpo');
    expect(keycloak.llamadas).toBe(1);
  });

  it('ningún error lleva el secreto del cliente (RNF-19)', async () => {
    keycloak.responderCon({ tipo: '5xx', estado: 503 });
    const noDisponibleError = await tokenServicioDe().obtener('id-1').catch((e: unknown) => e);
    keycloak.responderCon({ tipo: '4xx', estado: 401 });
    const rechazo = await tokenServicioDe().obtener('id-1').catch((e: unknown) => e);

    for (const error of [noDisponibleError, rechazo]) {
      expect(inspect(error, { depth: 5 })).not.toContain(SECRETO);
      expect(inspect(error, { depth: 5 })).not.toContain(Buffer.from(`${CLIENTE}:${SECRETO}`).toString('base64'));
    }
  });
});
