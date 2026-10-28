import { describe, expect, it, vi } from 'vitest';
import type { ApiM2 } from '../../../panel/cliente/src/api/m2.js';
import {
  calcularCambiosDireccion,
  camposDeDireccion,
  cuerpoDeDireccion,
  DIRECCION_NUEVA,
  guardarDireccion,
  validarDireccion,
  type CamposDireccion,
} from '../../../panel/cliente/src/logica/direcciones.js';

// Los datos de una dirección frecuente (T22, RF-2.2.6): las validaciones con los límites del contrato, el cuerpo del alta y lo que se
// manda al editar. El recorrido contra M2 real, en `pruebas/panel/integracion/pantalla-direcciones.test.ts`.

const ID = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const DIRECCION_ID = '9e8d7c6b-5a49-4382-9716-0f1e2d3c4b5a';
const DIRECCION = {
  direccionId: DIRECCION_ID,
  tipo: 'FAVORITA' as const,
  alias: 'Casa',
  texto: 'Av. Sarmiento 1500, Resistencia',
  coordenadas: { latitud: -27.45, longitud: -58.98 },
  creadoEn: '2026-10-27T12:00:00.000Z',
};
const SIN_COORDENADAS = { direccionId: DIRECCION_ID, tipo: 'RECIENTE' as const, texto: 'Plaza 25 de Mayo', creadoEn: DIRECCION.creadoEn };
const con = (cambios: Partial<CamposDireccion>): CamposDireccion => ({ ...camposDeDireccion(DIRECCION), ...cambios });
const nueva = (cambios: Partial<CamposDireccion>): CamposDireccion => ({ ...DIRECCION_NUEVA, texto: 'Calle 1', ...cambios });

describe('validarDireccion: los límites del contrato (RF-2.2.6)', () => {
  it('una dirección nueva con solo el texto es válida; sin texto, no', () => {
    expect(validarDireccion(nueva({}))).toEqual({});
    expect(validarDireccion(DIRECCION_NUEVA)).toEqual({ texto: 'El texto de la dirección es obligatorio.' });
    expect(validarDireccion(nueva({ texto: '    ' }))).toHaveProperty('texto');
  });

  it('el texto llega hasta 255 caracteres y el alias hasta 50', () => {
    expect(validarDireccion(nueva({ texto: 't'.repeat(255), alias: 'a'.repeat(50) }))).toEqual({});
    expect(validarDireccion(nueva({ texto: 't'.repeat(256), alias: 'a'.repeat(51) }))).toEqual({
      texto: 'Hasta 255 caracteres.',
      alias: 'Hasta 50 caracteres.',
    });
  });

  it('el alias es opcional', () => {
    expect(validarDireccion(nueva({ alias: '' }))).toEqual({});
  });

  it.each([['-27.45', '-58.98'], ['90', '180'], ['-90', '-180'], ['0', '0'], ['-27,45', '-58,98'], [' 1.5 ', ' 2 ']])(
    'acepta las coordenadas %s, %s',
    (latitud, longitud) => {
      expect(validarDireccion(nueva({ latitud, longitud }))).toEqual({});
    },
  );

  it.each([['90.1', '0', 'latitud', 'Entre -90 y 90.'], ['-91', '0', 'latitud', 'Entre -90 y 90.'], ['0', '180.5', 'longitud', 'Entre -180 y 180.'], ['0', '-181', 'longitud', 'Entre -180 y 180.']])(
    'rechaza %s, %s por fuera de rango',
    (latitud, longitud, campo, mensaje) => {
      expect(validarDireccion(nueva({ latitud, longitud }))[campo as 'latitud' | 'longitud']).toBe(mensaje);
    },
  );

  it.each(['abc', '1e3', '--1', '1.2.3', '1,2,3', 'NaN', 'Infinity', '0x10'])('rechaza %j como número', (texto) => {
    expect(validarDireccion(nueva({ latitud: texto, longitud: '0' })).latitud).toBe('Escribí un número, por ejemplo -27.45.');
  });

  it('las coordenadas van las dos o ninguna', () => {
    expect(validarDireccion(nueva({ latitud: '-27.45' }))).toEqual({ longitud: 'Completá la longitud, o dejá las dos vacías.' });
    expect(validarDireccion(nueva({ longitud: '-58.98' }))).toEqual({ latitud: 'Completá la latitud, o dejá las dos vacías.' });
  });

  it('el tipo es uno de los dos del contrato', () => {
    expect(validarDireccion(nueva({ tipo: 'OTRA' as never }))).toHaveProperty('tipo');
  });
});

describe('cuerpoDeDireccion: lo que se manda a crearDireccion', () => {
  it('sin alias ni coordenadas, solo tipo y texto', () => {
    expect(cuerpoDeDireccion(nueva({ texto: '  Calle 1 ' }))).toEqual({ tipo: 'FAVORITA', texto: 'Calle 1' });
  });

  it('con todo, el alias recortado y las coordenadas como números (con coma o con punto)', () => {
    expect(cuerpoDeDireccion(nueva({ alias: ' Casa ', latitud: '-27,45', longitud: ' -58.98' }))).toEqual({
      tipo: 'FAVORITA',
      alias: 'Casa',
      texto: 'Calle 1',
      coordenadas: { latitud: -27.45, longitud: -58.98 },
    });
  });
});

