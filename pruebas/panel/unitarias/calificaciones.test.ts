import { describe, expect, it } from 'vitest';
import { ErrorDeApi } from '../../../panel/cliente/src/api/errores.js';
import { mensajeDeDetalle, textoDePuntaje } from '../../../panel/cliente/src/logica/calificaciones.js';

// Lo que dice «Mis calificaciones» (T27, RF-2.5.17), sin React.

const error = (estado: number) => new ErrorDeApi({ sinRespuesta: false, estado, type: 'about:blank', title: 'T' });

describe('mensajeDeDetalle: el 404 de una calificación es «no encontrada»', () => {
  it('un 404 sea de otra persona o inexistente: M2 no los distingue y el panel tampoco', () => {
    expect(mensajeDeDetalle(error(404))).toBe('Calificación no encontrada.');
  });

  it.each([[400], [401], [403], [500], [503]])('un %i no tiene frase propia: va el error de M2', (estado) => {
    expect(mensajeDeDetalle(error(estado))).toBeUndefined();
  });

  it('M2 sin respuesta tampoco', () => {
    expect(mensajeDeDetalle(new ErrorDeApi({ sinRespuesta: true, estado: 504, type: 'x', title: 'M2 no responde' }))).toBeUndefined();
  });
});

describe('textoDePuntaje', () => {
  it.each([[1, '1 de 5'], [3, '3 de 5'], [5, '5 de 5']])('%i → «%s»', (puntaje, texto) => {
    expect(textoDePuntaje(puntaje)).toBe(texto);
  });
});
