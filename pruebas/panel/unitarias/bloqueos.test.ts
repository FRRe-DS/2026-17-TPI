import { describe, expect, it } from 'vitest';
import { cargarContrato } from '../../../src/contrato/cargar.js';
import { ErrorDeApi } from '../../../panel/cliente/src/api/errores.js';
import {
  BLOQUEO_NUEVO,
  cuerpoDeBloqueo,
  cuerpoDeLevantamiento,
  LARGO_MAXIMO_MOTIVO,
  mensajeDeBloqueo,
  validarBloqueo,
  validarBusqueda,
  validarLevantamiento,
} from '../../../panel/cliente/src/logica/bloqueos.js';

// Lo que hace la vista del operador (T29, RF-2.6.6) antes de llamar a M2: validar, armar el cuerpo y dar el texto de cada rechazo.

const ID = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const AHORA = new Date('2026-10-27T12:00:00.000Z');
const esquemas = (cargarContrato().components as { schemas: Record<string, { properties: Record<string, { minLength?: number; maxLength?: number }> }> }).schemas;

describe('los límites son los del contrato', () => {
  it('el motivo de un bloqueo y el de un levantamiento: de 1 a 500', () => {
    for (const nombre of ['BloqueoNuevo', 'LevantamientoBloqueo']) {
      expect([esquemas[nombre]!.properties.motivo!.minLength, esquemas[nombre]!.properties.motivo!.maxLength]).toEqual([1, LARGO_MAXIMO_MOTIVO]);
    }
    expect(LARGO_MAXIMO_MOTIVO).toBe(500);
  });
});

describe('validarBusqueda: el cliente se busca por su UUID', () => {
  it('un UUID, con o sin espacios, es válido', () => {
    expect(validarBusqueda(ID)).toBeUndefined();
    expect(validarBusqueda(`  ${ID.toUpperCase()} `)).toBeUndefined();
  });

  it.each([[''], ['   '], ['abc'], [`${ID}0`], [ID.slice(1)]])('«%s» no es un UUID', (texto) => {
    expect(validarBusqueda(texto)).toBeTruthy();
  });
});

describe('validarBloqueo: motivo de 1 a 500 y fin opcional posterior a ahora', () => {
  it('sin motivo pide uno; con solo espacios también', () => {
    expect(validarBloqueo(BLOQUEO_NUEVO, AHORA)).toEqual({ motivo: 'Escribí el motivo.' });
    expect(validarBloqueo({ motivo: '   ', hasta: '' }, AHORA)).toEqual({ motivo: 'Escribí el motivo.' });
  });

  it('500 caracteres sí, 501 no; los espacios de los extremos no cuentan', () => {
    expect(validarBloqueo({ motivo: 'a'.repeat(500), hasta: '' }, AHORA)).toEqual({});
    expect(validarBloqueo({ motivo: ` ${'a'.repeat(500)} `, hasta: '' }, AHORA)).toEqual({});
    expect(validarBloqueo({ motivo: 'a'.repeat(501), hasta: '' }, AHORA)).toEqual({ motivo: 'Hasta 500 caracteres.' });
  });

  it('sin fin es válido: dura hasta que se levante', () => {
    expect(validarBloqueo({ motivo: 'Fraude', hasta: '' }, AHORA)).toEqual({});
  });

  it('un fin futuro es válido; uno pasado o igual a ahora no', () => {
    expect(validarBloqueo({ motivo: 'Fraude', hasta: '2099-01-01T00:00' }, AHORA)).toEqual({});
    expect(validarBloqueo({ motivo: 'Fraude', hasta: '2001-01-01T00:00' }, AHORA)).toEqual({ hasta: 'El fin tiene que ser posterior a ahora.' });
  });

  it('un fin igual al instante de ahora tampoco es posterior', () => {
    expect(validarBloqueo({ motivo: 'Fraude', hasta: '2026-10-27T12:00' }, new Date('2026-10-27T12:00'))).toHaveProperty('hasta');
    expect(validarBloqueo({ motivo: 'Fraude', hasta: '2026-10-27T12:01' }, new Date('2026-10-27T12:00'))).toEqual({});
  });

  it('un fin que no es una fecha válida, o de más de cuatro cifras de año, se rechaza', () => {
    expect(validarBloqueo({ motivo: 'Fraude', hasta: 'mañana' }, AHORA)).toHaveProperty('hasta');
    expect(validarBloqueo({ motivo: 'Fraude', hasta: '10000-01-01T00:00' }, AHORA)).toHaveProperty('hasta');
  });
});

describe('cuerpoDeBloqueo', () => {
  it('el motivo sin espacios de los extremos; sin fin no manda `hasta`', () => {
    expect(cuerpoDeBloqueo({ motivo: '  Fraude ', hasta: '' })).toEqual({ motivo: 'Fraude' });
  });

  it('con fin, lo manda como instante UTC en el formato del contrato', () => {
    const cuerpo = cuerpoDeBloqueo({ motivo: 'Fraude', hasta: '2099-01-01T08:30' });

    expect(cuerpo.hasta).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(cuerpo.hasta).toBe(new Date('2099-01-01T08:30').toISOString());
  });
});

describe('levantar: el motivo de 1 a 500', () => {
  it('validación y cuerpo', () => {
    expect(validarLevantamiento({ motivo: '' })).toEqual({ motivo: 'Escribí el motivo.' });
    expect(validarLevantamiento({ motivo: 'a'.repeat(501) })).toEqual({ motivo: 'Hasta 500 caracteres.' });
    expect(validarLevantamiento({ motivo: 'Resuelto' })).toEqual({});
    expect(cuerpoDeLevantamiento({ motivo: ' Resuelto ' })).toEqual({ motivo: 'Resuelto' });
  });
});

describe('mensajeDeBloqueo: un texto por cada rechazo conocido', () => {
  const error = (estado: number, type = 'about:blank') => new ErrorDeApi({ sinRespuesta: false, estado, type, title: 'T' });

  it.each([
    [error(409, '/errores/bloqueo-ya-levantado'), 'Ese bloqueo ya estaba levantado.'],
    [error(409, '/errores/bloqueo-no-vigente'), 'Ese bloqueo ya venció por su fecha: no hace falta levantarlo.'],
    [error(422, '/errores/bloqueo-vencido'), 'El fin del bloqueo tiene que ser posterior a ahora.'],
    [error(422, '/errores/bloqueo-hasta-fuera-de-rango'), 'El fin del bloqueo tiene que ser anterior al año 10000.'],
    [error(422, '/errores/idempotencia-reutilizada'), 'Este bloqueo ya se registró con otros datos. Cerrá el formulario y abrilo de nuevo para registrar otro.'],
    [error(404), 'No se encontró el cliente o el bloqueo.'],
  ])('%#', (e, texto) => {
    expect(mensajeDeBloqueo(e)).toBe(texto);
  });

  it('un 409 o un 422 con otro type, un 400 y un 500 no tienen texto propio', () => {
    for (const e of [error(409), error(409, '/errores/otro'), error(422, '/errores/otro'), error(400), error(403), error(500)]) {
      expect(mensajeDeBloqueo(e)).toBeUndefined();
    }
  });
});
