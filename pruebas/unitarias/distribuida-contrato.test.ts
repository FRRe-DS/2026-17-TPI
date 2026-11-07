import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validarContraContrato } from '../distribuida/ayudas/contrato.js';

// La validación de los cuerpos de la prueba distribuida contra contrato/openapi.yml (spec 081, T4 a T6).
describe('validarContraContrato (RNF-07.8, RNF-07.9)', () => {
  const pagina = { page: 0, size: 20, totalElementos: 1, totalPaginas: 1, items: [{ viajeId: randomUUID(), estado: 'COMPLETED', calificado: false }] };

  it('acepta una página de viajes válida', () => {
    expect(validarContraContrato('PaginaViajes', pagina)).toEqual([]);
  });

  it('rechaza una página sin totalElementos y dice cuál es el campo', () => {
    const sinTotal: Record<string, unknown> = { ...pagina };
    delete sinTotal['totalElementos'];
    const errores = validarContraContrato('PaginaViajes', sinTotal);
    expect(errores.length).toBeGreaterThan(0);
    expect(errores.join(' ')).toContain('totalElementos');
  });

  it('rechaza un viaje con un viajeId que no es UUID', () => {
    const errores = validarContraContrato('PaginaViajes', { ...pagina, items: [{ viajeId: 'no-es-uuid', estado: 'X' }] });
    expect(errores.join(' ')).toContain('viajeId');
  });

  it('acepta una calificación válida y rechaza un puntaje fuera de 1 a 5', () => {
    const calificacion = { calificacionId: randomUUID(), viajeId: randomUUID(), conductorId: randomUUID(), puntaje: 5, creadoEn: '2026-11-07T12:00:00Z' };
    expect(validarContraContrato('Calificacion', calificacion)).toEqual([]);
    expect(validarContraContrato('Calificacion', { ...calificacion, puntaje: 6 }).join(' ')).toContain('puntaje');
  });

  it('falla con un esquema que el contrato no tiene', () => {
    expect(() => validarContraContrato('NoExiste', {})).toThrow(/NoExiste/);
  });
});
