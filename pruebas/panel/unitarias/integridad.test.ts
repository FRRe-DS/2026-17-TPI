import { describe, expect, it } from 'vitest';
import type { ResultadoRestriccion, ResultadoSimultaneo } from '../../../panel/cliente/src/api/panel.js';
import {
  armarConteo,
  N_MAXIMO,
  N_MINIMO,
  N_POR_DEFECTO,
  RESTRICCION_ESPERADA,
  validarN,
  veredictoDeRestriccion,
  veredictoSimultaneo,
} from '../../../panel/cliente/src/logica/integridad.js';
import { RESTRICCION_ESPERADA as RESTRICCION_DEL_SERVIDOR } from '../../../panel/servidor/demo/restriccion.js';

// Lo que muestra la sección «Integridad» de la vista de demostración (spec 072, T13, RNF-08.2 a RNF-08.4, RNF-05.5), sin React.

describe('validarN: un entero de 2 a 50', () => {
  it('por defecto 10, de 2 a 50', () => {
    expect([N_POR_DEFECTO, N_MINIMO, N_MAXIMO]).toEqual([10, 2, 50]);
  });

  it.each([['2', 2], ['10', 10], ['50', 50], [' 7 ', 7], ['07', 7]])('«%s» es válido: %i', (texto, n) => {
    expect(validarN(texto)).toEqual({ valido: true, n });
  });

  it.each([
    ['', 'Escribí cuántos pedidos lanzar, de 2 a 50.'],
    ['   ', 'Escribí cuántos pedidos lanzar, de 2 a 50.'],
    ['1', 'Tiene que ser un número entero de 2 a 50.'],
    ['0', 'Tiene que ser un número entero de 2 a 50.'],
    ['51', 'Tiene que ser un número entero de 2 a 50.'],
    ['-3', 'Tiene que ser un número entero de 2 a 50.'],
    ['2.5', 'Tiene que ser un número entero de 2 a 50.'],
    ['2,5', 'Tiene que ser un número entero de 2 a 50.'],
    ['diez', 'Tiene que ser un número entero de 2 a 50.'],
    ['1e1', 'Tiene que ser un número entero de 2 a 50.'],
    ['0x10', 'Tiene que ser un número entero de 2 a 50.'],
    ['99999999999999999999', 'Tiene que ser un número entero de 2 a 50.'],
  ])('«%s» no es válido: «%s»', (texto, motivo) => {
    expect(validarN(texto)).toEqual({ valido: false, motivo });
  });
});

const simultaneo = (cambios: Partial<ResultadoSimultaneo> = {}): ResultadoSimultaneo => ({
  clienteId: 'c-1',
  n: 10,
  porCodigo: { 201: 1, 409: 9 },
  filas: 1,
  esperado: { porCodigo: { 201: 1, 409: 9 }, filas: 1 },
  cumple: true,
  prefijoRequestId: 'panel-demo-abcd1234-',
  ...cambios,
});

describe('armarConteo: la tabla de respuestas por código', () => {
  it('una fila por código, ordenadas, con lo obtenido, lo esperado y si coinciden', () => {
    expect(armarConteo(simultaneo()).filas).toEqual([
      { codigo: '201', etiqueta: '201', obtenidas: 1, esperadas: 1, coincide: true },
      { codigo: '409', etiqueta: '409', obtenidas: 9, esperadas: 9, coincide: true },
    ]);
  });

  it('suma los códigos que llegaron y no se esperaban, y los que se esperaban y no llegaron', () => {
    const conteo = armarConteo(simultaneo({ porCodigo: { 201: 2, 500: 8 }, cumple: false }));

    expect(conteo.filas).toEqual([
      { codigo: '201', etiqueta: '201', obtenidas: 2, esperadas: 1, coincide: false },
      { codigo: '409', etiqueta: '409', obtenidas: 0, esperadas: 9, coincide: false },
      { codigo: '500', etiqueta: '500', obtenidas: 8, esperadas: 0, coincide: false },
    ]);
  });

  it('los pedidos sin respuesta (código 0) van al final y se llaman «Sin respuesta»', () => {
    const conteo = armarConteo(simultaneo({ porCodigo: { 0: 3, 201: 1, 409: 6 }, cumple: false }));

    expect(conteo.filas.map((fila) => fila.etiqueta)).toEqual(['201', '409', 'Sin respuesta']);
    expect(conteo.filas.at(-1)).toMatchObject({ codigo: '0', obtenidas: 3, esperadas: 0, coincide: false });
  });

  it('ordena los códigos como números y no como texto', () => {
    const conteo = armarConteo(simultaneo({ porCodigo: { 503: 1, 201: 1, 99: 1 }, esperado: { porCodigo: { 201: 1 }, filas: 1 } }));

    expect(conteo.filas.map((fila) => fila.codigo)).toEqual(['99', '201', '503']);
  });

  it('las filas: las obtenidas, las esperadas y si coinciden', () => {
    expect(armarConteo(simultaneo()).filasEnBase).toEqual({ obtenidas: 1, esperadas: 1, coincide: true });
    expect(armarConteo(simultaneo({ filas: 3 })).filasEnBase).toEqual({ obtenidas: 3, esperadas: 1, coincide: false });
  });

  it('si no se pudieron contar, no coinciden y trae el motivo', () => {
    expect(armarConteo(simultaneo({ filas: null, motivoFilas: 'la base no responde (ECONNREFUSED)' })).filasEnBase).toEqual({
      obtenidas: null,
      esperadas: 1,
      coincide: false,
      motivo: 'la base no responde (ECONNREFUSED)',
    });
  });
});

