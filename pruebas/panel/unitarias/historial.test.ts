import { describe, expect, it } from 'vitest';
import { instante, nombreDelEstado, sePuedeCalificar, textoDeCalificado } from '../../../panel/cliente/src/logica/historial.js';

// Lo que el historial dice de cada viaje (T25, RF-2.4.12), sin React.

const ID = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const viaje = (estado: string, calificado?: boolean) => ({ viajeId: ID, estado, ...(calificado === undefined ? {} : { calificado }) });

describe('sePuedeCalificar: «Calificar» solo en los completados sin calificar (RF-2.4.12)', () => {
  it('completado y sin calificar: sí', () => {
    expect(sePuedeCalificar(viaje('COMPLETED', false))).toBe(true);
  });

  it('completado y ya calificado: no', () => {
    expect(sePuedeCalificar(viaje('COMPLETED', true))).toBe(false);
  });

  it.each([['IN_PROGRESS'], ['REQUESTED'], ['CANCELLED'], ['FINALIZADO'], ['completed']])('%s no está completado: no', (estado) => {
    expect(sePuedeCalificar(viaje(estado, false))).toBe(false);
  });

  it('sin el dato de calificado no se asume que está calificado', () => {
    expect(sePuedeCalificar(viaje('COMPLETED'))).toBe(true);
  });
});

describe('nombreDelEstado: el estado de M6 sin traducir, con su palabra en español si la conocemos', () => {
  it('conocidos', () => {
    expect(nombreDelEstado('COMPLETED')).toBe('Completado');
    expect(nombreDelEstado('IN_PROGRESS')).toBe('En curso');
  });

  it('desconocidos: tal cual', () => {
    expect(nombreDelEstado('FINALIZADO')).toBe('FINALIZADO');
  });
});

describe('textoDeCalificado', () => {
  it.each([[true, 'Calificado'], [false, 'Sin calificar'], [undefined, 'Sin dato']])('%s → %s', (calificado, texto) => {
    expect(textoDeCalificado(calificado)).toBe(texto);
  });
});

describe('instante: fecha y hora de M2 en UTC, sin milisegundos', () => {
  it('con milisegundos y zona', () => {
    expect(instante('2026-10-27T12:34:56.789Z')).toBe('2026-10-27 12:34:56');
  });

  it('algo que no es una fecha se muestra tal cual', () => {
    expect(instante('ayer')).toBe('ayer');
  });
});