describe('camposDeDireccion: lo que trae escrito el formulario al editar', () => {
  it('todos los campos de la dirección, con las coordenadas como texto', () => {
    expect(camposDeDireccion(DIRECCION)).toEqual({ tipo: 'FAVORITA', alias: 'Casa', texto: 'Av. Sarmiento 1500, Resistencia', latitud: '-27.45', longitud: '-58.98' });
  });

  it('sin alias ni coordenadas, vacíos', () => {
    expect(camposDeDireccion(SIN_COORDENADAS)).toEqual({ tipo: 'RECIENTE', alias: '', texto: 'Plaza 25 de Mayo', latitud: '', longitud: '' });
  });
});

describe('calcularCambiosDireccion: solo lo que cambió (RF-2.2.6)', () => {
  it('sin tocar nada, no hay cambios', () => {
    expect(calcularCambiosDireccion(DIRECCION, camposDeDireccion(DIRECCION))).toBeUndefined();
    expect(calcularCambiosDireccion(SIN_COORDENADAS, camposDeDireccion(SIN_COORDENADAS))).toBeUndefined();
  });

  it.each<[string, Partial<CamposDireccion>, object]>([
    ['el tipo', { tipo: 'RECIENTE' }, { tipo: 'RECIENTE' }],
    ['el alias', { alias: 'Trabajo' }, { alias: 'Trabajo' }],
    ['el texto', { texto: 'Otra calle 2' }, { texto: 'Otra calle 2' }],
    ['la latitud', { latitud: '-27.5' }, { coordenadas: { latitud: -27.5, longitud: -58.98 } }],
    ['la longitud', { longitud: '-59' }, { coordenadas: { latitud: -27.45, longitud: -59 } }],
    ['dos a la vez', { tipo: 'RECIENTE', texto: 'Otra calle 2' }, { tipo: 'RECIENTE', texto: 'Otra calle 2' }],
  ])('si cambia %s, manda solo eso', (_, cambios, esperado) => {
    expect(calcularCambiosDireccion(DIRECCION, con(cambios))).toEqual(esperado);
  });

  it('escribir las mismas coordenadas con coma o con espacios no es un cambio', () => {
    expect(calcularCambiosDireccion(DIRECCION, con({ latitud: ' -27,45 ', longitud: '-58.980' }))).toBeUndefined();
  });

  it('vaciar el alias sí es un cambio: M2 guarda el alias vacío', () => {
    expect(calcularCambiosDireccion(DIRECCION, con({ alias: '  ' }))).toEqual({ alias: '' });
  });

  it('agregar coordenadas a una dirección que no las tenía', () => {
    expect(calcularCambiosDireccion(SIN_COORDENADAS, { ...camposDeDireccion(SIN_COORDENADAS), latitud: '-27.45', longitud: '-58.98' })).toEqual({
      coordenadas: { latitud: -27.45, longitud: -58.98 },
    });
  });

  it('vaciar las coordenadas de una dirección que las tiene no es un cambio: el contrato no puede borrarlas', () => {
    expect(calcularCambiosDireccion(DIRECCION, con({ latitud: '', longitud: '' }))).toBeUndefined();
  });
});

describe('validarDireccion al editar: las coordenadas que ya existen no se pueden quitar', () => {
  it('lo que viene de M2 sin tocar es válido', () => {
    expect(validarDireccion(camposDeDireccion(DIRECCION), DIRECCION)).toEqual({});
  });

  it('vaciarlas es un error junto al casillero, no un cambio', () => {
    expect(validarDireccion(con({ latitud: '', longitud: '' }), DIRECCION)).toEqual({
      latitud: 'M2 no permite quitar las coordenadas: escribilas de nuevo o cambialas.',
    });
  });
});

describe('guardarDireccion: no llama a M2 si no hay nada que guardar', () => {
  const apiDe = () => {
    const actualizarDireccion = vi.fn().mockResolvedValue({ ...DIRECCION, alias: 'Trabajo' });
    return { api: { actualizarDireccion } as unknown as ApiM2, actualizarDireccion };
  };

  it('sin cambios, ningún pedido', async () => {
    const { api, actualizarDireccion } = apiDe();

    expect(await guardarDireccion(api, ID, DIRECCION, camposDeDireccion(DIRECCION))).toEqual({ tipo: 'sin-cambios' });
    expect(actualizarDireccion).not.toHaveBeenCalled();
  });

  it('con cambios, un pedido con solo lo distinto, y devuelve la dirección de M2', async () => {
    const { api, actualizarDireccion } = apiDe();
    const senal = new AbortController().signal;

    const resultado = await guardarDireccion(api, ID, DIRECCION, con({ alias: 'Trabajo' }), { senal });

    expect(actualizarDireccion).toHaveBeenCalledExactlyOnceWith(ID, DIRECCION_ID, { alias: 'Trabajo' }, { senal });
    expect(resultado).toEqual({ tipo: 'guardada', direccion: { ...DIRECCION, alias: 'Trabajo' } });
  });
});
