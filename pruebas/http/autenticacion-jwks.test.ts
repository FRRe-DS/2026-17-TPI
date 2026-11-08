import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Manejador } from '../../src/contrato/operaciones.js';
import { crearApp } from '../ayudas/app.js';
import { armarTokenRsa, crearClave, jwksDe } from '../ayudas/jwks.js';
import { crearServidorModulo } from '../ayudas/servidor-modulo.js';
import { armarToken, SUB_DE_PRUEBA } from '../ayudas/tokens.js';

// La app armada en modo `jwks` (RNF-12.11, RNF-12.15, RNF-12.18, RNF-07.12): `construirApp` crea el verificador según el modo y
// se lo pasa a `registrarPermisos`. El modo `hs256` lo prueban autenticacion.test.ts, tokens.test.ts y permisos.test.ts, que no
// cambian.
const servidor = crearServidorModulo();
const clave = crearClave();
const JWKS = jwksDe(clave);

const PROBLEMA_JSON = /^application\/problem\+json/;
const RETRY_AFTER_S = 9;

const quien: Manejador = async (request) => ({ identidad: request.identidad });
const salud: Manejador = async () => ({ estado: 'UP' });
const MANEJADORES = {
  probarProtegida: quien,
  probarSinRoles: quien,
  probarPublica: quien,
  probarListado: quien,
  probarAlta: quien,
  probarParametros: quien,
  verificarSalud: salud,
};

const appJwks = () =>
  crearApp(MANEJADORES, {
    config: {
      modoTokens: 'jwks',
      urlJwks: `${servidor.url}/certs`,
      tiempoModulosMs: 150,
      reintentosModulos: 1,
      reintentarDespuesS: RETRY_AFTER_S,
    },
  });

const pedir = (authorization?: string, url = '/pruebas/protegida', app = appJwks()) =>
  app.inject({ method: 'GET', url, headers: authorization === undefined ? {} : { authorization } });

function esProblema(respuesta: LightMyRequestResponse, status: number, title: string, detail: string, instance: string) {
  expect(respuesta.statusCode).toBe(status);
  expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
  expect(respuesta.json()).toEqual({ type: 'about:blank', title, status, detail, instance });
}

beforeAll(async () => {
  await servidor.levantar();
});

afterAll(async () => {
  await servidor.cerrar();
});

beforeEach(() => {
  servidor.responderCon({ tipo: 'ok', cuerpo: JWKS });
});

describe('app en modo jwks: un token RS256 válido llega al manejador con su identidad (RNF-12.11)', () => {
  it('con su sub, sus roles y sus scopes', async () => {
    const token = armarTokenRsa(clave, { claims: { roles: ['OPERADOR'], scope: 'clientes:read' } });
    const respuesta = await pedir(`Bearer ${token}`);

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({
      identidad: { sub: SUB_DE_PRUEBA, roles: ['OPERADOR'], scopes: ['clientes:read'] },
    });
  });

  it('la autorización por rol sigue andando: un rol que la operación no permite da 403', async () => {
    const respuesta = await pedir(`Bearer ${armarTokenRsa(clave, { claims: { roles: ['CONDUCTOR'] } })}`);
    esProblema(respuesta, 403, 'Sin permiso', 'El rol del token no permite esta operación', '/pruebas/protegida');
  });

  it('las claves se piden una vez y no en cada solicitud', async () => {
    const app = appJwks();
    await pedir(`Bearer ${armarTokenRsa(clave)}`, '/pruebas/protegida', app);
    await pedir(`Bearer ${armarTokenRsa(clave)}`, '/pruebas/protegida', app);
    expect(servidor.llamadas).toBe(1);
  });
});

