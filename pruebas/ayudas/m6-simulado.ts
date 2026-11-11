// Los cuerpos del M6 simulado, con la forma de `contrato/dependencias/m6.yml` (contrato de M6 en la cátedra, ADR 096). Las
// pruebas arman con esto lo que responde M6, y `pruebas/unitarias/m6-simulado.test.ts` comprueba que cumplan el contrato
// (008, criterios de finalización). Lo que una prueba cambie con `extra` puede dejar de cumplirlo a propósito: M2 no confía
// en que M6 lo cumpla.

// El viaje de la posición `n` de una página: un UUID fijo por número, para poder pedirlo y compararlo.
export const idDeViaje = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// `TripSummary`: el viaje de la lista, completado y con conductor, salvo lo que cambie la prueba. Una clave en `undefined`
// sale del JSON, como un campo que M6 no manda.
export const resumenDeM6 = (n: number, clientId: string, driverId: string, extra: object = {}) => ({
  id: idDeViaje(n),
  state: 'COMPLETED',
  vehicleType: 'CAR',
  clientId,
  driverId,
  distanceKm: 3.2,
  durationMinutes: 12,
  createdAt: '2026-10-01T10:00:00Z',
  ...extra,
});

// `TripSummaryPage`: la respuesta de `GET /trips`.
export const paginaDeM6 = (items: unknown[], total: number, extra: object = {}) => ({ items, page: 1, pageSize: 20, total, ...extra });

// `Trip`: la respuesta de `GET /trips/{tripId}`, con los campos que M2 no lee.
export const viajeDeM6 = (viajeId: string, clientId: string, driverId: string, extra: object = {}) => ({
  id: viajeId,
  requestId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  reservationId: null,
  clientId,
  driverId,
  vehicleId: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
  vehicleType: 'CAR',
  originLatitude: -27.45,
  originLongitude: -58.98,
  destinationLatitude: -27.47,
  destinationLongitude: -58.83,
  state: 'COMPLETED',
  version: 4,
  distanceKm: 3.2,
  durationMinutes: 12,
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:12:00Z',
  ...extra,
});

// El `code` y el `title` con los que M6 acompaña cada código HTTP, de la lista cerrada de `Problem`.
const PROBLEMAS_DE_M6: Record<number, readonly [code: string, title: string]> = {
  400: ['VALIDATION', 'Datos inválidos'],
  401: ['UNAUTHENTICATED', 'No autenticado'],
  403: ['FORBIDDEN', 'Acción no permitida'],
  404: ['TRIP_NOT_FOUND', 'Viaje no encontrado'],
  409: ['INVALID_STATE_TRANSITION', 'Transición inválida'],
  422: ['REASON_NOT_ALLOWED', 'Motivo no permitido'],
  429: ['TOO_MANY_REQUESTS', 'Demasiados pedidos'],
};

// `Problem`: el cuerpo de un 4xx de M6 (`application/problem+json`). `detail` y `message` dicen lo mismo y pueden llevar un
// dato que no tiene que llegar al log ni a la respuesta de M2.
export const errorDeM6 = (status: number, message = 'error de M6', extra: object = {}) => {
  const [code, title] = PROBLEMAS_DE_M6[status] ?? ['INTERNAL_ERROR', 'Error interno'];
  return {
    type: `https://movilidad.example/errors/${code.toLowerCase().replaceAll('_', '-')}`,
    title,
    status,
    code,
    detail: message,
    message,
    timestamp: '2026-10-26T12:00:00Z',
    ...extra,
  };
};
