import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearM6 as clienteDeM2 } from '../../../src/historial/m6.js';
import { escuchar } from '../../ayudas/socket.js';
import { CLIENTE, CONDUCTOR, CONFIG_M6, crearM6, OTRO_CLIENTE, viaje } from '../ayudas/m6.js';

// El cliente de M6 que usa M2 (src/historial/m6.ts), con su token de servicio, su tiempo y su lectura de las respuestas,
// contra el M6 simulado en un puerto real: si M2 lo entiende acá, lo entiende con el perfil `panel` de compose (RNF-13.7).
const COMPLETADO = '11111111-1111-4111-8111-111111111111';
const EN_CURSO = '22222222-2222-4222-8222-222222222222';
const AJENO = '33333333-3333-4333-8333-333333333333';

const { app } = crearM6([
  viaje(COMPLETADO, { createdAt: '2026-10-01T10:00:00.000Z' }),
  viaje(EN_CURSO, { state: 'IN_PROGRESS', driverId: undefined, distanceKm: null, durationMinutes: null, createdAt: '2026-10-02T10:00:00.000Z' }),
  viaje(AJENO, { clientId: OTRO_CLIENTE }),
]);
let m2: ReturnType<typeof clienteDeM2>;

beforeAll(async () => {
  const puerto = await escuchar(app);
  m2 = clienteDeM2({
    ...CONFIG_M6,
    urlM6: `http://127.0.0.1:${puerto}/api/v1`,
    tiempoModulosMs: 2000,
    reintentosModulos: 0,
    encabezadoCorrelacion: 'X-Request-Id',
    reintentarDespuesS: 5,
  });
});
afterAll(async () => {
  await app.close();
});

describe('M2 entiende al M6 simulado (RNF-13.7)', () => {
  it('el historial: la página con los viajes del cliente, el más nuevo primero', async () => {
    const pagina = await m2.listarViajes(CLIENTE, 0, 20, 'historial-1');

    expect(pagina.total).toBe(2);
    expect(pagina.items.map((v) => [v.id, v.state])).toEqual([
      [EN_CURSO, 'IN_PROGRESS'],
      [COMPLETADO, 'COMPLETED'],
    ]);
  });

  it('calificar: un viaje completado del cliente trae su conductor', async () => {
    expect(await m2.obtenerViaje(COMPLETADO, CLIENTE, 'calificar-1')).toEqual({ estado: 'COMPLETED', conductorId: CONDUCTOR });
  });

  it('calificar: un viaje en curso trae su estado', async () => {
    expect(await m2.obtenerViaje(EN_CURSO, CLIENTE, 'calificar-2')).toEqual({ estado: 'IN_PROGRESS' });
  });

  it('calificar: uno ajeno o inexistente es null (M2 responde 404)', async () => {
    expect(await m2.obtenerViaje(AJENO, CLIENTE, 'calificar-3')).toBeNull();
    expect(await m2.obtenerViaje('44444444-4444-4444-8444-444444444444', CLIENTE, 'calificar-4')).toBeNull();
  });
});
