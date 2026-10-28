import type { Esperado } from './casos.js';

// Cómo decide la vista si un caso dio ✔ o ✘ (spec 072, T11, RNF-07.4): el código siempre y, cuando el caso lo pide, el `type` del
// problema, `Retry-After` y `Location`. Todo error (4xx o 5xx) además tiene que ser `application/problem+json` (RNF-03.6). Es una
// función pura sobre lo que llegó: no sabe de red.

// Los encabezados de cada respuesta que la vista muestra.
export const ENCABEZADOS_RELEVANTES = ['content-type', 'location', 'retry-after', 'x-request-id'] as const;

// Lo que llegó. `estado` 0 es «no hubo respuesta»; los nombres de los encabezados van en minúsculas; `type` es el del problem+json.
export type RespuestaObservada = {
  estado: number;
  encabezados: Record<string, string>;
  type?: string;
  cuerpo?: unknown;
};

// `motivo` solo viene cuando es ✘: una línea que dice qué falló primero.
export type Veredicto = { correcto: true } | { correcto: false; motivo: string };

const PROBLEMA = 'application/problem+json';

// Una línea y de largo acotado, aunque lo que llegó traiga saltos de línea.
const enUnaLinea = (texto: string): string => texto.replace(/\s*[\r\n]+\s*/g, ' ').slice(0, 200);

const tieneValor = (encabezados: Record<string, string>, nombre: string): boolean => (encabezados[nombre] ?? '').trim() !== '';

export function compararRespuesta(esperado: Esperado, respuesta: RespuestaObservada): Veredicto {
  const fallo = (motivo: string): Veredicto => ({ correcto: false, motivo: enUnaLinea(motivo) });

  if (respuesta.estado !== esperado.estado) {
    return fallo(`se esperaba ${esperado.estado}, ${respuesta.estado === 0 ? 'no hubo respuesta' : `llegó ${respuesta.estado}`}`);
  }

  if (respuesta.estado >= 400) {
    const tipo = (respuesta.encabezados['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (tipo !== PROBLEMA) return fallo(`el error llegó ${tipo === '' ? 'sin Content-Type' : `como ${tipo}`} y no como ${PROBLEMA}`);
  }

  if (esperado.type !== undefined && respuesta.type !== esperado.type) {
    return fallo(`se esperaba el error ${esperado.type}, ${respuesta.type === undefined ? 'no llegó ninguno' : `llegó ${respuesta.type}`}`);
  }
  if (esperado.conRetryAfter && !tieneValor(respuesta.encabezados, 'retry-after')) return fallo('falta el encabezado Retry-After');
  if (esperado.conLocation && !tieneValor(respuesta.encabezados, 'location')) return fallo('falta el encabezado Location');

  return { correcto: true };
}
