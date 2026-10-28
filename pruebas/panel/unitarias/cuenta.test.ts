import { describe, expect, it } from 'vitest';
import { estadoDeBloqueo, estaBloqueado, textoDeEstado, textoDeVigencia } from '../../../panel/cliente/src/logica/cuenta.js';

// Lo que dice el estado de cuenta (T28, RF-2.6.5), sin React.

const ID = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const cuenta = (estado: 'ACTIVO' | 'BLOQUEADO') => ({ clienteId: ID, estado, bloqueosVigentes: [] });
const bloqueo = (cambios: { hasta?: string } = {}) => ({
  bloqueoId: ID,
  motivo: 'Fraude',
  vigente: true,
  creadoEn: '2026-10-27T12:00:00.000Z',
  creadoPor: 'operador-1',
  ...cambios,
});

describe('estaBloqueado', () => {
  it('lo dice el estado, no la lista de bloqueos', () => {
    expect(estaBloqueado(cuenta('BLOQUEADO'))).toBe(true);
    expect(estaBloqueado(cuenta('ACTIVO'))).toBe(false);
    expect(estaBloqueado({ ...cuenta('ACTIVO'), bloqueosVigentes: [bloqueo()] })).toBe(false);
  });
});

describe('textoDeEstado: con palabras, no solo con un color', () => {
  it('activo y bloqueado', () => {
    expect(textoDeEstado('ACTIVO')).toBe('Activo: puede solicitar viajes.');
    expect(textoDeEstado('BLOQUEADO')).toBe('Bloqueado: no puede solicitar viajes mientras haya un bloqueo vigente.');
  });
});

describe('textoDeVigencia: hasta cuándo dura un bloqueo', () => {
  it('sin fecha, hasta que se levante', () => {
    expect(textoDeVigencia(bloqueo())).toBe('Hasta que se levante');
  });

  it('con fecha, hasta ese instante en UTC', () => {
    expect(textoDeVigencia(bloqueo({ hasta: '2026-12-31T23:59:59.000Z' }))).toBe('Hasta 2026-12-31 23:59:59 (UTC)');
  });
});

describe('estadoDeBloqueo: en qué quedó cada bloqueo del historial', () => {
  it('vigente, levantado por un operador o vencido por su fecha', () => {
    expect(estadoDeBloqueo({ vigente: true })).toBe('vigente');
    expect(estadoDeBloqueo({ vigente: false, levantadoEn: '2026-10-28T10:00:00.000Z' })).toBe('levantado');
    expect(estadoDeBloqueo({ vigente: false })).toBe('vencido');
  });
});
