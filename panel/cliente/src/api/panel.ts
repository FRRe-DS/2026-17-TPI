import { ErrorDeApi, errorDeRespuesta, m2NoResponde } from './errores.js';
import { TIEMPO_MAXIMO_MS } from './m2.js';

// Lo que el navegador le pide al servidor del panel y no a M2 (plan, Rutas propias): hoy, el canal de control del M6 simulado
// (RNF-13.5, RF-2.1.10). Los errores son los mismos que los de M2: un `ErrorDeApi` con el `problem+json` tal como vino.

export type NombreDeEscenario = 'completado' | 'enCurso' | 'ajeno' | 'inexistente';
// Lo que M2 va a responder al calificar ese viaje, con el M6 simulado en modo normal (RNF-13.5).
export type Escenario = { nombre: NombreDeEscenario; viajeId: string; respuestaDeM2: 201 | 422 | 404 };
export type ModoM6 = 'normal' | 'lento' | 'caido';
// Lo que informa el canal de control: el modo y cuánto espera el modo lento antes de contestar.
export type EstadoM6 = { modo: ModoM6; retardoLentoMs: number };
export type EjemploDeViajes = { clienteId: string; escenarios: Escenario[] };

// Un pedido a M2 tal como lo guarda el panel para el detalle técnico (RNF-14.9): con el `Authorization` ya enmascarado y el `curl`
// que lo repite, con `$TOKEN` en lugar del token. El más nuevo viene primero y son 50 como mucho.
export type PedidoDelPanel = {
  requestId: string;
  hora: string;
  metodo: string;
  ruta: string;
  encabezados: Record<string, string>;
  cuerpo?: string;
  cuerpoOmitido?: boolean;
  estado: number;
  duracionMs: number;
  curl: string;
};

export type OpcionesApiPanel = {
  // Solo para las pruebas.
  fetch?: typeof fetch;
  tiempoMaximoMs?: number;
};

export function crearApiPanel({ fetch: pedirHttp = (...args) => globalThis.fetch(...args), tiempoMaximoMs = TIEMPO_MAXIMO_MS }: OpcionesApiPanel = {}) {
  async function pedir<T>(metodo: 'GET' | 'PUT' | 'POST', ruta: string, senal?: AbortSignal, cuerpo?: unknown): Promise<T> {
    const tiempo = new AbortController();
    const temporizador = setTimeout(() => tiempo.abort(), tiempoMaximoMs);
    try {
      const respuesta = await pedirHttp(ruta, {
        method: metodo,
        headers: cuerpo === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
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
    // Los últimos pedidos que el panel le hizo a M2 (RNF-14.9). Este pedido no es de M2 y no queda registrado.
    listarPedidos: (senal?: AbortSignal) => pedir<{ pedidos: PedidoDelPanel[] }>('GET', '/panel/pedidos', senal),
    // El modo del M6 simulado (RNF-13.5): `normal` responde, `lento` tarda más de lo que M2 espera y `caido` no acepta conexiones.
    obtenerEstadoM6: (senal?: AbortSignal) => pedir<EstadoM6>('GET', '/panel/m6/estado', senal),
    cambiarModoM6: (modo: ModoM6, senal?: AbortSignal) => pedir<EstadoM6>('PUT', '/panel/m6/modo', senal, { modo }),
    // Repone los viajes de ejemplo del cliente en el M6 simulado y devuelve sus escenarios. Repetirlo da lo mismo (RF-2.1.11).
    cargarEjemploDeViajes: (clienteId: string, senal?: AbortSignal) =>
      pedir<EjemploDeViajes>('POST', `/panel/m6/clientes/${encodeURIComponent(clienteId)}/ejemplo`, senal),
  };
}

export type ApiPanel = ReturnType<typeof crearApiPanel>;
