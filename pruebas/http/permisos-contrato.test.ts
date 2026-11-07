import { describe, expect, it } from 'vitest';
import type { Permisos, Manejador } from '../../src/contrato/operaciones.js';
import { contratoCon, crearApp } from '../ayudas/app.js';
import { AUTORIZADO, bearer } from '../ayudas/tokens.js';

// Cómo salen del contrato los roles y los scopes de una operación (RNF-12.13): los esquemas `oauth2` y `openIdConnect` dan
// scopes, como dice OpenAPI 3.1, y los demás, roles. Exigir el scope es de la T9: acá solo se separan.
const ESQUEMAS = {
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer' },
      claveApi: { type: 'apiKey', in: 'header', name: 'X-Clave' },
      keycloak: { type: 'oauth2', flows: {} },
      oidc: { type: 'openIdConnect', openIdConnectUrl: 'http://keycloak/.well-known/openid-configuration' },
      porReferencia: { $ref: '#/components/securitySchemes/keycloak' },
    },
  },
};

const permisos: Manejador = async (request) => request.routeOptions.config.permisos;

const contratoDe = (security: unknown, extra: object = ESQUEMAS) =>
  contratoCon({ '/x': { get: { operationId: 'x', security } } }, extra);

const pedir = (security: unknown, headers: Record<string, string> = AUTORIZADO, extra?: object) =>
  crearApp({ x: permisos }, { contrato: contratoDe(security, extra) }).inject({ method: 'GET', url: '/x', headers });

const permisosDe = async (security: unknown, extra?: object) => (await pedir(security, AUTORIZADO, extra)).json<Permisos>();

const R = 'clientes:read';
const W = 'clientes:write';

describe('permisos: qué esquemas dan scopes (RNF-12.13)', () => {
  it.each<[string, string]>([
    ['oauth2', 'keycloak'],
    ['openIdConnect', 'oidc'],
    ['un $ref a un oauth2', 'porReferencia'],
  ])('%s da scopes', async (_caso, esquema) => {
    await expect(permisosDe([{ [esquema]: [R] }])).resolves.toEqual({ publica: false, roles: [], scopes: [R] });
  });

  it.each<[string, string]>([
    ['http', 'bearerAuth'],
    ['apiKey', 'claveApi'],
    ['un esquema no declarado', 'desconocido'],
  ])('%s da roles', async (_caso, esquema) => {
    await expect(permisosDe([{ [esquema]: ['CLIENTE'] }])).resolves.toEqual({ publica: false, roles: ['CLIENTE'] });
  });

  // `contratoCon` no trae `components`: un scope que queda como rol da 403, no abre de más.
  it('sin components, todo es un rol', async () => {
    await expect(permisosDe([{ keycloak: ['CLIENTE'] }], {})).resolves.toEqual({ publica: false, roles: ['CLIENTE'] });
  });

  it('un $ref que no lleva a nada hace fallar el registro: adivinar podría abrir de más', () => {
    const extra = { components: { securitySchemes: { roto: { $ref: '#/components/securitySchemes/noEsta' } } } };
    expect(() => crearApp({ x: permisos }, { contrato: contratoDe([{ roto: [R] }], extra) })).toThrow('no lleva a nada');
  });
});

