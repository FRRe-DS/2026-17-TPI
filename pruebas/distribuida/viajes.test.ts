import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { describirRespuesta } from './ayudas/errores.js';
import { pedirM6 } from './ayudas/pedir.js';
import { crearViaje } from './ayudas/viajes.js';

// La preparación de viajes con los atajos de demo de M6 (spec 081, T3): cada estado final se alcanza por las rutas del
// openapi.yaml de M6 en el commit fijado, para un cliente nuevo.
async function estadoEnM6(viajeId: string): Promise<{ state?: string; clientId?: string; driverId?: string }> {
  const respuesta = await pedirM6('GET', `/trips/${viajeId}`, { token: 'SYSTEM' });
  expect(respuesta.estado, describirRespuesta(respuesta)).toBe(200);
  return respuesta.cuerpo as { state?: string; clientId?: string; driverId?: string };
}

describe('crearViaje: los viajes de la prueba en el M6 real (RNF-07.7, RNF-07.11)', () => {
  it.each(['COMPLETED', 'CANCELLED', 'IN_PROGRESS'] as const)('deja un viaje %s para un cliente nuevo', async (estado) => {
    const clienteId = randomUUID();
    const viaje = await crearViaje(clienteId, estado);
    expect(viaje.estado).toBe(estado);
    const m6 = await estadoEnM6(viaje.viajeId);
    expect(m6.state).toBe(estado);
    expect(m6.clientId).toBe(clienteId);
    expect(m6.driverId).toBe(viaje.conductorId);
  });

  it('cada llamada crea otro viaje', async () => {
    const clienteId = randomUUID();
    const a = await crearViaje(clienteId, 'COMPLETED');
    const b = await crearViaje(clienteId, 'COMPLETED');
    expect(a.viajeId).not.toBe(b.viajeId);
  });
});
