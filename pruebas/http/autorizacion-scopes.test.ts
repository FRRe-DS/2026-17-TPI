import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { exigirPropietario } from '../../src/clientes/servicio.js';
import type { Manejador } from '../../src/contrato/operaciones.js';
import { contratoCon, crearApp } from '../ayudas/app.js';
import { armarTokenRsa, crearClave, jwksDe } from '../ayudas/jwks.js';
import { crearServidorModulo } from '../ayudas/servidor-modulo.js';
import { armarToken, SUB_DE_PRUEBA } from '../ayudas/tokens.js';

// El scope de cada operación, junto con el rol y la propiedad del recurso (RNF-12.13, RNF-12.14, RNF-12.15). El contrato es de
// la prueba: el real todavía no declara scopes (#79), y M2 los lee del contrato como lee los roles.
const servidor = crearServidorModulo();
const clave = crearClave();

const OTRO_SUB = '00000000-0000-4000-8000-000000000002';
const R = 'clientes:read';
const W = 'clientes:write';
const DETAIL_SCOPE = 'El token no trae el scope que pide la operación';
const DETAIL_ROL = 'El rol del token no permite esta operación';
const DETAIL_PROPIETARIO = 'El perfil pedido es de otro cliente';

const parametros = [{ name: 'clienteId', in: 'path', required: true, schema: { type: 'string' } }];
const contrato = contratoCon(
  {
    '/leer/{clienteId}': {
      get: { operationId: 'leer', parameters: parametros, security: [{ bearerAuth: ['CLIENTE', 'OPERADOR'], keycloak: [R] }] },
    },
    '/escribir/{clienteId}': {
      get: { operationId: 'escribir', parameters: parametros, security: [{ bearerAuth: ['CLIENTE'], keycloak: [W] }] },
    },
    '/ambos': { get: { operationId: 'ambos', security: [{ bearerAuth: [], keycloak: [R, W] }] } },
    '/sin-scope': { get: { operationId: 'sinScope', security: [{ bearerAuth: ['CLIENTE'] }] } },
    '/lista-vacia': { get: { operationId: 'listaVacia', security: [{ bearerAuth: ['CLIENTE'], keycloak: [] }] } },
    '/publica': { get: { operationId: 'publica', security: [] } },
  },
  {
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' }, keycloak: { type: 'oauth2', flows: {} } },
    },
  },
);

// Como los manejadores reales: la propiedad se comprueba después de los permisos, con el sub contra el clienteId.
const conPropietario: Manejador = async (request) => {
  const { clienteId } = request.params as { clienteId: string };
  exigirPropietario(request.identidad!, clienteId, request.routeOptions.config.permisos?.roles ?? []);
  return { ok: true };
};
const sinMas: Manejador = async () => ({ ok: true });
const MANEJADORES = {
  leer: conPropietario,
  escribir: conPropietario,
  ambos: sinMas,
  sinScope: sinMas,
  listaVacia: sinMas,
  publica: sinMas,
};

const appJwks = () =>
  crearApp(MANEJADORES, { contrato, config: { modoTokens: 'jwks', urlJwks: `${servidor.url}/certs` } });

type Opciones = { roles?: string[]; scope?: string | undefined; sub?: string };
const bearerRsa = ({ roles = ['CLIENTE'], scope, sub = SUB_DE_PRUEBA }: Opciones = {}) =>
  `Bearer ${armarTokenRsa(clave, { claims: { roles, scope, sub } })}`;
const pedir = (url: string, authorization?: string, app = appJwks()) =>
  app.inject({ method: 'GET', url, headers: authorization === undefined ? {} : { authorization } });

function esProblema(respuesta: LightMyRequestResponse, status: number, detail: string, instance: string) {
  expect(respuesta.statusCode).toBe(status);
  expect(respuesta.headers['content-type']).toMatch(/^application\/problem\+json/);
  expect(respuesta.json()).toEqual({
    type: 'about:blank',
    title: status === 403 ? 'Sin permiso' : 'No autenticado',
    status,
    detail,
    instance,
  });
}

