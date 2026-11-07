import type { Respuesta } from './pedir.js';

const MAXIMO = 300;

// Cómo se cuenta lo que contestó un módulo en el mensaje de una falla: el código HTTP y, si el cuerpo es un ErrorResponse de M6
// (`code`, `title`, `detail`), el `code` y el detalle; si no, el comienzo del texto.
export function describirRespuesta(respuesta: Pick<Respuesta, 'estado' | 'texto' | 'cuerpo'>): string {
  const partes = [`HTTP ${respuesta.estado}`];
  const cuerpo = respuesta.cuerpo;
  if (typeof cuerpo === 'object' && cuerpo !== null && 'code' in cuerpo && typeof cuerpo.code === 'string') {
    partes.push(`code=${cuerpo.code}`);
    const detalle = 'detail' in cuerpo && typeof cuerpo.detail === 'string' ? cuerpo.detail : undefined;
    if (detalle !== undefined) partes.push(detalle);
  } else if (respuesta.texto !== '') {
    partes.push(respuesta.texto);
  }
  const texto = partes.join(': ').replace(/^(HTTP \d+): /, '$1 — ');
  return texto.length > MAXIMO ? `${texto.slice(0, MAXIMO)}…` : texto;
}
