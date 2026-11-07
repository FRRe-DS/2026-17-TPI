import { randomUUID } from 'node:crypto';
import { describirRespuesta } from './errores.js';
import { pedirM6, type Respuesta } from './pedir.js';

// La preparación de viajes en el M6 real (spec 081, plan «Preparación de un viaje»). Rutas, cuerpos y roles salen de `openapi.yaml`
// de M6 en el commit fijado en docker-compose.yml, no de lo que supone contrato/dependencias/m6.yml. Se usan los atajos de demo
// de M6 (ENABLE_DEMO_AUTH): `SYSTEM`, `DRIVER:<id>` y `CLIENT:<id>` como token. Esto lo hace solo la prueba, nunca M2.
export type EstadoFinal = 'COMPLETED' | 'CANCELLED' | 'IN_PROGRESS';

export type Viaje = { viajeId: string; clienteId: string; conductorId: string; estado: EstadoFinal };

function exigir(respuesta: Respuesta, esperados: number[], paso: string): void {
  if (!esperados.includes(respuesta.estado)) {
    throw new Error(`Preparar el viaje falló en «${paso}»: ${describirRespuesta(respuesta)}`);
  }
}

// Un viaje en el estado pedido, para un cliente. Cada llamada usa un conductor, un vehículo y una solicitud nuevos.
export async function crearViaje(clienteId: string, estado: EstadoFinal): Promise<Viaje> {
  const conductorId = randomUUID();
  const creado = await pedirM6('POST', '/trips', {
    token: 'SYSTEM',
    cuerpo: {
      requestId: randomUUID(),
      clientId: clienteId,
      driverId: conductorId,
      vehicleId: randomUUID(),
      vehicleType: 'CAR',
      originLatitude: -27.4511,
      originLongitude: -58.9867,
      destinationLatitude: -27.4698,
      destinationLongitude: -58.8306,
      originAddress: 'Origen de la prueba',
      destinationAddress: 'Destino de la prueba',
    },
  });
  exigir(creado, [200, 201], 'createTrip');
  const viajeId = (creado.cuerpo as { id: string }).id;
  const conductor = `DRIVER:${conductorId}`;

  if (estado === 'CANCELLED') {
    // El cliente puede cancelar desde PENDING_ARRIVAL con el motivo CHANGE_OF_PLANS.
    const cancelado = await pedirM6('POST', `/trips/${viajeId}/cancel`, {
      token: `CLIENT:${clienteId}`,
      cuerpo: { reason: 'CHANGE_OF_PLANS' },
    });
    exigir(cancelado, [200], 'cancelTrip');
    return { viajeId, clienteId, conductorId, estado };
  }

  exigir(await pedirM6('POST', `/trips/${viajeId}/arrived`, { token: conductor }), [200], 'registerArrival');
  // M8 es simulado: M6 acepta cualquier código que no sea «invalid», «expired» o «invalid_…», y cada código sirve una sola vez.
  exigir(
    await pedirM6('POST', `/trips/${viajeId}/start`, { token: conductor, cuerpo: { verificationToken: `qr-${randomUUID()}` } }),
    [200],
    'startTrip',
  );
  if (estado === 'COMPLETED') {
    exigir(await pedirM6('POST', `/trips/${viajeId}/complete`, { token: conductor, cuerpo: { distanceKm: 6.4 } }), [200], 'completeTrip');
  }
  return { viajeId, clienteId, conductorId, estado };
}
