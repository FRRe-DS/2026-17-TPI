import type { PedidoDelCaso, RespuestaDelCaso } from '../logica/ejecutar-caso.js';
import { TIEMPO_MAXIMO_MS } from './m2.js';

// El `pedir` de los casos de la vista «Demostración» (spec 072, T12): manda cada pedido al panel, que lo reenvía a M2 con un token
// firmado (RNF-12.6), y devuelve lo que llegó sea lo que sea. A diferencia de `api/m2.ts`, un 4xx o un 5xx no es una excepción:
// que M2 responda un 409 es justo lo que el caso espera. Solo lanza si no hubo respuesta (tiempo agotado o conexión caída) y con un
// mensaje corto, sin direcciones ni nada que la vista no deba mostrar.

export type OpcionesPedirDeCasos = {
  // Solo para las pruebas.
  fetch?: typeof fetch;
  tiempoMaximoMs?: number;
};

export function crearPedirDeCasos({ fetch: pedirHttp = (...args) => globalThis.fetch(...args), tiempoMaximoMs = TIEMPO_MAXIMO_MS }: OpcionesPedirDeCasos = {}) {
  return async function pedir(pedido: PedidoDelCaso): Promise<RespuestaDelCaso> {
    const encabezados: Record<string, string> = { Accept: 'application/json' };
    if (pedido.identidad !== null) {
      encabezados['X-Panel-Rol'] = pedido.identidad.rol;
      encabezados['X-Panel-Sub'] = pedido.identidad.sub;
    }
    if (pedido.clave !== undefined) encabezados['Idempotency-Key'] = pedido.clave;
    if (pedido.cuerpo !== undefined) encabezados['Content-Type'] = 'application/json';

    // El tiempo máximo cuenta hasta tener el cuerpo entero, no solo hasta las cabeceras.
    const tiempo = new AbortController();
    const temporizador = setTimeout(() => tiempo.abort(), tiempoMaximoMs);
    try {
      const respuesta = await pedirHttp(pedido.ruta, {
        method: pedido.metodo,
        headers: encabezados,
        body: pedido.cuerpo === undefined ? undefined : JSON.stringify(pedido.cuerpo),
        signal: tiempo.signal,
      });
      const texto = await respuesta.text();
      const nombres: Record<string, string> = {};
      respuesta.headers.forEach((valor, nombre) => {
        nombres[nombre.toLowerCase()] = valor;
      });
      return { estado: respuesta.status, encabezados: nombres, ...(texto === '' ? {} : { cuerpo: leerJson(texto) }) };
    } catch {
      throw new Error(tiempo.signal.aborted ? `no respondió en ${Math.round(tiempoMaximoMs / 1000)} s` : 'no se pudo conectar');
    } finally {
      clearTimeout(temporizador);
    }
  };
}

// Un cuerpo que no es JSON (el HTML de un proxy, texto) no se interpreta: el caso lo ve como una respuesta sin campos.
function leerJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return undefined;
  }
}
