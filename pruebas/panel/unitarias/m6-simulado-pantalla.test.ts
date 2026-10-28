import { describe, expect, it } from 'vitest';
import { MODOS, nombreDelModo, NOMBRE_DEL_ESCENARIO, respuestaEsperada } from '../../../panel/cliente/src/logica/m6-simulado.js';

// Lo que dice la pantalla del M6 simulado (T32, RNF-13.5), sin React.

describe('los modos y los escenarios', () => {
  it('tres modos: normal, lento y caído, en ese orden', () => {
    expect(MODOS.map((m) => m.valor)).toEqual(['normal', 'lento', 'caido']);
    expect(MODOS.map((m) => m.etiqueta)).toEqual(['Normal', 'Lento', 'Caído']);
    expect(nombreDelModo('caido')).toBe('Caído');
  });

  it('cuatro escenarios con nombre en español', () => {
    expect(Object.keys(NOMBRE_DEL_ESCENARIO).sort()).toEqual(['ajeno', 'completado', 'enCurso', 'inexistente']);
  });
});

describe('respuestaEsperada: lo que M2 contesta al calificar con cada viaje', () => {
  it('en modo normal, la del escenario', () => {
    expect(respuestaEsperada({ respuestaDeM2: 201 }, 'normal')).toBe('201: M2 guarda la calificación.');
    expect(respuestaEsperada({ respuestaDeM2: 422 }, 'normal')).toBe('422: el viaje todavía no está completado.');
    expect(respuestaEsperada({ respuestaDeM2: 404 }, 'normal')).toBe('404: viaje no encontrado.');
  });

  it.each([['lento' as const], ['caido' as const]])('en modo %s, 503 con Retry-After para cualquiera', (modo) => {
    for (const respuestaDeM2 of [201, 422, 404] as const) {
      expect(respuestaEsperada({ respuestaDeM2 }, modo)).toBe('503: M6 no contesta; M2 manda Retry-After.');
    }
  });
});