describe('permisos: un scope ya no se cuenta como rol (RNF-12.13)', () => {
  it.each<[string, unknown]>([
    ['en el mismo renglón', [{ bearerAuth: ['OPERADOR'], keycloak: [R] }]],
    ['en dos renglones', [{ bearerAuth: ['OPERADOR'] }, { keycloak: [R] }]],
  ])('con rol y scope %s, cada uno va a su lista', async (_caso, security) => {
    await expect(permisosDe(security)).resolves.toEqual({ publica: false, roles: ['OPERADOR'], scopes: [R] });
  });

  it('una operación que solo declara scopes admite cualquier rol conocido, aunque el nombre del scope no sea un rol', async () => {
    const respuesta = await pedir([{ keycloak: [R] }], bearer({ claims: { roles: ['CLIENTE'] } }));
    expect(respuesta.statusCode).toBe(200);
  });

  it('un token sin roles conocidos sigue sin pasar a una operación que solo declara scopes', async () => {
    const respuesta = await pedir([{ keycloak: [R] }], bearer({ claims: { roles: [R] } }));
    expect(respuesta.statusCode).toBe(403);
  });

  it('el nombre de un scope en el campo de roles del token no alcanza para el rol de la operación', async () => {
    const respuesta = await pedir([{ bearerAuth: ['OPERADOR'], keycloak: [R] }], bearer({ claims: { roles: ['CLIENTE', R] } }));
    expect(respuesta.statusCode).toBe(403);
  });
});

describe('permisos: la lista vacía se aplica solo a los roles (RNF-12.3)', () => {
  it('[{ bearerAuth: [OPERADOR] }, { keycloak: [] }] sigue pidiendo OPERADOR', async () => {
    await expect(permisosDe([{ bearerAuth: ['OPERADOR'] }, { keycloak: [] }])).resolves.toEqual({
      publica: false,
      roles: ['OPERADOR'],
    });
    const respuesta = await pedir([{ bearerAuth: ['OPERADOR'] }, { keycloak: [] }], bearer({ claims: { roles: ['CLIENTE'] } }));
    expect(respuesta.statusCode).toBe(403);
  });

  it('una lista de roles vacía admite cualquier rol conocido, también al lado de un scope', async () => {
    await expect(permisosDe([{ bearerAuth: [], keycloak: [R] }])).resolves.toEqual({ publica: false, roles: [], scopes: [R] });
  });

  it('una lista de roles vacía gana sobre otra con roles, como antes', async () => {
    await expect(permisosDe([{ bearerAuth: [] }, { claveApi: ['OPERADOR'] }])).resolves.toEqual({ publica: false, roles: [] });
  });

  it('una lista de roles vacía sola admite cualquier rol conocido', async () => {
    await expect(permisosDe([{ bearerAuth: [] }])).resolves.toEqual({ publica: false, roles: [] });
  });
});

describe('permisos: scopes solo aparece si la operación declara alguno', () => {
  it('sin scopes declarados no está el campo', async () => {
    const leidos = await permisosDe([{ bearerAuth: ['CLIENTE'] }]);
    expect(Object.keys(leidos).sort()).toEqual(['publica', 'roles']);
  });

  it('con un esquema de scopes y la lista vacía tampoco', async () => {
    const leidos = await permisosDe([{ keycloak: [] }]);
    expect(leidos).toEqual({ publica: false, roles: [] });
    expect(leidos).not.toHaveProperty('scopes');
  });

  it('se juntan los de varios renglones y los esquemas, sin repetir', async () => {
    const security = [{ keycloak: [R, W] }, { oidc: [R] }];
    await expect(permisosDe(security)).resolves.toEqual({ publica: false, roles: [], scopes: [R, W] });
  });

  it('una alternativa vacía sigue haciendo pública la operación, sin scopes', async () => {
    await expect(permisosDe([{}, { keycloak: [R] }])).resolves.toEqual({ publica: true, roles: [] });
  });

  it('security: [] sigue haciendo pública la operación', async () => {
    await expect(permisosDe([])).resolves.toEqual({ publica: true, roles: [] });
  });

  it('el security global también separa los scopes', async () => {
    const contrato = contratoCon(
      { '/x': { get: { operationId: 'x' } } },
      { ...ESQUEMAS, security: [{ bearerAuth: ['CLIENTE'], keycloak: [R] }] },
    );
    const respuesta = await crearApp({ x: permisos }, { contrato }).inject({ method: 'GET', url: '/x', headers: AUTORIZADO });
    expect(respuesta.json()).toEqual({ publica: false, roles: ['CLIENTE'], scopes: [R] });
  });
});
