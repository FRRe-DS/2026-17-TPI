// Los cuerpos del M6 simulado, con la forma de `contrato/dependencias/m6.yml` (contrato del Grupo 12). Es el mismo contrato
// que lee M2, así que lo que M2 entiende del simulado es lo que va a entender del M6 de verdad (RNF-13.7).

export const ESTADOS_DE_VIAJE = [
  'PENDING_ARRIVAL',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED_BY_CLIENT',
  'CANCELLED_BY_DRIVER',
] as const;
export type EstadoDeViaje = (typeof ESTADOS_DE_VIAJE)[number];

// `Trip`: lo que se guarda y lo que responde `GET /trips/{id}`. `driverId` falta mientras no hay conductor asignado.
export type Viaje = {
  id: string;
  requestId: string;
  clientId: string;
  driverId?: string | undefined;
  vehicleId: string;
  originLatitude: number;
  originLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
  state: EstadoDeViaje;
  distanceKm: number | null;
  durationMinutes: number | null;
  createdAt: string;
  updatedAt: string;
};

// `TripSummary`: el viaje de la lista, sin coordenadas (RF-4.7).
export const resumen = ({ id, state, clientId, driverId, distanceKm, durationMinutes, createdAt }: Viaje) => ({
  id,
  state,
  clientId,
  ...(driverId === undefined ? {} : { driverId }),
  distanceKm,
  durationMinutes,
  createdAt,
});

// `TripSummaryPage`: la respuesta de `GET /trips`.
export const pagina = (items: ReturnType<typeof resumen>[], page: number, pageSize: number, total: number) => ({ items, page, pageSize, total });

// `ErrorResponse`: el cuerpo de todo error del M6 simulado, con el id de correlación que mandó quien llama.
export const errorM6 = (code: string, message: string, correlationId?: string) => ({
  code,
  message,
  ...(correlationId === undefined ? {} : { correlationId }),
  timestamp: new Date().toISOString(),
});
