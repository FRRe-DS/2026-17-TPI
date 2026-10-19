import { describe, expect, it } from 'vitest';
import { idCorrelacion } from '../../src/correlacion.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('idCorrelacion: respeta el valor de 1 a 128 caracteres de letras, números, punto, _ y - (RNF-14.3)', () => {
  it.each([
    ['una letra', 'a'],
    ['un solo carácter que no es letra', '0'],
    ['solo símbolos', '._-'],
    ['las mayúsculas', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
    ['las minúsculas', 'abcdefghijklmnopqrstuvwxyz'],
    ['los dígitos', '0123456789'],
    ['una mezcla', 'Req_1.2-x'],
    ['un UUID', '550e8400-e29b-41d4-a716-446655440000'],
    ['128 caracteres', 'a'.repeat(128)],
  ])('respeta %s', (_caso, valor) => {
    expect(idCorrelacion(valor)).toBe(valor);
  });
});

describe('idCorrelacion: si no, genera un UUID nuevo (RNF-14.3)', () => {
  it.each([
    ['ausente', undefined],
    ['vacío', ''],
    ['de 129 caracteres', 'a'.repeat(129)],
    ['de 10000 caracteres', 'a'.repeat(10_000)],
    // Node une los encabezados repetidos con «, »: lo que llega es un solo texto con coma y espacio.
    ['repetido, unido por Node', 'abc, abc'],
    ['repetido, como lista', ['abc', 'abc']],
    ['una lista de uno', ['abc']],
    ['una lista vacía', []],
    ['con un espacio', 'abc def'],
    ['con un espacio al principio', ' abc'],
    ['con un espacio al final', 'abc '],
    ['con una barra', 'a/b'],
    ['con una ruta', '../etc/passwd'],
    ['con dos puntos', 'a:b'],
    ['con una coma', 'a,b'],
    ['con un punto y coma', 'a;b'],
    ['con un signo igual', 'a=b'],
    ['con un signo más', 'a+b'],
    ['con un arroba', 'a@b'],
    ['con un porcentaje', 'a%20b'],
    ['con comillas', 'a"b'],
    ['con un apóstrofo', "a'b"],
    ['con una barra invertida', 'a\\b'],
    ['con etiquetas', '<script>'],
    ['con una letra con acento', 'canción'],
    ['con una eñe', 'ñ'],
    ['con ideogramas', '日本'],
    ['con un emoji', '😀'],
    ['con un tabulador', 'a\tb'],
    ['con un salto de línea al final', 'abc\n'],
    ['con un salto de línea al principio', '\nabc'],
    ['con un salto de línea en el medio', 'abc\ndef'],
    ['con un retorno de carro y un salto', 'abc\r\ndef'],
    ['con un carácter nulo', 'abc\0'],
  ])('%s', (_caso, valor) => {
    const id = idCorrelacion(valor);

    expect(id).toMatch(UUID_V4);
    expect(id).not.toEqual(valor);
  });

  it('genera uno distinto cada vez', () => {
    const ids = new Set(Array.from({ length: 50 }, () => idCorrelacion(undefined)));

    expect(ids.size).toBe(50);
  });
});
