import type { EstadoDeViaje, Viaje } from './cuerpos.js';

// Los viajes del M6 simulado, en memoria: se pierden al reiniciarlo y «Cargar ejemplo» los repone (plan, Datos). Los ids se
// guardan en minúscula, porque un UUID no distingue mayúsculas.

export type FiltroDeViajes = { clientId?: string | undefined; driverId?: string | undefined; state?: EstadoDeViaje | undefined };

export function crearEstadoM6() {
  const viajes = new Map<string, Viaje>();
  const igual = (a: string | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();

  return {
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
  };
}

export type EstadoM6 = ReturnType<typeof crearEstadoM6>;
