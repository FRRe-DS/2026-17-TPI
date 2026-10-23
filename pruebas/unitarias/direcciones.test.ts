import { describe, expect, it } from 'vitest';
import { aDireccion, type FilaDireccion } from '../../src/direcciones/modelo.js';

const DIRECCION_ID = 'b3c0f1a2-7d44-4c1e-9a55-1e2f3a4b5c6d';

// Una fila como la entrega pg: `creado_en` como `Date` y las coordenadas (numeric) como texto.
const fila = (cambios: Partial<FilaDireccion> = {}): FilaDireccion => ({
  direccion_id: DIRECCION_ID,
  tipo: 'FAVORITA',
  alias: 'Casa',
  texto: 'Calle Falsa 123',
  latitud: '-27.4511',
  longitud: '-58.9867',
  creado_en: new Date('2026-10-23T12:00:00.123Z'),
  ...cambios,
});

describe('aDireccion(): de la fila al esquema Direccion del contrato (RF-2.2, RF-2.2.2)', () => {
  it('pasa cada columna a su campo, con la fecha en ISO 8601 y las coordenadas como números', () => {
    expect(aDireccion(fila())).toEqual({
      direccionId: DIRECCION_ID,
      tipo: 'FAVORITA',
      alias: 'Casa',
      texto: 'Calle Falsa 123',
      coordenadas: { latitud: -27.4511, longitud: -58.9867 },
      creadoEn: '2026-10-23T12:00:00.123Z',
    });
  });

  it('sin alias, el campo no está: el contrato no admite null', () => {
    const direccion = aDireccion(fila({ alias: null }));

    expect(direccion).not.toHaveProperty('alias');
  });

  it('un alias vacío sigue ahí: no equivale a un alias ausente', () => {
    expect(aDireccion(fila({ alias: '' }))).toHaveProperty('alias', '');
  });

  it('sin coordenadas, el campo no está', () => {
    const direccion = aDireccion(fila({ latitud: null, longitud: null }));

    expect(direccion).not.toHaveProperty('coordenadas');
  });

  it('los extremos y el cero salen como números, no como ausencia', () => {
    expect(aDireccion(fila({ latitud: '0', longitud: '-180' })).coordenadas).toEqual({ latitud: 0, longitud: -180 });
    expect(aDireccion(fila({ latitud: '90', longitud: '180.000' })).coordenadas).toEqual({ latitud: 90, longitud: 180 });
  });

  it('el tipo RECIENTE pasa tal cual', () => {
    expect(aDireccion(fila({ tipo: 'RECIENTE' })).tipo).toBe('RECIENTE');
  });

  it('solo trae los campos del esquema: ningún cliente_id', () => {
    expect(Object.keys(aDireccion(fila())).sort()).toEqual(
      ['coordenadas', 'creadoEn', 'direccionId', 'alias', 'texto', 'tipo'].sort(),
    );
  });
});
