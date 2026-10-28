import { describe, expect, it } from 'vitest';
import { cargarContrato } from '../../../src/contrato/cargar.js';
import {
  CALIFICACION_NUEVA,
  cuerpoDeCalificacion,
  LARGO_MAXIMO_COMENTARIO,
  PUNTAJES,
  validarCalificacion,
} from '../../../panel/cliente/src/logica/calificacion.js';

// El formulario de calificación (T26, RF-2.5.15): lo que se ofrece y lo que se manda es lo que describe `CalificacionNueva`.

const VIAJE = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const esquema = (cargarContrato().components as { schemas: Record<string, { properties: Record<string, { minimum?: number; maximum?: number; maxLength?: number }> }> }).schemas
  .CalificacionNueva!.properties;

describe('los límites son los del contrato', () => {
  it('puntaje de 1 a 5', () => {
    expect(PUNTAJES.map((p) => p.valor)).toEqual(['1', '2', '3', '4', '5']);
    expect([esquema.puntaje!.minimum, esquema.puntaje!.maximum]).toEqual([1, 5]);
  });

  it('comentario de hasta 500', () => {
    expect(LARGO_MAXIMO_COMENTARIO).toBe(esquema.comentario!.maxLength);
  });
});

describe('validarCalificacion', () => {
  it('el formulario vacío pide el puntaje', () => {
    expect(validarCalificacion(CALIFICACION_NUEVA)).toEqual({ puntaje: 'Elegí un puntaje de 1 a 5.' });
  });

  it.each([['1'], ['3'], ['5']])('el puntaje %s es válido', (puntaje) => {
    expect(validarCalificacion({ puntaje, comentario: '' })).toEqual({});
  });

  it.each([['0'], ['6'], ['3.5'], ['abc'], ['-1']])('el puntaje «%s» no es válido', (puntaje) => {
    expect(validarCalificacion({ puntaje, comentario: '' })).toHaveProperty('puntaje');
  });

  it('500 caracteres de comentario sí, 501 no', () => {
    expect(validarCalificacion({ puntaje: '4', comentario: 'a'.repeat(500) })).toEqual({});
    expect(validarCalificacion({ puntaje: '4', comentario: 'a'.repeat(501) })).toEqual({ comentario: 'Hasta 500 caracteres.' });
  });

  it('los espacios de los extremos no cuentan', () => {
    expect(validarCalificacion({ puntaje: '4', comentario: ` ${'a'.repeat(500)} ` })).toEqual({});
  });
});

describe('cuerpoDeCalificacion', () => {
  it('el viaje y el puntaje como número; sin comentario no lo manda', () => {
    expect(cuerpoDeCalificacion(VIAJE, { puntaje: '5', comentario: '' })).toEqual({ viajeId: VIAJE, puntaje: 5 });
    expect(cuerpoDeCalificacion(VIAJE, { puntaje: '5', comentario: '   ' })).toEqual({ viajeId: VIAJE, puntaje: 5 });
  });

  it('con comentario, lo manda sin espacios de los extremos', () => {
    expect(cuerpoDeCalificacion(VIAJE, { puntaje: '2', comentario: '  Llegó tarde ' })).toEqual({ viajeId: VIAJE, puntaje: 2, comentario: 'Llegó tarde' });
  });
});
