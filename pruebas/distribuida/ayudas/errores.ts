import type { Respuesta } from './pedir.js';

const MAXIMO = 300;

const textoDe = (cuerpo: object, campo: string): string | undefined => {
  const valor = (cuerpo as Record<string, unknown>)[campo];
  return typeof valor === 'string' ? valor : undefined;
};

// Cómo se cuenta lo que contestó un módulo en el mensaje de una falla: el código HTTP y, si el cuerpo es un `Problem` de M6, el
// `code` y el detalle (`detail`, opcional, o `message`, obligatorio); si no, el comienzo del texto.
export function describirRespuesta(respuesta: Pick<Respuesta, 'estado' | 'texto' | 'cuerpo'>): string {
  const partes = [`HTTP ${respuesta.estado}`];
  const cuerpo = respuesta.cuerpo;
  if (typeof cuerpo === 'object' && cuerpo !== null && 'code' in cuerpo && typeof cuerpo.code === 'string') {
    partes.push(`code=${cuerpo.code}`);
    const detalle = textoDe(cuerpo, 'detail') ?? textoDe(cuerpo, 'message');
    if (detalle !== undefined) partes.push(detalle);
  } else if (respuesta.texto !== '') {
    partes.push(respuesta.texto);
  }
  const texto = partes.join(': ').replace(/^(HTTP \d+): /, '$1 — ');
  return texto.length > MAXIMO ? `${texto.slice(0, MAXIMO)}…` : texto;
}
