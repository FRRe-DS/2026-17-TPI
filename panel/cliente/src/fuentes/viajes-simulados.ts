import { crearApiPanel, type ApiPanel, type EjemploDeViajes, type EstadoM6, type ModoM6 } from '../api/panel.js';

// La fuente de los viajes (RNF-02.2): hoy es el M6 simulado del propio panel, al que se llega por `/panel/m6/…`. Esta es la
// segunda mitad de los puntos de conexión: el ejemplo, el modo y sus escenarios. Cuando exista M6 se cambia esta fuente y las
// pantallas quedan.
export const ETIQUETA_VIAJES = 'simulado, pendiente de M6';

export interface FuenteDeViajes {
  // «simulado, pendiente de M6»: lo que las pantallas muestran junto a lo que depende de esta fuente (RNF-12.7).
  readonly etiqueta: string;
  // Deja un viaje completado y uno en curso del cliente, con los mismos ids cada vez (RF-2.1.10, RF-2.1.11).
  cargarEjemplo(clienteId: string, senal?: AbortSignal): Promise<EjemploDeViajes>;
  // El modo del M6 simulado y cómo cambiarlo (RNF-13.5).
  estado(senal?: AbortSignal): Promise<EstadoM6>;
  ponerModo(modo: ModoM6, senal?: AbortSignal): Promise<EstadoM6>;
}

export const crearViajesSimulados = (api: ApiPanel): FuenteDeViajes => ({
  etiqueta: ETIQUETA_VIAJES,
  cargarEjemplo: (clienteId, senal) => api.cargarEjemploDeViajes(clienteId, senal),
  estado: (senal) => api.obtenerEstadoM6(senal),
  ponerModo: (modo, senal) => api.cambiarModoM6(modo, senal),
});

export const fuenteDeViajes: FuenteDeViajes = crearViajesSimulados(crearApiPanel());
