import { describe, expect, it } from 'vitest';
import {
  actualizarDireccion,
  crearDireccion,
  eliminarDireccion,
  listarDirecciones,
  obtenerDireccion,
} from '../../src/direcciones/operaciones.js';
import { cargarContrato } from '../../src/contrato/cargar.js';
import { crearApp } from '../ayudas/app.js';
import { bearer } from '../ayudas/tokens.js';

// Los rechazos de las operaciones de direcciones que salen antes de llegar a la base: la app usa POOL_FALSO, así que si alguna
// la consultara, la respuesta sería un 500 (RF-2.2.5, RNF-03). Lo que necesita la base está en
// pruebas/integracion/direcciones-http.test.ts.

const contrato = cargarContrato();
const SUB = '6f1c1d1e-3b0a-4f55-9a6b-0d7a8f4c2e11';
const OTRO = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const DIRECCION = 'b3a1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const CASA = { tipo: 'FAVORITA', alias: 'Casa', texto: 'Calle Falsa 123', coordenadas: { latitud: -45.12, longitud: -30.56 } };
const PROBLEMA_JSON = /^application\/problem\+json/;

type Rol = 'CLIENTE' | 'CONDUCTOR' | 'OPERADOR' | 'SERVICIO';
const token = (roles: Rol[], sub = SUB) => bearer({ claims: { sub, roles } });

const app = () =>
  crearApp({ crearDireccion, listarDirecciones, obtenerDireccion, actualizarDireccion, eliminarDireccion }, { contrato });

const rutaDe = (clienteId = SUB, direccionId?: string) =>
  `/api/v1/clientes/${clienteId}/direcciones${direccionId === undefined ? '' : `/${direccionId}`}`;

const listado = (encabezados: Record<string, string>, query = '', clienteId = SUB) =>
  app().inject({ method: 'GET', url: `${rutaDe(clienteId)}${query}`, headers: encabezados });

const alta = (encabezados: Record<string, string>, payload: unknown = CASA, clienteId = SUB) =>
  app().inject({
    method: 'POST',
    url: rutaDe(clienteId),
    headers: { 'idempotency-key': 'clave-1', ...encabezados },
    payload: payload as object,
  });

const consulta = (encabezados: Record<string, string>, clienteId = SUB, direccionId = DIRECCION) =>
  app().inject({ method: 'GET', url: rutaDe(clienteId, direccionId), headers: encabezados });

const cambio = (encabezados: Record<string, string>, payload: unknown = { texto: 'Nuevo' }, clienteId = SUB, direccionId = DIRECCION) =>
  app().inject({ method: 'PATCH', url: rutaDe(clienteId, direccionId), headers: encabezados, payload: payload as object });

const baja = (encabezados: Record<string, string>, clienteId = SUB, direccionId = DIRECCION) =>
  app().inject({ method: 'DELETE', url: rutaDe(clienteId, direccionId), headers: encabezados });

describe('las cinco operaciones de direcciones: sin token, 401', () => {
  it.each([
    ['listarDirecciones', () => listado({})],
    ['crearDireccion', () => alta({})],
    ['obtenerDireccion', () => consulta({})],
    ['actualizarDireccion', () => cambio({})],
    ['eliminarDireccion', () => baja({})],
  ])('%s', async (_nombre, llamar) => {
    const respuesta = await llamar();

    expect(respuesta.statusCode).toBe(401);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
  });
});

describe('roles que el contrato no admite, 403 por el rol (RNF-12.3)', () => {
  it.each([[['SERVICIO']], [['CONDUCTOR']]] as Rol[][][])('con %j ninguna de las cinco', async (roles) => {
    const encabezados = token(roles);

    for (const respuesta of [
      await listado(encabezados),
      await alta(encabezados),
      await consulta(encabezados),
      await cambio(encabezados),
      await baja(encabezados),
    ]) {
      expect(respuesta.statusCode).toBe(403);
      expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
      expect(respuesta.json().detail).toBe('El rol del token no permite esta operación');
    }
  });

  it('un OPERADOR solo lee: crear, actualizar y eliminar dan 403 por el rol (spec, Usuarios)', async () => {
    const encabezados = token(['OPERADOR']);

    for (const respuesta of [await alta(encabezados), await cambio(encabezados), await baja(encabezados)]) {
      expect(respuesta.statusCode).toBe(403);
      expect(respuesta.json().detail).toBe('El rol del token no permite esta operación');
    }
  });

  it('el 403 va antes que los errores del cuerpo y de la ruta (RNF-03.5)', async () => {
    const encabezados = token(['OPERADOR']);

    expect((await alta(encabezados, { tipo: 'NADA' })).statusCode).toBe(403);
    expect((await cambio(encabezados, {}, SUB, 'no-es-un-uuid')).statusCode).toBe(403);
  });
});

