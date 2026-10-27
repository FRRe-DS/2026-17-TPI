import { describe, expect, it } from 'vitest';
import { agregar, escribir, leer, MAXIMO_RECORDADOS, quitar, type Recordado } from '../../../panel/cliente/src/logica/recordados.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cliente = (n: number, nombre = `Cliente ${n}`): Recordado => ({ id: uuid(n), nombre });
const CON_LETRAS = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';

describe('agregar (RF-2.1.6)', () => {
  it('pone el nuevo primero', () => {
    expect(agregar([cliente(1), cliente(2)], cliente(3))).toEqual([cliente(3), cliente(1), cliente(2)]);
  });

  it('el que ya estaba pasa al primer lugar sin repetirse y se queda con el nombre nuevo', () => {
    const lista = [cliente(1), cliente(2), cliente(3)];

    expect(agregar(lista, cliente(3, 'Ana Pérez'))).toEqual([cliente(3, 'Ana Pérez'), cliente(1), cliente(2)]);
  });

  it('el id en mayúsculas y en minúsculas es el mismo cliente, y se guarda en minúscula', () => {
    const lista = [{ id: CON_LETRAS, nombre: 'Ana' }];

    expect(agregar(lista, { id: CON_LETRAS.toUpperCase(), nombre: 'Ana' })).toEqual(lista);
    expect(agregar([], { id: CON_LETRAS.toUpperCase(), nombre: 'Ana' })[0]!.id).toBe(CON_LETRAS);
  });

  it('conserva hasta 10: al agregar el 11.º sale el más viejo', () => {
    let lista: Recordado[] = [];
    for (let n = 1; n <= 11; n++) lista = agregar(lista, cliente(n));

    expect(MAXIMO_RECORDADOS).toBe(10);
    expect(lista).toHaveLength(10);
    expect(lista[0]).toEqual(cliente(11));
    expect(lista.at(-1)).toEqual(cliente(2));
  });

  it('con 10 y uno que ya estaba, no se pierde ninguno', () => {
    let lista: Recordado[] = [];
    for (let n = 1; n <= 10; n++) lista = agregar(lista, cliente(n));

    const nueva = agregar(lista, cliente(1));

    expect(nueva).toHaveLength(10);
    expect(nueva[0]).toEqual(cliente(1));
    expect(nueva.map((c) => c.id).sort()).toEqual(lista.map((c) => c.id).sort());
  });

  it('no modifica la lista que recibe', () => {
    const lista = Object.freeze([cliente(1)]) as Recordado[];

    expect(() => agregar(lista, cliente(2))).not.toThrow();
    expect(lista).toEqual([cliente(1)]);
  });

  it('solo guarda el id y el nombre: lo demás del cliente no se guarda (RF-2.1.6)', () => {
    const conDatos = { ...cliente(1), telefono: '+5491122334455', apellido: 'Pérez' };

    expect(agregar([], conDatos)).toEqual([cliente(1)]);
    expect(Object.keys(agregar([], conDatos)[0]!)).toEqual(['id', 'nombre']);
  });

  it.each([[{ id: 'no-es-uuid', nombre: 'Ana' }], [{ id: uuid(1), nombre: '' }], [{ id: uuid(1), nombre: '   ' }]])(
    'un cliente inválido %j no entra',
    (invalido) => {
      expect(agregar([cliente(2)], invalido)).toEqual([cliente(2)]);
    },
  );
});

describe('quitar (RF-2.1.7)', () => {
  it('saca al cliente y deja el resto en su orden', () => {
    expect(quitar([cliente(1), cliente(2), cliente(3)], uuid(2))).toEqual([cliente(1), cliente(3)]);
  });

  it('el id en mayúsculas también', () => {
    expect(quitar([{ id: CON_LETRAS, nombre: 'Ana' }], CON_LETRAS.toUpperCase())).toEqual([]);
  });

  it('un id que no está deja la lista igual', () => {
    expect(quitar([cliente(1)], uuid(9))).toEqual([cliente(1)]);
  });
});

describe('leer: descarta lo que no tenga forma de { id: uuid, nombre } (RF-2.1.6)', () => {
  it.each([[undefined], [null], [''], ['{roto'], ['null'], ['"texto"'], ['7'], ['{}'], ['{"id":"x"}']])('%j da una lista vacía', (texto) => {
    expect(leer(texto as string | null | undefined)).toEqual([]);
  });

  it('lee lo que escribir guardó, en el mismo orden', () => {
    const lista = [cliente(3), cliente(1), cliente(2)];

    expect(leer(escribir(lista))).toEqual(lista);
  });

  it('descarta las entradas inválidas y conserva las buenas', () => {
    const texto = JSON.stringify([
      cliente(1),
      null,
      'texto',
      7,
      [],
      { id: 'no-es-uuid', nombre: 'Ana' },
      { id: uuid(2) },
      { id: uuid(3), nombre: 42 },
      { id: uuid(4), nombre: '' },
      { id: 5, nombre: 'Ana' },
      cliente(6),
    ]);

    expect(leer(texto)).toEqual([cliente(1), cliente(6)]);
  });

  it('de cada entrada toma solo id y nombre', () => {
    const texto = JSON.stringify([{ ...cliente(1), token: 'eyJ.secreto', telefono: '+54911' }]);

    expect(leer(texto)).toEqual([cliente(1)]);
  });

  it('quita repetidos (se queda con el primero) y corta en 10', () => {
    const muchos = Array.from({ length: 15 }, (_, n) => cliente(n + 1));
    const texto = JSON.stringify([cliente(1, 'Repetido'), ...muchos]);

    const lista = leer(texto);

    expect(lista).toHaveLength(10);
    expect(lista[0]).toEqual(cliente(1, 'Repetido'));
    expect(new Set(lista.map((c) => c.id)).size).toBe(10);
  });

  it('un nombre con HTML se conserva como texto: la pantalla lo escapa', () => {
    const raro = cliente(1, '<img src=x onerror=alert(1)>');

    expect(leer(escribir([raro]))).toEqual([raro]);
  });

  it('un nombre larguísimo se descarta (lo que escribe la persona tiene tope en el contrato)', () => {
    expect(leer(JSON.stringify([cliente(1, 'a'.repeat(1000))]))).toEqual([]);
  });
});

describe('escribir', () => {
  it('guarda solo id y nombre', () => {
    expect(JSON.parse(escribir([{ ...cliente(1), telefono: '+54911' } as Recordado]))).toEqual([cliente(1)]);
  });
});
