import { describe, expect, it } from 'vitest';
import type { Identidad } from '../../src/auth/tokens.js';
import type { BaseDeDatos } from '../../src/bd/pool.js';
import { aDireccion, aPaginaDirecciones, type FilaDireccion } from '../../src/direcciones/modelo.js';
import * as servicio from '../../src/direcciones/servicio.js';
import { SinPermiso } from '../../src/errores.js';

const DIRECCION_ID = 'b3c0f1a2-7d44-4c1e-9a55-1e2f3a4b5c6d';

// Una fila como la entrega pg: `creado_en` como `Date` y las coordenadas (numeric) como texto.
const fila = (cambios: Partial<FilaDireccion> = {}): FilaDireccion => ({
  direccion_id: DIRECCION_ID,
  tipo: 'FAVORITA',
  alias: 'Casa',
  texto: 'Calle Falsa 123',
  latitud: '-45.1234',
  longitud: '-30.5678',
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
      coordenadas: { latitud: -45.1234, longitud: -30.5678 },
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

describe('aPaginaDirecciones(): de las filas a la PaginaDirecciones del contrato (RF-2.2.1)', () => {
  const otra = fila({ direccion_id: 'c4d1a2b3-8e55-4d2f-8b66-2f3a4b5c6d7e', alias: null, latitud: null, longitud: null });

  it('devuelve las direcciones en el orden recibido, con la página y el tamaño pedidos y los totales del filtro', () => {
    const pagina = aPaginaDirecciones([fila(), otra], 5, 1, 2);

    expect(pagina).toEqual({
      page: 1,
      size: 2,
      totalElementos: 5,
      totalPaginas: 3,
      items: [aDireccion(fila()), aDireccion(otra)],
    });
  });

  it('sin direcciones, items vacío y cero páginas', () => {
    expect(aPaginaDirecciones([], 0, 0, 20)).toEqual({ page: 0, size: 20, totalElementos: 0, totalPaginas: 0, items: [] });
  });

  it('una página fuera del total tiene items vacío pero conserva los totales', () => {
    expect(aPaginaDirecciones([], 3, 9, 2)).toEqual({ page: 9, size: 2, totalElementos: 3, totalPaginas: 2, items: [] });
  });

  it('el total justo en un múltiplo del tamaño no suma una página de más', () => {
    expect(aPaginaDirecciones([fila()], 100, 0, 100).totalPaginas).toBe(1);
    expect(aPaginaDirecciones([fila()], 101, 0, 100).totalPaginas).toBe(2);
  });
});

describe('el servicio de direcciones: rol efectivo y propiedad antes de la base (RF-2.2.5)', () => {
  // Los roles de cada operación, como los da el contrato: las lecturas admiten CLIENTE y OPERADOR; las escrituras, solo CLIENTE.
  const LECTURA = ['CLIENTE', 'OPERADOR'] as const;
  const ESCRITURA = ['CLIENTE'] as const;
  const CLIENTE_ID = '6f1c1d1e-3b0a-4f55-9a6b-0d7a8f4c2e11';
  const OTRO_ID = '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d';

  // Un pool que falla con un error propio si se usa: distingue «se rechazó antes de la base» de «llegó a la base».
  class TocoLaBase extends Error {}
  const pool: BaseDeDatos = {
    tiempoBdMs: 1000,
    consultar: () => Promise.reject(new TocoLaBase()),
    connect: () => Promise.reject(new TocoLaBase()),
  } as unknown as BaseDeDatos;

  const quien = (sub: string, roles: Identidad['roles']): Identidad => ({ sub, roles });
  const pagina = { page: 0, size: 20 };
  const nueva = { tipo: 'FAVORITA' as const, texto: 'Calle Falsa 123' };

  // Las cinco operaciones con la identidad dada sobre el cliente `clienteId`.
  const operaciones = (identidad: Identidad, clienteId: string) => ({
    listar: () => servicio.listarDirecciones(pool, identidad, LECTURA, clienteId, pagina),
    obtener: () => servicio.obtenerDireccion(pool, identidad, LECTURA, clienteId, OTRO_ID),
    crear: () => servicio.crearDireccion(pool, identidad, ESCRITURA, clienteId, 'clave-1', nueva),
    actualizar: () => servicio.actualizarDireccion(pool, identidad, ESCRITURA, clienteId, OTRO_ID, { texto: 'X' }),
    eliminar: () => servicio.eliminarDireccion(pool, identidad, ESCRITURA, clienteId, OTRO_ID),
  });
  const error = (promesa: Promise<unknown>) =>
    promesa.then(
      () => undefined,
      (e: unknown) => e,
    );

  it('un CLIENTE sobre otro cliente: 403 en las cinco, sin tocar la base', async () => {
    for (const operacion of Object.values(operaciones(quien(CLIENTE_ID, ['CLIENTE']), OTRO_ID))) {
      expect(await error(operacion())).toBeInstanceOf(SinPermiso);
    }
  });

  it('un CLIENTE sobre sí mismo pasa la propiedad en las cinco y llega a la base', async () => {
    for (const operacion of Object.values(operaciones(quien(CLIENTE_ID, ['CLIENTE']), CLIENTE_ID))) {
      expect(await error(operacion())).toBeInstanceOf(TocoLaBase);
    }
  });

  it('el sub y el clienteId se comparan normalizados: mayúsculas y urn:uuid: son el mismo cliente', async () => {
    const identidad = quien(`urn:uuid:${CLIENTE_ID.toUpperCase()}`, ['CLIENTE']);

    for (const operacion of Object.values(operaciones(identidad, CLIENTE_ID.toUpperCase()))) {
      expect(await error(operacion())).toBeInstanceOf(TocoLaBase);
    }
  });

  it('un OPERADOR lee las direcciones de otro cliente', async () => {
    const { listar, obtener } = operaciones(quien(OTRO_ID, ['OPERADOR']), CLIENTE_ID);

    expect(await error(listar())).toBeInstanceOf(TocoLaBase);
    expect(await error(obtener())).toBeInstanceOf(TocoLaBase);
  });

  it('CLIENTE+OPERADOR lee las de otro cliente, pero no las crea, cambia ni borra: en las escrituras solo vale CLIENTE', async () => {
    const { listar, obtener, crear, actualizar, eliminar } = operaciones(quien(OTRO_ID, ['CLIENTE', 'OPERADOR']), CLIENTE_ID);

    expect(await error(listar())).toBeInstanceOf(TocoLaBase);
    expect(await error(obtener())).toBeInstanceOf(TocoLaBase);
    expect(await error(crear())).toBeInstanceOf(SinPermiso);
    expect(await error(actualizar())).toBeInstanceOf(SinPermiso);
    expect(await error(eliminar())).toBeInstanceOf(SinPermiso);
  });

  it('CLIENTE+SERVICIO sobre otro cliente: SERVICIO no está admitido, así que solo cuenta CLIENTE y es 403', async () => {
    for (const operacion of Object.values(operaciones(quien(OTRO_ID, ['CLIENTE', 'SERVICIO']), CLIENTE_ID))) {
      expect(await error(operacion())).toBeInstanceOf(SinPermiso);
    }
  });

  it('el 403 no lleva el sub ni el clienteId en el detalle (RNF-19)', async () => {
    const rechazo = (await error(operaciones(quien(CLIENTE_ID, ['CLIENTE']), OTRO_ID).crear())) as SinPermiso;

    expect(rechazo.detail).not.toContain(CLIENTE_ID);
    expect(rechazo.detail).not.toContain(OTRO_ID);
  });
});