beforeAll(async () => {
  await servidor.levantar();
});

afterAll(async () => {
  await servidor.cerrar();
});

beforeEach(() => {
  servidor.responderCon({ tipo: 'ok', cuerpo: jwksDe(clave) });
});

describe('modo jwks: 403 si falta el scope (RNF-12.13)', () => {
  const LEER = `/leer/${SUB_DE_PRUEBA}`;

  it('con el rol y el sub bien, un token con el scope pasa', async () => {
    expect((await pedir(LEER, bearerRsa({ scope: R }))).statusCode).toBe(200);
  });

  it.each<[string, string | undefined]>([
    ['sin el campo scope', undefined],
    ['con el scope vacío', ''],
    ['con otro scope', 'openid profile'],
    ['con solo clientes:write, que no da permiso de lectura', W],
  ])('un token %s da 403 por el scope, aunque el rol y el sub estén bien', async (_caso, scope) => {
    const respuesta = await pedir(`${LEER}?x=1`, bearerRsa({ scope }));
    esProblema(respuesta, 403, DETAIL_SCOPE, LEER);
    expect(respuesta.headers['www-authenticate']).toBeUndefined();
  });

  it('clientes:read no da permiso de escritura', async () => {
    esProblema(await pedir(`/escribir/${SUB_DE_PRUEBA}`, bearerRsa({ scope: R })), 403, DETAIL_SCOPE, `/escribir/${SUB_DE_PRUEBA}`);
    expect((await pedir(`/escribir/${SUB_DE_PRUEBA}`, bearerRsa({ scope: W }))).statusCode).toBe(200);
  });

  it('un token con más scopes de los necesarios pasa, en cualquier orden', async () => {
    expect((await pedir(LEER, bearerRsa({ scope: `openid ${W} ${R}` }))).statusCode).toBe(200);
  });

  it('una operación que pide dos scopes los pide a los dos', async () => {
    expect((await pedir('/ambos', bearerRsa({ scope: R }))).statusCode).toBe(403);
    expect((await pedir('/ambos', bearerRsa({ scope: W }))).statusCode).toBe(403);
    expect((await pedir('/ambos', bearerRsa({ scope: `${W} ${R}` }))).statusCode).toBe(200);
  });

  it('el scope se compara tal cual: mayúsculas y prefijos no valen', async () => {
    for (const scope of ['Clientes:Read', 'clientes', 'clientes:read:todo', 'CLIENTE']) {
      expect((await pedir(LEER, bearerRsa({ scope }))).statusCode).toBe(403);
    }
  });

  it('el scope en el campo de roles del token no vale como scope', async () => {
    expect((await pedir(LEER, bearerRsa({ roles: ['CLIENTE', R] }))).statusCode).toBe(403);
  });
});