describe('app en modo jwks: 401 si el token no sirve (RNF-12.12)', () => {
  const CASOS: [string, () => string | undefined, string][] = [
    ['sin el encabezado Authorization', () => undefined, 'Falta el token'],
    ['con un esquema que no es Bearer', () => 'Basic dXN1YXJpbzpjbGF2ZQ==', 'Falta el token'],
    ['con algo que no es un token', () => 'Bearer esto-no-es-un-token', 'El token está mal formado'],
    [
      'con un token vencido',
      () => `Bearer ${armarTokenRsa(clave, { claims: { exp: 1000 } })}`,
      'El token venció',
    ],
    [
      'con otro emisor',
      () => `Bearer ${armarTokenRsa(clave, { claims: { iss: 'otro-emisor' } })}`,
      'El emisor del token no es el esperado',
    ],
    [
      'firmado con otra clave',
      () => `Bearer ${armarTokenRsa(crearClave(clave.kid))}`,
      'El token no está firmado con RS256 y una clave del servicio de identidad',
    ],
    [
      'un HS256 firmado con la clave compartida de M2',
      () => `Bearer ${armarToken({ cabecera: { kid: clave.kid } })}`,
      'El token no está firmado con RS256 y una clave del servicio de identidad',
    ],
    [
      'con un kid que Keycloak no publica',
      () => `Bearer ${armarTokenRsa(crearClave('clave-que-no-esta'))}`,
      'El kid del token no está entre las claves del servicio de identidad',
    ],
  ];

  it.each(CASOS)('%s: 401 con WWW-Authenticate y el motivo, sin repetir el token', async (_caso, authorization, motivo) => {
    const valor = authorization();
    const respuesta = await pedir(valor, '/pruebas/protegida?x=1');

    esProblema(respuesta, 401, 'No autenticado', motivo, '/pruebas/protegida');
    expect(respuesta.headers['www-authenticate']).toBe('Bearer');
    const token = valor?.replace(/^Bearer /, '') ?? '';
    for (const parte of [token, ...token.split('.')].filter((texto) => texto.length > 8)) {
      expect(respuesta.body).not.toContain(parte);
    }
  });
});

describe('app en modo jwks: Keycloak caído y sin claves (RNF-13.10)', () => {
  it('responde 503 genérico con Retry-After, y no 401, porque el token puede ser válido', async () => {
    servidor.responderCon({ tipo: '5xx', estado: 500 });
    const respuesta = await pedir(`Bearer ${armarTokenRsa(clave)}`);

    esProblema(respuesta, 503, 'Servicio no disponible', 'El servicio de identidad no está disponible', '/pruebas/protegida');
    expect(respuesta.headers['retry-after']).toBe(String(RETRY_AFTER_S));
    expect(respuesta.headers['www-authenticate']).toBeUndefined();
  });

  it('no repite el token ni la URL de Keycloak en la respuesta', async () => {
    servidor.responderCon({ tipo: '5xx', estado: 500 });
    const token = armarTokenRsa(clave);
    const respuesta = await pedir(`Bearer ${token}`);
    expect(respuesta.body).not.toContain(token);
    expect(respuesta.body).not.toContain(servidor.url);
  });

  it('un token con otro algoritmo da 401, porque para rechazarlo no hace falta ninguna clave', async () => {
    servidor.responderCon({ tipo: '5xx', estado: 500 });
    const respuesta = await pedir(`Bearer ${armarToken({ cabecera: { kid: clave.kid } })}`);
    expect(respuesta.statusCode).toBe(401);
    expect(servidor.llamadas).toBe(0);
  });

  it('una operación pública responde igual', async () => {
    servidor.responderCon({ tipo: '5xx', estado: 500 });
    const respuesta = await pedir(undefined, '/pruebas/publica');
    expect(respuesta.statusCode).toBe(200);
    expect(servidor.llamadas).toBe(0);
  });
});

describe('app en modo jwks: las operaciones públicas no piden token (RNF-12.18)', () => {
  it.each(['/health', '/pruebas/publica'])('GET %s responde sin token y sin pedir las claves', async (url) => {
    const respuesta = await pedir(undefined, url);
    expect(respuesta.statusCode).toBe(200);
    expect(servidor.llamadas).toBe(0);
  });

  it('GET /health responde 200 también con un token que no sirve', async () => {
    const respuesta = await pedir('Bearer esto-no-es-un-token', '/health');
    expect(respuesta.statusCode).toBe(200);
  });
});

describe('app en modo hs256: sigue como siempre (RNF-12.15)', () => {
  it('acepta un HS256 y su identidad no trae scopes', async () => {
    const app = crearApp(MANEJADORES, { config: { modoTokens: 'hs256', urlJwks: `${servidor.url}/certs` } });
    const respuesta = await pedir(`Bearer ${armarToken({ claims: { scope: 'clientes:read' } })}`, '/pruebas/protegida', app);

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({ identidad: { sub: SUB_DE_PRUEBA, roles: ['CLIENTE'] } });
    expect(servidor.llamadas).toBe(0);
  });

  it('rechaza un RS256, y nunca pide las claves', async () => {
    const app = crearApp(MANEJADORES, { config: { modoTokens: 'hs256', urlJwks: `${servidor.url}/certs` } });
    const respuesta = await pedir(`Bearer ${armarTokenRsa(clave)}`, '/pruebas/protegida', app);

    expect(respuesta.statusCode).toBe(401);
    expect(servidor.llamadas).toBe(0);
  });
});
