// Los cuerpos del M6 simulado, con la forma de `contrato/dependencias/m6.yml` (contrato de M6 en la cátedra, ADR 096). Es el
// mismo contrato que lee M2, así que lo que M2 entiende del simulado es lo que va a entender del M6 de verdad (RNF-13.7).

export const ESTADOS_DE_VIAJE = ['PENDING_ARRIVAL', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type EstadoDeViaje = (typeof ESTADOS_DE_VIAJE)[number];

// `Trip`: lo que se guarda y lo que responde `GET /trips/{tripId}`. `version` sube en 1 con cada transición del viaje.
export type Viaje = {
  id: string;
  requestId: string;
  reservationId: string | null;
  clientId: string;
  driverId: string;
  vehicleId: string;
  vehicleType: 'CAR' | 'MOTORCYCLE';
  originLatitude: number;
  originLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
  state: EstadoDeViaje;
  version: number;
  distanceKm: number | null;
  durationMinutes: number | null;
  createdAt: string;
  updatedAt: string;
};

// `TripSummary`: el viaje de la lista, sin coordenadas (RF-4.7).
export const resumen = ({ id, state, vehicleType, clientId, driverId, distanceKm, durationMinutes, createdAt }: Viaje) => ({
  id,
  state,
  vehicleType,
  clientId,
  driverId,
  distanceKm,
  durationMinutes,
  createdAt,
});

// `TripSummaryPage`: la respuesta de `GET /trips`.
export const pagina = (items: ReturnType<typeof resumen>[], page: number, pageSize: number, total: number) => ({ items, page, pageSize, total });

// Los `code` de `Problem` que usa el simulado, con su código HTTP y su título. La lista del contrato tiene más: son los de
// las operaciones que M2 no consume.
export const PROBLEMAS = {
  VALIDATION: [400, 'Datos inválidos'],
  UNAUTHENTICATED: [401, 'No autenticado'],
  TRIP_NOT_FOUND: [404, 'Viaje no encontrado'],
  ROUTE_NOT_FOUND: [404, 'Ruta no encontrada'],
  INTERNAL_ERROR: [500, 'Error interno'],
} as const;
export type CodigoDeProblema = keyof typeof PROBLEMAS;

// `Problem`: el cuerpo de todo error del M6 simulado (`application/problem+json`), con el id de correlación de quien llama.
// `detail` y `message` dicen lo mismo, como en el contrato.
export const errorM6 = (code: CodigoDeProblema, message: string, correlationId?: string) => {
  const [status, title] = PROBLEMAS[code];
  return {
    type: `https://movilidad.example/errors/${code.toLowerCase().replaceAll('_', '-')}`,
    title,
    status,
    code,
    detail: message,
    message,
    timestamp: new Date().toISOString(),
    ...(correlationId === undefined ? {} : { correlationId }),
  };
};
