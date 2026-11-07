import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { describirRespuesta } from './ayudas/errores.js';
import { pedirM6, tokenDeServicioDeM2 } from './ayudas/pedir.js';
import { crearViaje } from './ayudas/viajes.js';

// El token con el que M2 se presenta ante M6 (RNF-07.11, ADR 009): `sub` `m2-clientes`, `roles` `["SERVICIO"]`, firmado por M2.
// Si M6 lo rechazara, lo que M2 muestra al usuario sería un 500 sin datos de M6 (RF-2.4.7): por eso la falla trae el código y el
// `code` de M6.
describe('el token de servicio de M2 ante el M6 real (RNF-07.11)', () => {
  it('es el que M2 firma para M6: su audiencia y 60 s de vida, no los del comando que hace de M1', async () => {
    const token = await tokenDeServicioDeM2();
    const datos = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(datos).toMatchObject({ sub: 'm2-clientes', roles: ['SERVICIO'], aud: 'm6-viajes' });
    expect(Number(datos.exp) - Number(datos.iat)).toBe(60);
  });

  it('GET /trips?clientId=… no da 401 ni 403', async () => {
    const token = await tokenDeServicioDeM2();
    const respuesta = await pedirM6('GET', `/trips?clientId=${randomUUID()}`, { token });
    expect([401, 403], describirRespuesta(respuesta)).not.toContain(respuesta.estado);
    expect(respuesta.estado, describirRespuesta(respuesta)).toBe(200);
  });

  it('GET /trips/{id} no da 401 ni 403', async () => {
    const viaje = await crearViaje(randomUUID(), 'COMPLETED');
    const token = await tokenDeServicioDeM2();
    const respuesta = await pedirM6('GET', `/trips/${viaje.viajeId}`, { token });
    expect([401, 403], describirRespuesta(respuesta)).not.toContain(respuesta.estado);
    expect(respuesta.estado, describirRespuesta(respuesta)).toBe(200);
  });

  it('sin token M6 contesta 401, y el mensaje de la falla trae el código y el code', async () => {
    const respuesta = await pedirM6('GET', `/trips?clientId=${randomUUID()}`);
    expect(respuesta.estado).toBe(401);
    const texto = describirRespuesta(respuesta);
    expect(texto).toContain('HTTP 401');
    expect(texto).toContain('code=UNAUTHENTICATED');
  });
});
