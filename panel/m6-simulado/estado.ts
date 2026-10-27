import type { EstadoDeViaje, Viaje } from './cuerpos.js';
import { CLIENTE_DEL_AJENO, CONDUCTOR_DE_EJEMPLO, derivarUuid, ID_AJENO, ID_INEXISTENTE, idsDeEjemplo } from './ids.js';

// Los viajes y el modo del M6 simulado, en memoria: se pierden al reiniciarlo y «Cargar ejemplo» los repone (plan, Datos). Los
// ids se guardan en minúscula, porque un UUID no distingue mayúsculas.

export type FiltroDeViajes = { clientId?: string | undefined; driverId?: string | undefined; state?: EstadoDeViaje | undefined };

// normal: responde. lento: espera `M6_RETARDO_LENTO_MS` antes de responder. caido: no acepta conexiones.
export const MODOS = ['normal', 'lento', 'caido'] as const;
export type Modo = (typeof MODOS)[number];

// Qué escenario es cada viaje de ejemplo y qué responde M2 al calificar con ese viaje (RNF-13.5).
export type Escenario = {
  nombre: 'completado' | 'enCurso' | 'ajeno' | 'inexistente';
  viajeId: string;
  respuestaDeM2: 201 | 422 | 404;
};

// Las fechas son fijas: cargar el ejemplo otra vez repone exactamente el mismo viaje.
const viajeDeEjemplo = (id: string, clientId: string, cambios: Partial<Viaje>): Viaje => ({
  id,
  requestId: derivarUuid(`${id}|solicitud`),
  clientId,
  driverId: CONDUCTOR_DE_EJEMPLO,
  vehicleId: derivarUuid(`${id}|vehiculo`),
  originLatitude: -27.45,
  originLongitude: -58.98,
  destinationLatitude: -27.47,
  destinationLongitude: -58.83,
  state: 'COMPLETED',
  distanceKm: 3.2,
  durationMinutes: 12,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:12:00.000Z',
  ...cambios,
});

export function crearEstadoM6() {
  const viajes = new Map<string, Viaje>();
  const igual = (a: string | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();
  let modo: Modo = 'normal';

  const estado = {
    modo: (): Modo => modo,
    cambiarModo(nuevo: Modo): void {
      modo = nuevo;
    },
    // Guarda o reemplaza un viaje por su id.
    guardar(viaje: Viaje): void {
      viajes.set(viaje.id.toLowerCase(), viaje);
    },
    buscar: (id: string): Viaje | undefined => viajes.get(id.toLowerCase()),
    // Los que cumplen todos los filtros, del más nuevo al más viejo por `createdAt`, como `GET /trips`.
    listar({ clientId, driverId, state }: FiltroDeViajes): Viaje[] {
      return [...viajes.values()]
        .filter((viaje) => clientId === undefined || igual(viaje.clientId, clientId))
        .filter((viaje) => driverId === undefined || igual(viaje.driverId, driverId))
        .filter((viaje) => state === undefined || viaje.state === state)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    },
    // Un viaje completado y uno en curso del cliente, y el viaje ajeno de todos. Si ya estaban, los reemplaza por lo mismo.
    cargarEjemplo(clienteId: string): void {
      const cliente = clienteId.toLowerCase();
      const ids = idsDeEjemplo(cliente);
      estado.guardar(viajeDeEjemplo(ids.completado, cliente, {}));
      estado.guardar(
        viajeDeEjemplo(ids.enCurso, cliente, {
          state: 'IN_PROGRESS',
          distanceKm: null,
          durationMinutes: null,
          createdAt: '2026-10-02T10:00:00.000Z',
          updatedAt: '2026-10-02T10:00:00.000Z',
        }),
      );
      estado.guardar(viajeDeEjemplo(ID_AJENO, CLIENTE_DEL_AJENO, {}));
    },
    // Los cuatro escenarios de un cliente, con el id de cada uno. El inexistente no se guarda nunca.
    escenarios(clienteId: string): Escenario[] {
      const ids = idsDeEjemplo(clienteId);
      return [
        { nombre: 'completado', viajeId: ids.completado, respuestaDeM2: 201 },
        { nombre: 'enCurso', viajeId: ids.enCurso, respuestaDeM2: 422 },
        { nombre: 'ajeno', viajeId: ID_AJENO, respuestaDeM2: 404 },
        { nombre: 'inexistente', viajeId: ID_INEXISTENTE, respuestaDeM2: 404 },
      ];
    },
  };
  return estado;
}

export type EstadoM6 = ReturnType<typeof crearEstadoM6>;
