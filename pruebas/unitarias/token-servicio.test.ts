import { decodeProtectedHeader, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import { crearTokenServicio, crearTokenServicioHs256 } from '../../src/auth/token-servicio.js';
import { CONFIG } from '../ayudas/app.js';

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