describe('modo jwks: el rol y la propiedad siguen mandando, aunque el token traiga el scope (RNF-12.14)', () => {
  it('un rol que la operación no permite da 403 por el rol', async () => {
    const respuesta = await pedir(`/leer/${SUB_DE_PRUEBA}`, bearerRsa({ roles: ['CONDUCTOR'], scope: R }));
    esProblema(respuesta, 403, DETAIL_ROL, `/leer/${SUB_DE_PRUEBA}`);
  });

  it('sin rol conocido da 403 por el rol', async () => {
    const respuesta = await pedir(`/leer/${SUB_DE_PRUEBA}`, bearerRsa({ roles: [], scope: R }));
    esProblema(respuesta, 403, DETAIL_ROL, `/leer/${SUB_DE_PRUEBA}`);
  });

  it('si falla el rol y también el scope, el 403 es por el rol: primero se mira quién es', async () => {
    const respuesta = await pedir(`/leer/${SUB_DE_PRUEBA}`, bearerRsa({ roles: ['CONDUCTOR'] }));
    esProblema(respuesta, 403, DETAIL_ROL, `/leer/${SUB_DE_PRUEBA}`);
  });

  it('un CLIENTE sobre otro clienteId da 403 por la propiedad', async () => {
    const respuesta = await pedir(`/leer/${OTRO_SUB}`, bearerRsa({ scope: R }));
    esProblema(respuesta, 403, DETAIL_PROPIETARIO, `/leer/${OTRO_SUB}`);
  });

  it('un CLIENTE sobre otro clienteId sin el scope da 403 por el scope, antes de mirar el recurso', async () => {
    esProblema(await pedir(`/leer/${OTRO_SUB}`, bearerRsa()), 403, DETAIL_SCOPE, `/leer/${OTRO_SUB}`);
  });

  it('un OPERADOR con el scope lee otro clienteId', async () => {
    expect((await pedir(`/leer/${OTRO_SUB}`, bearerRsa({ roles: ['OPERADOR'], scope: R }))).statusCode).toBe(200);
  });

  it('un OPERADOR sin el scope no lee otro clienteId', async () => {
    esProblema(await pedir(`/leer/${OTRO_SUB}`, bearerRsa({ roles: ['OPERADOR'] })), 403, DETAIL_SCOPE, `/leer/${OTRO_SUB}`);
  });

  it('un token inválido sigue dando 401 y no 403', async () => {
    const respuesta = await pedir('/ambos', 'Bearer esto-no-es-un-token');
    expect(respuesta.statusCode).toBe(401);
  });
});

describe('modo jwks: una operación sin scope declarado no exige ninguno (RNF-12.13)', () => {
  it.each<[string, string | undefined]>([
    ['sin el campo scope', undefined],
    ['con el scope vacío', ''],
    ['con scopes cualquiera', 'openid'],
  ])('un token %s pasa', async (_caso, scope) => {
    expect((await pedir('/sin-scope', bearerRsa({ scope }))).statusCode).toBe(200);
  });

  it('una lista de scopes vacía en el contrato no exige ninguno', async () => {
    expect((await pedir('/lista-vacia', bearerRsa())).statusCode).toBe(200);
  });

  it('el rol sigue mandando en una operación sin scope', async () => {
    esProblema(await pedir('/sin-scope', bearerRsa({ roles: ['OPERADOR'] })), 403, DETAIL_ROL, '/sin-scope');
  });

  it('una operación pública no pide token ni scope', async () => {
    expect((await pedir('/publica')).statusCode).toBe(200);
  });
});

describe('modo hs256: el scope no se mira (RNF-12.15)', () => {
  const appHs256 = () => crearApp(MANEJADORES, { contrato, config: { modoTokens: 'hs256' } });
  const bearerHs = (claims: Record<string, unknown> = {}) => `Bearer ${armarToken({ claims })}`;

  it.each<[string, Record<string, unknown>]>([
    ['sin scope', {}],
    ['con otro scope', { scope: 'openid' }],
    ['con el scope', { scope: R }],
  ])('una operación que declara scope responde igual a un token %s', async (_caso, claims) => {
    const respuesta = await pedir(`/leer/${SUB_DE_PRUEBA}`, bearerHs(claims), appHs256());
    expect(respuesta.statusCode).toBe(200);
  });

  it('el rol y la propiedad siguen mandando', async () => {
    const app = appHs256();
    esProblema(await pedir(`/leer/${OTRO_SUB}`, bearerHs(), app), 403, DETAIL_PROPIETARIO, `/leer/${OTRO_SUB}`);
    esProblema(await pedir(`/leer/${SUB_DE_PRUEBA}`, bearerHs({ roles: ['CONDUCTOR'] }), app), 403, DETAIL_ROL, `/leer/${SUB_DE_PRUEBA}`);
  });
});
