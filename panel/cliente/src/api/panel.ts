import { ErrorDeApi, errorDeRespuesta, m2NoResponde } from './errores.js';
import { TIEMPO_MAXIMO_MS } from './m2.js';

// Lo que el navegador le pide al servidor del panel y no a M2 (plan, Rutas propias): hoy, el canal de control del M6 simulado
// (RNF-13.5, RF-2.1.10). Los errores son los mismos que los de M2: un `ErrorDeApi` con el `problem+json` tal como vino.

export type NombreDeEscenario = 'completado' | 'enCurso' | 'ajeno' | 'inexistente';
// Lo que M2 va a responder al calificar ese viaje, con el M6 simulado en modo normal (RNF-13.5).
export type Escenario = { nombre: NombreDeEscenario; viajeId: string; respuestaDeM2: 201 | 422 | 404 };
export type EjemploDeViajes = { clienteId: string; escenarios: Escenario[] };

export type OpcionesApiPanel = {
  // Solo para las pruebas.
  fetch?: typeof fetch;
  tiempoMaximoMs?: number;
};

export function crearApiPanel({ fetch: pedirHttp = (...args) => globalThis.fetch(...args), tiempoMaximoMs = TIEMPO_MAXIMO_MS }: OpcionesApiPanel = {}) {
  async function pedir<T>(metodo: 'GET' | 'PUT' | 'POST', ruta: string, senal?: AbortSignal): Promise<T> {
    const tiempo = new AbortController();
    const temporizador = setTimeout(() => tiempo.abort(), tiempoMaximoMs);
    try {
      const respuesta = await pedirHttp(ruta, {
        method: metodo,
        headers: { Accept: 'application/json' },
        signal: senal === undefined ? tiempo.signal : AbortSignal.any([tiempo.signal, senal]),
      });
      if (!respuesta.ok) throw await errorDeRespuesta(respuesta);
      return (await respuesta.json()) as T;
    } catch (error) {
      if (error instanceof ErrorDeApi) throw error;
      // La persona canceló: no es un fallo del panel. Si el tiempo también se agotó, manda el tiempo.
      if (senal?.aborted && !tiempo.signal.aborted) throw error;
      throw m2NoResponde();
    } finally {
      clearTimeout(temporizador);
    }
  }

  return {
    // Repone los viajes de ejemplo del cliente en el M6 simulado y devuelve sus escenarios. Repetirlo da lo mismo (RF-2.1.11).
    cargarEjemploDeViajes: (clienteId: string, senal?: AbortSignal) =>
      pedir<EjemploDeViajes>('POST', `/panel/m6/clientes/${encodeURIComponent(clienteId)}/ejemplo`, senal),
  };
}

export type ApiPanel = ReturnType<typeof crearApiPanel>;