describe('veredictoSimultaneo', () => {
  it('✔ «Correcto» sin motivos', () => {
    expect(veredictoSimultaneo(simultaneo())).toEqual({ correcto: true, titulo: 'Correcto', motivos: [] });
  });

  it('con la misma clave también pide que los 201 traigan el mismo cuerpo', () => {
    const veredicto = veredictoSimultaneo(simultaneo({ porCodigo: { 201: 10 }, esperado: { porCodigo: { 201: 10 }, filas: 1 }, cuerposIguales: false, cumple: false }));

    expect(veredicto).toEqual({ correcto: false, titulo: 'No coincide', motivos: ['Los 201 no trajeron el mismo cuerpo.'] });
  });

  it('✘ dice qué código no coincide', () => {
    const veredicto = veredictoSimultaneo(simultaneo({ porCodigo: { 201: 2, 409: 8 }, cumple: false }));

    expect(veredicto.correcto).toBe(false);
    expect(veredicto.motivos).toEqual(['Código 201: se esperaba 1, llegaron 2.', 'Código 409: se esperaba 9, llegaron 8.']);
  });

  it('✘ cuenta los pedidos sin respuesta', () => {
    const veredicto = veredictoSimultaneo(simultaneo({ porCodigo: { 0: 1, 201: 1, 409: 8 }, cumple: false }));

    expect(veredicto.motivos).toEqual(['Código 409: se esperaba 9, llegaron 8.', 'Hubo 1 pedido sin respuesta.']);
    expect(veredictoSimultaneo(simultaneo({ porCodigo: { 0: 4, 201: 1, 409: 5 }, cumple: false })).motivos.at(-1)).toBe('Hubo 4 pedidos sin respuesta.');
  });

  it('✘ si hay más de una fila, dice cuántas', () => {
    expect(veredictoSimultaneo(simultaneo({ filas: 2, cumple: false })).motivos).toEqual(['Filas en la base: se esperaba 1, hay 2.']);
  });

  it('✘ si no se pudieron contar las filas, dice por qué (o que la base no responde)', () => {
    expect(veredictoSimultaneo(simultaneo({ filas: null, motivoFilas: 'no configurada (PANEL_URL_BD)', cumple: false })).motivos).toEqual([
      'No se pudieron contar las filas: no configurada (PANEL_URL_BD).',
    ]);
    expect(veredictoSimultaneo(simultaneo({ filas: null, cumple: false })).motivos).toEqual(['No se pudieron contar las filas: la base no responde.']);
  });

  it('si el servidor dice que no cumple y no hay otro motivo, lo dice', () => {
    expect(veredictoSimultaneo(simultaneo({ cumple: false }))).toEqual({
      correcto: false,
      titulo: 'No coincide',
      motivos: ['El servidor no dio la prueba por cumplida.'],
    });
  });

  it('si el servidor dice que cumple pero el conteo no, manda el conteo', () => {
    expect(veredictoSimultaneo(simultaneo({ filas: 2, cumple: true })).correcto).toBe(false);
  });
});

describe('la restricción del puntaje', () => {
  const restriccion = (cambios: Partial<ResultadoRestriccion> = {}): ResultadoRestriccion => ({
    clienteId: 'c-1',
    filasAntes: 0,
    filasDespues: 0,
    restriccion: 'calificaciones_puntaje_valido',
    codigo: '23514',
    mensaje: 'new row for relation "calificaciones" violates check constraint "calificaciones_puntaje_valido"',
    cumple: true,
    ...cambios,
  });

  it('la restricción esperada es la que prueba el servidor', () => {
    expect(RESTRICCION_ESPERADA).toBe(RESTRICCION_DEL_SERVIDOR);
  });

  it('✔ si la base la rechazó con su restricción y no cambió nada', () => {
    expect(veredictoDeRestriccion(restriccion())).toEqual({ correcto: true, titulo: 'Correcto', motivos: [] });
  });

  it('✘ si la base aceptó el puntaje 9', () => {
    const veredicto = veredictoDeRestriccion(restriccion({ restriccion: undefined, codigo: undefined, mensaje: 'la base aceptó el puntaje 9: falta la restricción', cumple: false }));

    expect(veredicto).toEqual({ correcto: false, titulo: 'No coincide', motivos: ['la base aceptó el puntaje 9: falta la restricción'] });
  });

  it('✘ si la rechazó otra restricción, dice cuál', () => {
    const veredicto = veredictoDeRestriccion(restriccion({ restriccion: 'calificaciones_cliente_id_fkey', codigo: '23503', cumple: false }));

    expect(veredicto.motivos).toEqual(['La base rechazó el puntaje 9 con otra restricción: calificaciones_cliente_id_fkey.']);
  });

  it('✘ si falló por otro motivo, dice el código', () => {
    const veredicto = veredictoDeRestriccion(restriccion({ restriccion: undefined, codigo: '57014', mensaje: 'canceling statement due to statement timeout', cumple: false }));

    expect(veredicto.motivos).toEqual(['La base falló con el código 57014: canceling statement due to statement timeout.']);
  });

  it('✘ si no se pudo contar, trae el motivo de la base', () => {
    const veredicto = veredictoDeRestriccion({ clienteId: 'c-1', filasAntes: null, filasDespues: null, mensaje: 'no configurada (PANEL_URL_BD)', cumple: false });

    expect(veredicto.motivos).toEqual(['no configurada (PANEL_URL_BD)']);
  });

  it('✘ si cambió la cantidad de calificaciones', () => {
    expect(veredictoDeRestriccion(restriccion({ filasDespues: 1, cumple: false })).motivos).toEqual(['Cambió la cantidad de calificaciones: había 0 y hay 1.']);
  });

  it('si el servidor dice que cumple pero la base no rechazó con la restricción, manda lo que se ve', () => {
    expect(veredictoDeRestriccion(restriccion({ restriccion: undefined, cumple: true })).correcto).toBe(false);
  });
});