describe('propiedad: un CLIENTE sobre otro cliente, 403 antes de mirar si existe (RF-2.2.5)', () => {
  const ajeno = token(['CLIENTE']);

  it.each([
    ['listarDirecciones', () => listado(ajeno, '', OTRO)],
    ['crearDireccion', () => alta(ajeno, CASA, OTRO)],
    ['obtenerDireccion', () => consulta(ajeno, OTRO)],
    ['actualizarDireccion', () => cambio(ajeno, { texto: 'X' }, OTRO)],
    ['eliminarDireccion', () => baja(ajeno, OTRO)],
  ])('%s', async (_nombre, llamar) => {
    const respuesta = await llamar();

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
    expect(respuesta.json()).toMatchObject({ status: 403, detail: 'El perfil pedido es de otro cliente' });
    // `instance` repite la ruta pedida, que ya lleva el clienteId de quien llama; el detalle no debe llevar ningún id.
    expect(respuesta.json().detail).not.toContain(OTRO);
    expect(respuesta.json().detail).not.toContain(SUB);
  });

  it('CLIENTE+CONDUCTOR sigue siendo solo CLIENTE: 403 sobre otro cliente', async () => {
    expect((await listado(token(['CLIENTE', 'CONDUCTOR']), '', OTRO)).statusCode).toBe(403);
  });

  it('CLIENTE+OPERADOR no escribe en otro cliente: para esas operaciones solo CLIENTE es efectivo', async () => {
    const mixto = token(['CLIENTE', 'OPERADOR']);

    for (const respuesta of [await alta(mixto, CASA, OTRO), await cambio(mixto, { texto: 'X' }, OTRO), await baja(mixto, OTRO)]) {
      expect(respuesta.statusCode).toBe(403);
      expect(respuesta.json().detail).toBe('El perfil pedido es de otro cliente');
    }
  });

  it('el sub en mayúsculas es el mismo cliente: la propiedad pasa y se llega a la base', async () => {
    // POOL_FALSO falla al consultar: un 500 prueba que no se rechazó por la propiedad.
    const respuesta = await listado(token(['CLIENTE'], SUB.toUpperCase()), '', SUB);

    expect(respuesta.statusCode).toBe(500);
  });
});

describe('crearDireccion: un cuerpo inválido, 400 (RNF-03)', () => {
  it.each([
    ['sin tipo', { texto: 'Calle Falsa 123' }],
    ['sin texto', { tipo: 'FAVORITA' }],
    ['con un tipo desconocido', { tipo: 'PREFERIDA', texto: 'Calle Falsa 123' }],
    ['con un tipo en minúsculas', { tipo: 'favorita', texto: 'Calle Falsa 123' }],
    ['con el texto vacío', { tipo: 'FAVORITA', texto: '' }],
    ['con un texto de 256 caracteres', { tipo: 'FAVORITA', texto: 'T'.repeat(256) }],
    ['con un alias de 51 caracteres', { tipo: 'FAVORITA', texto: 'X', alias: 'A'.repeat(51) }],
    ['con alias null', { tipo: 'FAVORITA', texto: 'X', alias: null }],
    ['con coordenadas null', { tipo: 'FAVORITA', texto: 'X', coordenadas: null }],
    ['con la latitud en 90.1', { tipo: 'FAVORITA', texto: 'X', coordenadas: { latitud: 90.1, longitud: 0 } }],
    ['con la latitud en -91', { tipo: 'FAVORITA', texto: 'X', coordenadas: { latitud: -91, longitud: 0 } }],
    ['con la longitud en 180.1', { tipo: 'FAVORITA', texto: 'X', coordenadas: { latitud: 0, longitud: 180.1 } }],
    ['con la longitud en -181', { tipo: 'FAVORITA', texto: 'X', coordenadas: { latitud: 0, longitud: -181 } }],
    ['con coordenadas sin longitud', { tipo: 'FAVORITA', texto: 'X', coordenadas: { latitud: 0 } }],
    ['con coordenadas sin latitud', { tipo: 'FAVORITA', texto: 'X', coordenadas: { longitud: 0 } }],
    ['con latitud como texto', { tipo: 'FAVORITA', texto: 'X', coordenadas: { latitud: '0', longitud: 0 } }],
    ['con un campo que el contrato no tiene', { tipo: 'FAVORITA', texto: 'X', zona: 'Norte' }],
    ['con un campo extra dentro de las coordenadas', { tipo: 'FAVORITA', texto: 'X', coordenadas: { latitud: 0, longitud: 0, altura: 3 } }],
    ['con direccionId (lo genera M2)', { direccionId: DIRECCION, tipo: 'FAVORITA', texto: 'X' }],
  ])('un cuerpo %s', async (_caso, cuerpo) => {
    const respuesta = await alta(token(['CLIENTE']), cuerpo);

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
    expect(respuesta.json()).toMatchObject({ status: 400, title: 'Solicitud inválida' });
  });

  it('sin Idempotency-Key, 400 (el contrato la exige)', async () => {
    const respuesta = await app().inject({
      method: 'POST',
      url: rutaDe(),
      headers: token(['CLIENTE']),
      payload: CASA,
    });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json().detail).toMatch(/Idempotency-Key/i);
  });

  it('una Idempotency-Key de 256 caracteres, 400', async () => {
    const respuesta = await alta({ ...token(['CLIENTE']), 'idempotency-key': 'k'.repeat(256) });

    expect(respuesta.statusCode).toBe(400);
  });

  it('el 400 no devuelve el texto, el alias ni las coordenadas enviados (RNF-19)', async () => {
    const respuesta = await alta(token(['CLIENTE']), {
      tipo: 'PREFERIDA',
      alias: 'Alias-secreto-17',
      texto: 'Direccion-secreta-17',
      coordenadas: { latitud: 12.3456789, longitud: 98.7654321 },
    });

    expect(respuesta.statusCode).toBe(400);
    for (const dato of ['Alias-secreto-17', 'Direccion-secreta-17', '12.3456789', '98.7654321']) {
      expect(respuesta.body).not.toContain(dato);
    }
  });
});

