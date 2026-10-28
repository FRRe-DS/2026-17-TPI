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

// Lo que el panel responde en `/panel/demo/…` (spec 072): el mismo contrato que `panel/servidor/demo/`, escrito acá porque el
// navegador no importa código del servidor.
export type Disponibilidad = { disponible: boolean; motivo?: string; comoActivar?: string };
export type EstadoDemo = { base: Disponibilidad; docker: Disponibilidad };
export type ModoDeAltas = 'misma-clave' | 'claves-distintas';
// Cuántas respuestas hubo de cada código; `0` es «sin respuesta».
export type PorCodigo = Record<string, number>;
export type ResultadoSimultaneo = {
  clienteId: string;
  n: number;
  porCodigo: PorCodigo;
  // Solo con la misma clave: si todos los 201 trajeron el mismo cuerpo.
  cuerposIguales?: boolean;
  // `null` si no se pudo contar, con el motivo.
  filas: number | null;
  motivoFilas?: string;
  esperado: { porCodigo: PorCodigo; filas: number };
  cumple: boolean;
  // El comienzo del `X-Request-Id` de los N pedidos, para buscarlos en `docker compose logs m2`.
  prefijoRequestId: string;
};
export type ResultadoRestriccion = {
  clienteId: string;
  filasAntes: number | null;
  filasDespues: number | null;
  restriccion?: string;
  codigo?: string;
  mensaje?: string;
  cumple: boolean;
};
// La salud de M2: `estado` es el código de `GET /health`, o `null` si no respondió.
export type SaludDeM2 = { estado: number | null; duracionMs: number };

// El panel espera hasta 60 s a `docker compose start` y hasta 30 s a `docker compose stop` (spec 072, RNF-13.4): los pedidos de
// encender y de apagar esperan un poco más, para que el corte que se vea sea el del panel, con su motivo.
export const CORTE_DE_ENCENDER_MS = 70_000;
export const CORTE_DE_APAGAR_MS = 40_000;
// Las pruebas de integridad hacen mucho en el servidor: crear el cliente, preparar el M6 simulado, lanzar los N pedidos (hasta 10 s) y
// contar filas. El peor caso suma unos 36,5 s. Si el navegador cortara antes, mostraría «M2 no responde» y soltaría el cerrojo de
// la vista con el servidor todavía trabajando, y se podría lanzar otra cosa encima (las calificaciones ponen el M6 simulado en
// «normal» y después lo reponen).
export const CORTE_DE_INTEGRIDAD_MS = 45_000;

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
  async function pedir<T>(metodo: 'GET' | 'PUT' | 'POST', ruta: string, senal?: AbortSignal, cuerpo?: unknown, corteMs: number = tiempoMaximoMs): Promise<T> {
    const tiempo = new AbortController();
    const temporizador = setTimeout(() => tiempo.abort(), corteMs);
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

    // La vista «Demostración» (spec 072): lo que ve la persona antes de probar, las pruebas simultáneas desde el servidor del panel,
    // la restricción de la base y el control de la base con Docker.
    obtenerEstadoDemo: (senal?: AbortSignal) => pedir<EstadoDemo>('GET', '/panel/demo/estado', senal),
    lanzarAltasSimultaneas: (n: number, modo: ModoDeAltas, senal?: AbortSignal) =>
      pedir<ResultadoSimultaneo>('POST', '/panel/demo/altas-simultaneas', senal, { n, modo }, CORTE_DE_INTEGRIDAD_MS),
    lanzarCalificacionesSimultaneas: (n: number, senal?: AbortSignal) => pedir<ResultadoSimultaneo>('POST', '/panel/demo/calificaciones-simultaneas', senal, { n }, CORTE_DE_INTEGRIDAD_MS),
    probarRestriccionDelPuntaje: (senal?: AbortSignal) => pedir<ResultadoRestriccion>('POST', '/panel/demo/restriccion-puntaje', senal, {}, CORTE_DE_INTEGRIDAD_MS),
    apagarBase: (senal?: AbortSignal) => pedir<{ ejecutado: true }>('POST', '/panel/demo/base/apagar', senal, {}, CORTE_DE_APAGAR_MS),
    encenderBase: (senal?: AbortSignal) => pedir<{ ejecutado: true }>('POST', '/panel/demo/base/encender', senal, {}, CORTE_DE_ENCENDER_MS),
    // El sondeo de la salud en vivo: no queda en el detalle técnico.
    consultarSaludDeM2: (senal?: AbortSignal) => pedir<SaludDeM2>('GET', '/panel/demo/salud', senal),
  };
}

export type ApiPanel = ReturnType<typeof crearApiPanel>;
