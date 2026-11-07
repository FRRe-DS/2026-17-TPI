import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CLIENTE_DEL_FRONT } from '../ayudas/realm.js';
import { canjear, codigoDeAutorizacion, parPkce, pedirAlEndpointDeTokens, pedirAutorizacion, RETORNO } from './ayudas/pkce.js';
import { claimsDe, pedirM2, usuarioDeEjemplo } from './ayudas/pedir.js';

// El cliente público del frontend con Keycloak real (spec 080, RNF-12.20, RNF-07.13). Usa cliente2, y crea su perfil si falta:
// el de cliente1 lo crea operaciones.test.ts, que espera un 201, y el orden entre los dos archivos no está fijo.
const cliente2 = usuarioDeEjemplo('cliente2');

describe('m2-front: flujo de código con PKCE S256 (RNF-12.20)', () => {
  it('cliente2 inicia sesión, canjea el código con el verificador y el token sirve en M2', async () => {
    const { verificador, desafio } = parPkce();
    const codigo = await codigoDeAutorizacion('cliente2', ['clientes:read', 'clientes:write'], desafio);
    const tokens = await canjear(codigo, verificador);
    expect(tokens.estado, JSON.stringify(tokens.cuerpo)).toBe(200);

    const acceso = tokens.cuerpo.access_token ?? '';
    const claims = claimsDe(acceso);
    expect(claims).toMatchObject({ aud: 'm2-clientes', sub: cliente2.id, roles: expect.arrayContaining(['CLIENTE']), azp: CLIENTE_DEL_FRONT });
    expect(new Set(claims['roles'] as string[])).toEqual(new Set(['CLIENTE']));
    expect(String(claims['scope']).split(' ').sort()).toEqual(['clientes:read', 'clientes:write', 'openid']);
    // El ID token es para el frontend, no para M2.
    expect(claimsDe(tokens.cuerpo.id_token ?? '')['aud']).toBe(CLIENTE_DEL_FRONT);

    const alta = await pedirM2(acceso, 'POST', '/api/v1/clientes', {
      cuerpo: { nombre: 'Cliente', apellido: 'Dos', telefono: '+5493624222222' },
      encabezados: { 'idempotency-key': randomUUID() },
    });
    expect([201, 409], alta.texto).toContain(alta.estado);
    const lectura = await pedirM2(acceso, 'GET', `/api/v1/clientes/${cliente2.id}`);
    expect(lectura.estado, lectura.texto).toBe(200);
  });

  it('sin pedir scopes de M2, el token trae solo openid', async () => {
    const { verificador, desafio } = parPkce();
    const tokens = await canjear(await codigoDeAutorizacion('cliente2', [], desafio), verificador);
    expect(tokens.estado).toBe(200);
    expect(claimsDe(tokens.cuerpo.access_token ?? '')['scope']).toBe('openid');
  });
});

describe('m2-front rechaza todo lo que no es código de autorización con PKCE S256 (RNF-12.20)', () => {
  const errorDeLaRedireccion = (respuesta: Response) => {
    const destino = new URL(respuesta.headers.get('location') ?? 'http://sin-redireccion/');
    return { origen: `${destino.origin}${destino.pathname}`, error: destino.searchParams.get('error'), detalle: destino.searchParams.get('error_description') };
  };

  it('un pedido de autorización sin code_challenge vuelve con invalid_request, sin mostrar el inicio de sesión', async () => {
    const respuesta = await pedirAutorizacion({});
    expect(respuesta.status).toBe(302);
    expect(errorDeLaRedireccion(respuesta)).toMatchObject({ origen: RETORNO, error: 'invalid_request', detalle: expect.stringMatching(/code_challenge_method/) });
  });

  it('un pedido con el método plain vuelve con invalid_request', async () => {
    const respuesta = await pedirAutorizacion({ desafio: parPkce().verificador, metodo: 'plain' });
    expect(respuesta.status).toBe(302);
    expect(errorDeLaRedireccion(respuesta)).toMatchObject({ origen: RETORNO, error: 'invalid_request', detalle: expect.stringMatching(/code challenge method/) });
  });

  it('una dirección de retorno ajena da 400 y no redirige', async () => {
    const respuesta = await pedirAutorizacion({ desafio: parPkce().desafio, retorno: 'http://sitio-ajeno.test/callback' });
    expect(respuesta.status).toBe(400);
    expect(respuesta.headers.get('location')).toBeNull();
  });

  it('canjear el código sin el verificador da invalid_grant', async () => {
    const codigo = await codigoDeAutorizacion('cliente2', [], parPkce().desafio);
    const tokens = await canjear(codigo, undefined);
    expect(tokens.estado).toBe(400);
    expect(tokens.cuerpo.error).toBe('invalid_grant');
  });

  it('canjear el código con otro verificador da invalid_grant', async () => {
    const codigo = await codigoDeAutorizacion('cliente2', [], parPkce().desafio);
    const tokens = await canjear(codigo, parPkce().verificador);
    expect(tokens.estado).toBe(400);
    expect(tokens.cuerpo.error).toBe('invalid_grant');
  });

  it('usuario y contraseña directos dan unauthorized_client', async () => {
    const tokens = await pedirAlEndpointDeTokens({ grant_type: 'password', client_id: CLIENTE_DEL_FRONT, username: cliente2.usuario, password: cliente2.contrasena });
    expect(tokens.cuerpo.error).toBe('unauthorized_client');
    expect(tokens.cuerpo.access_token).toBeUndefined();
  });

  it('client_credentials da unauthorized_client', async () => {
    const tokens = await pedirAlEndpointDeTokens({ grant_type: 'client_credentials', client_id: CLIENTE_DEL_FRONT });
    expect(tokens.cuerpo.error).toBe('unauthorized_client');
    expect(tokens.cuerpo.access_token).toBeUndefined();
  });
});
