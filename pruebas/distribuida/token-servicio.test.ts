import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { describirRespuesta } from './ayudas/errores.js';
import { pedirM6, tokenDeServicioDeM2, tokenHs256DeM2 } from './ayudas/pedir.js';
import { crearViaje } from './ayudas/viajes.js';

// El token con el que M2 se presenta ante M6 (RNF-07.15, spec 125): M2 lo pide a Keycloak por client_credentials como grupo-17, y el
// M6 real del Grupo 12 lo valida con RS256 contra ese Keycloak. Reemplaza a RNF-07.11 de la spec 081, que usaba el HS256 firmado por
// M2. Si M6 lo rechazara, lo que M2 muestra al usuario sería un 500 sin datos de M6 (RF-2.4.7): por eso la falla trae el código y
// el `code` de M6.
describe('el token de servicio de M2 ante el M6 real (RNF-07.15)', () => {
  it('es el que M2 pide a Keycloak: RS256, del cliente grupo-17, con el rol clientes-be y el emisor que valida M6', async () => {
    const token = await tokenDeServicioDeM2();
    const [cabecera, cuerpo] = token.split('.').slice(0, 2).map((parte) => JSON.parse(Buffer.from(parte, 'base64url').toString('utf8')) as Record<string, unknown>);
    expect(cabecera).toMatchObject({ alg: 'RS256' });
    expect(cuerpo).toMatchObject({ azp: 'grupo-17', iss: 'http://localhost:18081/realms/ds-2026-realm' });
    expect(cuerpo?.['roles']).toContain('clientes-be');
  });

  it('GET /trips?clientId=… no da 401 ni 403', async () => {
    const token = await tokenDeServicioDeM2();
    const respuesta = await pedirM6('GET', `/trips?clientId=${randomUUID()}`, { token });
    expect([401, 403], describirRespuesta(respuesta)).not.toContain(respuesta.estado);
    expect(respuesta.estado, describirRespuesta(respuesta)).toBe(200);
  });

  it('GET /trips/{tripId} no da 401 ni 403', async () => {
    const viaje = await crearViaje(randomUUID(), 'COMPLETED');
    const token = await tokenDeServicioDeM2();
    const respuesta = await pedirM6('GET', `/trips/${viaje.viajeId}`, { token });
    expect([401, 403], describirRespuesta(respuesta)).not.toContain(respuesta.estado);
    expect(respuesta.estado, describirRespuesta(respuesta)).toBe(200);
  });

  // Si M6 dejara de verificar la firma, las pruebas de arriba pasarían igual sin probar nada: el commit fijado tiene que exigir RS256.
  it('el HS256 que M2 firmaba antes da 401: el M6 fijado exige el token de Keycloak', async () => {
    const respuesta = await pedirM6('GET', `/trips?clientId=${randomUUID()}`, { token: await tokenHs256DeM2() });
    expect(respuesta.estado, describirRespuesta(respuesta)).toBe(401);
  });

  it('sin token M6 contesta 401, y el mensaje de la falla trae el código y el code', async () => {
    const respuesta = await pedirM6('GET', `/trips?clientId=${randomUUID()}`);
    expect(respuesta.estado).toBe(401);
    const texto = describirRespuesta(respuesta);
    expect(texto).toContain('HTTP 401');
    expect(texto).toContain('code=UNAUTHENTICATED');
  });
});
