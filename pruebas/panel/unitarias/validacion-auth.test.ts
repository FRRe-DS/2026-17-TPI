import { createHash } from 'node:crypto';
import { createLocalJWKSet, errors, type JSONWebKeySet, type JWTVerifyGetKey } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { crearValidadorTokens, CredencialInvalida, IdentidadNoDisponible } from '../../../panel/servidor/auth/validacion.js';
import { armarTokenRsa, crearClave, jwksDe } from '../../ayudas/jwks.js';
import { armarToken } from '../../ayudas/tokens.js';

const AHORA_S = Math.floor(Date.now() / 1000);
const AHORA_MS = AHORA_S * 1000;
const EMISOR = 'https://identidad.ejemplo.test/realms/movilidad';
const CLIENTE = 'm2-front';
const SUB = 'c1e00000-0000-4000-8000-000000000001';
const NONCE = 'nonce-de-la-transaccion-del-servidor';
const clave = crearClave();
const otra = crearClave(clave.kid);
const resolver = () => createLocalJWKSet(jwksDe(clave) as JSONWebKeySet);
const validador = (claves: JWTVerifyGetKey = resolver()) => crearValidadorTokens({ oidcEmisor: EMISOR, oidcCliente: CLIENTE }, claves, () => AHORA_MS);
type Tipo = 'id' | 'access';

function claims(tipo: Tipo): Record<string, unknown> {
  return { iss: EMISOR, aud: tipo === 'id' ? CLIENTE : 'm2-clientes', sub: SUB, exp: AHORA_S + 300,
    iat: AHORA_S, typ: tipo === 'id' ? 'ID' : 'Bearer', azp: CLIENTE,
    ...(tipo === 'id' ? { nonce: NONCE, roles: ['OPERADOR'] } : { roles: ['CLIENTE'], scope: 'openid clientes:read' }) };
}

const token = (tipo: Tipo, cambios: Record<string, unknown> = {}, cabecera: Record<string, unknown> = {}) =>
  armarTokenRsa(clave, { claims: { ...claims(tipo), ...cambios }, cabecera });

async function rechazado(promesa: Promise<unknown>, credencial: string) {
  const error = await promesa.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(CredencialInvalida);
  expect((error as Error).message).toBe('La credencial de identidad no es válida');
  expect((error as Error).cause).toBeUndefined();
  for (const parte of [credencial, ...credencial.split('.')].filter((parte) => parte.length > 12)) {
    expect(String(error) + JSON.stringify(error)).not.toContain(parte);
  }
}

describe('credenciales separadas de Keycloak (083/T5)', () => {
  it('valida el ID token y devuelve solo identidad y fechas', async () => {
    await expect(validador().validarIdToken(token('id'), NONCE)).resolves.toEqual({
      sub: SUB, emitidoEn: AHORA_MS, venceEn: AHORA_MS + 300_000,
    });
  });

  it('valida acceso de M2 y toma permisos solo de ese token', async () => {
    await expect(validador().validarPar({ idToken: token('id'), accessToken: token('access') }, NONCE)).resolves.toEqual({
      sub: SUB, roles: ['CLIENTE'], scopes: ['openid', 'clientes:read'], emitidoEn: AHORA_MS, venceEn: AHORA_MS + 300_000,
    });
  });

  it('un ID token no se admite para M2 aunque agregue su audiencia', async () => {
    const id = token('id', { aud: [CLIENTE, 'm2-clientes'] });
    await rechazado(validador().validarAccessToken(id, SUB), id);
  });

  it('un access token no se admite como identidad aunque agregue nonce y audiencia del frontend', async () => {
    const acceso = token('access', { aud: CLIENTE, nonce: NONCE });
    await rechazado(validador().validarIdToken(acceso, NONCE), acceso);
  });

  it('rechaza combinar tokens válidos que pertenecen a personas distintas', async () => {
    const acceso = token('access', { sub: 'c1e00000-0000-4000-8000-000000000002' });
    await rechazado(validador().validarPar({ idToken: token('id'), accessToken: acceso }, NONCE), acceso);
  });

  it('normaliza permisos, ignora roles desconocidos y no inventa permisos faltantes', async () => {
    await expect(validador().validarAccessToken(token('access', {
      roles: ['CLIENTE', 'ADMIN', 'CLIENTE', 'OPERADOR', 'cliente'], scope: 'openid  clientes:read clientes:read',
    }), SUB)).resolves.toMatchObject({ roles: ['CLIENTE', 'OPERADOR'], scopes: ['openid', 'clientes:read'] });
    await expect(validador().validarAccessToken(token('access', { roles: undefined, scope: undefined }), SUB))
      .resolves.toMatchObject({ roles: [], scopes: [] });
  });

  it.each([['roles', 'CLIENTE'], ['roles', ['CLIENTE', 1]], ['roles', null], ['scope', ['clientes:read']], ['scope', 3], ['scope', null]])(
    'rechaza permisos mal formados en %s', async (campo, valor) => {
      const acceso = token('access', { [campo as string]: valor });
      await rechazado(validador().validarAccessToken(acceso, SUB), acceso);
    },
  );

  it.each([undefined, '', 'otro', 3, null])('rechaza nonce ausente o diferente (%s)', async (nonce) => {
    const id = token('id', { nonce });
    await rechazado(validador().validarIdToken(id, NONCE), id);
  });

  it('no omite nonce cuando el valor esperado está vacío', async () => {
    const id = token('id'); await rechazado(validador().validarIdToken(id, ''), id);
  });

  it('admite audiencia en lista, tipo ID omitido y azp omitido cuando no hace falta', async () => {
    await expect(validador().validarIdToken(token('id', { aud: [CLIENTE], typ: undefined, azp: undefined }), NONCE))
      .resolves.toMatchObject({ sub: SUB });
    await expect(validador().validarAccessToken(token('access', { aud: ['account', 'm2-clientes'] }), SUB))
      .resolves.toMatchObject({ sub: SUB });
  });

  it('no acepta audiencias adicionales no confiables en el ID token', async () => {
    const id = token('id', { aud: [CLIENTE, 'ajeno'], azp: CLIENTE });
    await rechazado(validador().validarIdToken(id, NONCE), id);
  });

  it.each(['ajeno', '', 3, null])('rechaza azp distinto del cliente (%s)', async (azp) => {
    for (const tipo of ['id', 'access'] as const) {
      const credencial = token(tipo, { azp });
      await rechazado(tipo === 'id' ? validador().validarIdToken(credencial, NONCE) : validador().validarAccessToken(credencial, SUB), credencial);
    }
  });

  it('si existe at_hash, lo comprueba contra el access token concreto', async () => {
    const acceso = token('access');
    const atHash = createHash('sha256').update(acceso).digest().subarray(0, 16).toString('base64url');
    await expect(validador().validarPar({ idToken: token('id', { at_hash: atHash }), accessToken: acceso }, NONCE))
      .resolves.toMatchObject({ sub: SUB });
    const otroAcceso = token('access', { jti: 'otro-token-del-mismo-usuario' });
    await rechazado(validador().validarPar({ idToken: token('id', { at_hash: atHash }), accessToken: otroAcceso }, NONCE), otroAcceso);
  });

  it.each(['no-es-un-hash', 3, null])('rechaza at_hash mal formado (%s)', async (at_hash) => {
    const id = token('id', { at_hash }); await rechazado(validador().validarIdToken(id, NONCE), id);
  });
});

