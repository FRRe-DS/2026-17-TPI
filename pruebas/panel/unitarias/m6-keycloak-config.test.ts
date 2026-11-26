import { describe, expect, it } from 'vitest';
import { cargarConfigM6 } from '../../../panel/servidor/config.js';

// El emisor y el JWKS de Keycloak del M6 simulado (spec 125, RNF-07): los dos o ninguno.
const BASE = { M2_CLAVE_TOKENS: 'clave-de-prueba-de-32-caracteres!', M2_EMISOR_TOKENS: 'm1-identidad', M2_AUDIENCIA_TOKENS: 'm2-clientes' };
const EMISOR = 'http://localhost:8080/realms/ds-2026-realm';
const JWKS = 'http://keycloak:8080/realms/ds-2026-realm/protocol/openid-connect/certs';

describe('cargarConfigM6: emisor y JWKS de Keycloak (spec 125)', () => {
  it('sin ninguno, el simulado no acepta tokens de Keycloak', () => {
    expect(cargarConfigM6(BASE).config?.keycloak).toBeUndefined();
    expect(cargarConfigM6({ ...BASE, M6_EMISOR_KEYCLOAK: '', M6_URL_JWKS_KEYCLOAK: '' }).config?.keycloak).toBeUndefined();
  });

  it('con los dos, guarda el emisor tal cual y el JWKS sin barra final', () => {
    const { config } = cargarConfigM6({ ...BASE, M6_EMISOR_KEYCLOAK: EMISOR, M6_URL_JWKS_KEYCLOAK: `${JWKS}/` });
    expect(config?.keycloak).toEqual({ emisor: EMISOR, urlJwks: JWKS });
  });

  it.each([
    ['solo el emisor', { M6_EMISOR_KEYCLOAK: EMISOR }, 'M6_URL_JWKS_KEYCLOAK'],
    ['solo el JWKS', { M6_URL_JWKS_KEYCLOAK: JWKS }, 'M6_EMISOR_KEYCLOAK'],
  ])('con %s, nombra la que falta', (_caso, env, falta) => {
    const { errores } = cargarConfigM6({ ...BASE, ...env });
    expect(errores?.map((error) => error.variable)).toEqual([falta]);
  });

  it('rechaza un JWKS que no es http o https, sin repetirlo', () => {
    const { errores } = cargarConfigM6({ ...BASE, M6_EMISOR_KEYCLOAK: EMISOR, M6_URL_JWKS_KEYCLOAK: 'ftp://keycloak/certs' });
    expect(errores?.map((error) => error.variable)).toEqual(['M6_URL_JWKS_KEYCLOAK']);
    expect(JSON.stringify(errores)).not.toContain('ftp://keycloak');
  });

  it('rechaza un emisor con espacios al borde', () => {
    const { errores } = cargarConfigM6({ ...BASE, M6_EMISOR_KEYCLOAK: ` ${EMISOR}`, M6_URL_JWKS_KEYCLOAK: JWKS });
    expect(errores?.map((error) => error.variable)).toEqual(['M6_EMISOR_KEYCLOAK']);
  });
});