describe('actualizarDireccion: un cuerpo inválido, 400', () => {
  it.each([
    ['vacío', {}],
    ['con un campo desconocido', { zona: 'Norte' }],
    ['con un tipo desconocido', { tipo: 'PREFERIDA' }],
    ['con el texto vacío', { texto: '' }],
    ['con un texto de 256 caracteres', { texto: 'T'.repeat(256) }],
    ['con un alias de 51 caracteres', { alias: 'A'.repeat(51) }],
    ['con alias null: el contrato no permite quitarlo', { alias: null }],
    ['con coordenadas null: el contrato no permite quitarlas', { coordenadas: null }],
    ['con coordenadas incompletas', { coordenadas: { latitud: 1 } }],
    ['con la longitud fuera de rango', { coordenadas: { latitud: 1, longitud: 181 } }],
    ['con creadoEn', { creadoEn: '2026-01-01T00:00:00Z' }],
  ])('un PATCH %s', async (_caso, cuerpo) => {
    const respuesta = await cambio(token(['CLIENTE']), cuerpo);

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
  });
});

describe('listarDirecciones: parámetros inválidos, 400', () => {
  it.each([
    ['un tipo desconocido', '?tipo=PREFERIDA'],
    ['un tipo en minúsculas', '?tipo=favorita'],
    ['page negativa', '?page=-1'],
    ['page que no es número', '?page=abc'],
    ['size 0', '?size=0'],
    ['size 101', '?size=101'],
    ['size que no es número', '?size=x'],
  ])('%s', async (_caso, query) => {
    const respuesta = await listado(token(['CLIENTE']), query);

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
  });
});

describe('ids de la ruta que no son UUID, 400', () => {
  it('un clienteId inválido en las cinco', async () => {
    const encabezados = token(['CLIENTE']);

    for (const respuesta of [
      await listado(encabezados, '', 'no-es-un-uuid'),
      await alta(encabezados, CASA, 'no-es-un-uuid'),
      await consulta(encabezados, 'no-es-un-uuid'),
      await cambio(encabezados, { texto: 'X' }, 'no-es-un-uuid'),
      await baja(encabezados, 'no-es-un-uuid'),
    ]) {
      expect(respuesta.statusCode).toBe(400);
    }
  });

  it('un direccionId inválido en las tres que lo llevan', async () => {
    const encabezados = token(['CLIENTE']);

    for (const respuesta of [
      await consulta(encabezados, SUB, 'no-es-un-uuid'),
      await cambio(encabezados, { texto: 'X' }, SUB, 'no-es-un-uuid'),
      await baja(encabezados, SUB, 'no-es-un-uuid'),
    ]) {
      expect(respuesta.statusCode).toBe(400);
    }
  });
});

describe('métodos que la ruta no tiene, 405', () => {
  it('PUT sobre una dirección y PATCH sobre la colección', async () => {
    const encabezados = token(['CLIENTE']);

    const put = await app().inject({ method: 'PUT', url: rutaDe(SUB, DIRECCION), headers: encabezados, payload: CASA });
    const patch = await app().inject({ method: 'PATCH', url: rutaDe(SUB), headers: encabezados, payload: { texto: 'X' } });

    expect(put.statusCode).toBe(405);
    expect(patch.statusCode).toBe(405);
  });
});
