import type { ConfigM6 } from '../../../panel/servidor/config.js';
import { construirAppM6 } from '../../../panel/m6-simulado/app-m6.js';
import { crearEstadoM6 } from '../../../panel/m6-simulado/estado.js';
import type { Viaje } from '../../../panel/m6-simulado/cuerpos.js';
import { descartarLogs } from '../../ayudas/logs.js';

// La configuración del M6 simulado en las pruebas: la de M2 en las pruebas (emisor, audiencia de M6 y clave), así un token de
// servicio que firma M2 con esa configuración lo acepta.
export const CONFIG_M6: ConfigM6 = {
  puerto: 3006,
  puertoControl: 3007,
  retardoLentoMs: 5000,
  claveTokens: 'clave-de-prueba-de-32-caracteres!',
  emisorTokens: 'm1-identidad',
  audienciaTokens: 'm2-clientes',
  campoRoles: 'roles',
  audienciaM6: 'm6-viajes',
};

export const CLIENTE = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
export const OTRO_CLIENTE = '9e8d7c6b-5a49-4382-9716-0f1e2d3c4b5a';
export const CONDUCTOR = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';

// Un viaje guardado en el M6 simulado: completado, del CLIENTE y con CONDUCTOR, salvo lo que se cambie.
export const viaje = (id: string, cambios: Partial<Viaje> = {}): Viaje => ({
  id,
  requestId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  clientId: CLIENTE,
  driverId: CONDUCTOR,
  vehicleId: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
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

export function crearM6(viajes: Viaje[] = []) {
  const estado = crearEstadoM6();
  for (const v of viajes) estado.guardar(v);
  return { estado, app: construirAppM6({ config: CONFIG_M6, estado, flujoLog: descartarLogs }) };
}