describe.each(['id', 'access'] as const)('firma y claims del token %s (083/T5)', (tipo) => {
  const verificar = (credencial: string, claves: JWTVerifyGetKey = resolver()) => tipo === 'id'
    ? validador(claves).validarIdToken(credencial, NONCE) : validador(claves).validarAccessToken(credencial, SUB);

  it.each([
    ['iss', undefined], ['iss', 'https://otro.test/realms/movilidad'], ['aud', undefined], ['aud', 'ajeno'],
    ['sub', undefined], ['sub', ''], ['sub', '   '], ['sub', 42], ['exp', undefined], ['exp', AHORA_S],
    ['exp', AHORA_S - 1], ['exp', 'mañana'], ['exp', Number.MAX_SAFE_INTEGER], ['iat', undefined],
    ['iat', AHORA_S + 1], ['iat', 'ayer'], ['iat', 1.5], ['nbf', AHORA_S + 1], ['nbf', 'después'],
  ])('rechaza %s=%s', async (campo, valor) => {
    const credencial = token(tipo, { [campo as string]: valor }); await rechazado(verificar(credencial), credencial);
  });

  it.each(['Refresh', 'Offline', 'incorrecto'])('rechaza tipo de payload %s', async (typ) => {
    const credencial = token(tipo, { typ }); await rechazado(verificar(credencial), credencial);
  });

  it.each(['Refresh', 'at+jwt', false])('rechaza tipo de encabezado incompatible (%s)', async (typ) => {
    const credencial = token(tipo, {}, { typ }); await rechazado(verificar(credencial), credencial);
  });

  it('rechaza firma ajena, payload alterado y kid desconocido', async () => {
    const firmaAjena = armarTokenRsa(otra, { claims: claims(tipo) });
    const partes = token(tipo).split('.');
    partes[1] = Buffer.from(JSON.stringify({ ...claims(tipo), sub: 'otro' })).toString('base64url');
    for (const credencial of [firmaAjena, partes.join('.'), token(tipo, {}, { kid: 'no-publicada' })]) {
      await rechazado(verificar(credencial), credencial);
    }
  });

  it.each(['HS256', 'none', 'RS384'] as const)('rechaza %s antes de pedir una clave', async (alg) => {
    const claves = vi.fn(resolver());
    const credencial = alg === 'RS384' ? armarTokenRsa(clave, { alg, claims: claims(tipo) })
      : armarToken({ alg, claims: claims(tipo) });
    await rechazado(verificar(credencial, claves), credencial); expect(claves).not.toHaveBeenCalled();
  });

  it.each(['', 'no-es-un-jwt', 'a.b.c'])('rechaza una credencial mal formada (%s)', async (credencial) => {
    await rechazado(verificar(credencial), credencial);
  });

  it('un fallo del proveedor de claves no se confunde con una credencial inválida ni filtra su causa', async () => {
    const secreto = 'secreto-del-proveedor';
    for (const falla of [new Error(secreto), new errors.JWKSTimeout(), new errors.JWKSInvalid(secreto)]) {
      const resultado = await verificar(token(tipo), async () => { throw falla; }).catch((e: unknown) => e);
      expect(resultado).toBeInstanceOf(IdentidadNoDisponible);
      expect((resultado as Error).cause).toBeUndefined();
      expect(String(resultado) + JSON.stringify(resultado)).not.toContain(secreto);
    }
  });
});
