import { describe, expect, it } from 'vitest';
import {
  actualizarCliente,
  crearBloqueo,
  crearCliente,
  levantarBloqueo,
  listarBloqueos,
  obtenerBloqueo,
  obtenerCliente,
  obtenerEstadoCuenta,
} from '../../src/clientes/operaciones.js';
import { cargarContrato } from '../../src/contrato/cargar.js';
import { crearApp } from '../ayudas/app.js';
import { bearer } from '../ayudas/tokens.js';

// Los rechazos de las operaciones de perfil que salen antes de llegar a la base: la app usa POOL_FALSO, así que si alguna
// la consultara, la respuesta sería un 500 (RF-2.1.1.1, RF-2.1.2.1, RNF-03). Lo que necesita la base está en
// pruebas/integracion/clientes-http.test.ts.

const contrato = cargarContrato();
const SUB = '6f1c1d1e-3b0a-4f55-9a6b-0d7a8f4c2e11';
const OTRO = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const ANA = { nombre: 'Ana', apellido: 'Gómez', telefono: '+5493624000000' };
const PROBLEMA_JSON = /^application\/problem\+json/;

type Rol = 'CLIENTE' | 'CONDUCTOR' | 'OPERADOR' | 'SERVICIO';
const token = (roles: Rol[], sub = SUB) => bearer({ claims: { sub, roles } });

function crear() {
  return crearApp(
    { crearCliente, obtenerCliente, actualizarCliente, obtenerEstadoCuenta, crearBloqueo, listarBloqueos, obtenerBloqueo, levantarBloqueo },
    { contrato },
  );
}

const alta = (encabezados: Record<string, string>, payload: unknown = ANA) =>
  crear().inject({
    method: 'POST',
    url: '/api/v1/clientes',
    headers: { 'idempotency-key': 'clave-1', ...encabezados },
    payload: payload as object,
  });

const lectura = (encabezados: Record<string, string>, clienteId = SUB) =>
  crear().inject({ method: 'GET', url: `/api/v1/clientes/${clienteId}`, headers: encabezados });

const cambio = (encabezados: Record<string, string>, payload: unknown = { nombre: 'Beatriz' }, clienteId = SUB) =>
  crear().inject({ method: 'PATCH', url: `/api/v1/clientes/${clienteId}`, headers: encabezados, payload: payload as object });

describe('crearCliente: lo que se rechaza sin tocar la base', () => {
  it('sin token, 401', async () => {
    expect((await alta({})).statusCode).toBe(401);
  });

  it.each([[['OPERADOR']], [['SERVICIO']], [['CONDUCTOR']]] as Rol[][][])('con %j, 403: solo CLIENTE crea un perfil', async (roles) => {
    const respuesta = await alta(token(roles));

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
  });

  it('un sub que no es UUID: 400 en problem+json, sin el sub en la respuesta (spec 004, Casos límite)', async () => {
    const respuesta = await alta(token(['CLIENTE'], 'usuario-17'));

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
    expect(respuesta.json()).toEqual({
      type: 'about:blank',
      title: 'Solicitud inválida',
      status: 400,
      detail: 'El sub del token no es un UUID: no puede ser el clienteId de un perfil',
      instance: '/api/v1/clientes',
    });
    expect(respuesta.body).not.toContain('usuario-17');
  });

  it('sin Idempotency-Key, 400 (el contrato la exige)', async () => {
    const respuesta = await crear().inject({
      method: 'POST',
      url: '/api/v1/clientes',
      headers: token(['CLIENTE']),
      payload: ANA,
    });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json().detail).toMatch(/Idempotency-Key/i);
  });

  it.each([
    ['sin nombre', { apellido: 'Gómez', telefono: '+5493624000000' }],
    ['con un teléfono que no es E.164', { ...ANA, telefono: '3624000000' }],
    ['con un campo que el contrato no tiene', { ...ANA, apodo: 'Anita' }],
    ['con una fecha de nacimiento que no es una fecha', { ...ANA, fechaNacimiento: '17/05/1990' }],
    ['con un nombre de más de 100 caracteres', { ...ANA, nombre: 'A'.repeat(101) }],
  ])('un cuerpo %s, 400', async (_caso, cuerpo) => {
    const respuesta = await alta(token(['CLIENTE']), cuerpo);

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
  });
});

describe('obtenerCliente: lo que se rechaza sin tocar la base', () => {
  it('sin token, 401', async () => {
    expect((await lectura({})).statusCode).toBe(401);
  });

  it('un CLIENTE que pide el perfil de otro, 403 antes de mirar si existe (RF-2.1.1.1)', async () => {
    const respuesta = await lectura(token(['CLIENTE']), OTRO);

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json()).toMatchObject({ status: 403, detail: 'El perfil pedido es de otro cliente' });
  });

  it('CLIENTE+CONDUCTOR sigue siendo solo CLIENTE para esta operación: 403 sobre otro perfil', async () => {
    expect((await lectura(token(['CLIENTE', 'CONDUCTOR']), OTRO)).statusCode).toBe(403);
  });

  it('SERVICIO no lee perfiles: 403', async () => {
    expect((await lectura(token(['SERVICIO']))).statusCode).toBe(403);
  });

  it('un clienteId que no es UUID, 400', async () => {
    expect((await lectura(token(['OPERADOR']), 'no-es-un-uuid')).statusCode).toBe(400);
  });
});

const estadoCuenta = (encabezados: Record<string, string>, clienteId = SUB) =>
  crear().inject({ method: 'GET', url: `/api/v1/clientes/${clienteId}/estado-cuenta`, headers: encabezados });

describe('obtenerEstadoCuenta: lo que se rechaza sin tocar la base (RF-2.6)', () => {
  it('sin token, 401', async () => {
    expect((await estadoCuenta({})).statusCode).toBe(401);
  });

  it('un CLIENTE que pide la cuenta de otro, 403 antes de mirar si existe', async () => {
    const respuesta = await estadoCuenta(token(['CLIENTE']), OTRO);

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
    expect(respuesta.json()).toMatchObject({ status: 403, detail: 'El perfil pedido es de otro cliente' });
  });

  it('CLIENTE+CONDUCTOR sigue siendo solo CLIENTE para esta operación: 403 sobre otra cuenta', async () => {
    expect((await estadoCuenta(token(['CLIENTE', 'CONDUCTOR']), OTRO)).statusCode).toBe(403);
  });

  it('un CONDUCTOR solo no consulta cuentas: 403 por el rol', async () => {
    expect((await estadoCuenta(token(['CONDUCTOR']))).statusCode).toBe(403);
  });

  it('un clienteId que no es UUID, 400', async () => {
    expect((await estadoCuenta(token(['OPERADOR']), 'no-es-un-uuid')).statusCode).toBe(400);
  });
});

describe('actualizarCliente: lo que se rechaza sin tocar la base', () => {
  it('sin token, 401', async () => {
    expect((await cambio({})).statusCode).toBe(401);
  });

  it('un CLIENTE que cambia el perfil de otro, 403 (RF-2.1.2.1)', async () => {
    expect((await cambio(token(['CLIENTE']), { nombre: 'Beatriz' }, OTRO)).statusCode).toBe(403);
  });

  it('CLIENTE+OPERADOR tampoco cambia el de otro: para esta operación solo CLIENTE es efectivo', async () => {
    const respuesta = await cambio(token(['CLIENTE', 'OPERADOR']), { nombre: 'Beatriz' }, OTRO);

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json().detail).toBe('El perfil pedido es de otro cliente');
  });

  it('un OPERADOR solo no cambia perfiles: 403 por el rol (spec 004, Casos límite)', async () => {
    const respuesta = await cambio(token(['OPERADOR']));

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json().detail).toBe('El rol del token no permite esta operación');
  });

  it.each([
    ['vacío', {}],
    ['con un campo desconocido', { apodo: 'Anita' }],
    ['con un teléfono que no es E.164', { telefono: 'x' }],
    ['con un nombre vacío', { nombre: '' }],
  ])('un PATCH %s, 400 (spec 004, Casos límite)', async (_caso, cuerpo) => {
    expect((await cambio(token(['CLIENTE']), cuerpo)).statusCode).toBe(400);
  });
});

const BLOQUEO = 'b3a1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

const altaBloqueo = (encabezados: Record<string, string>, payload: unknown = { motivo: 'Deuda pendiente' }, clienteId = SUB) =>
  crear().inject({
    method: 'POST',
    url: `/api/v1/clientes/${clienteId}/bloqueos`,
    headers: { 'idempotency-key': 'clave-1', ...encabezados },
    payload: payload as object,
  });

const historial = (encabezados: Record<string, string>, query = '', clienteId = SUB) =>
  crear().inject({ method: 'GET', url: `/api/v1/clientes/${clienteId}/bloqueos${query}`, headers: encabezados });

const unBloqueo = (encabezados: Record<string, string>, bloqueoId = BLOQUEO, clienteId = SUB) =>
  crear().inject({ method: 'GET', url: `/api/v1/clientes/${clienteId}/bloqueos/${bloqueoId}`, headers: encabezados });

describe('crearBloqueo: lo que se rechaza sin tocar la base (RF-2.6.1)', () => {
  it('sin token, 401', async () => {
    expect((await altaBloqueo({})).statusCode).toBe(401);
  });

  it.each([[['CLIENTE']], [['SERVICIO']], [['CONDUCTOR']]] as Rol[][][])('con %j, 403: solo OPERADOR bloquea', async (roles) => {
    const respuesta = await altaBloqueo(token(roles));

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
  });

  it('sin Idempotency-Key, 400 (el contrato la exige)', async () => {
    const respuesta = await crear().inject({
      method: 'POST',
      url: `/api/v1/clientes/${SUB}/bloqueos`,
      headers: token(['OPERADOR']),
      payload: { motivo: 'Deuda pendiente' },
    });

    expect(respuesta.statusCode).toBe(400);
  });

  it.each([
    ['sin motivo', {}],
    ['con motivo vacío', { motivo: '' }],
    ['con motivo de 501 caracteres', { motivo: 'x'.repeat(501) }],
    ['con un campo de más', { motivo: 'x', creadoPor: 'otro' }],
    ['con hasta que no es fecha y hora', { motivo: 'x', hasta: '2099-01-01' }],
  ])('un cuerpo %s, 400', async (_caso, payload) => {
    const respuesta = await altaBloqueo(token(['OPERADOR']), payload);

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
  });

  it.each(['2020-01-01T00:00:00Z', '0000-01-01T00:00:00Z'])(
    'hasta %s, ya pasada: 422 con tipo propio, sin tocar la base (spec 004, Casos límite)',
    async (hasta) => {
      const respuesta = await altaBloqueo(token(['OPERADOR']), { motivo: 'Deuda pendiente', hasta });

      expect(respuesta.statusCode).toBe(422);
      expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
      expect(respuesta.json()).toEqual({
        type: '/errores/bloqueo-vencido',
        title: 'Bloqueo vencido',
        status: 422,
        detail: 'El fin del bloqueo tiene que ser posterior a su creación',
        instance: `/api/v1/clientes/${SUB}/bloqueos`,
      });
      expect(respuesta.body).not.toContain('Deuda pendiente');
    },
  );
});

describe('listarBloqueos y obtenerBloqueo: lo que se rechaza sin tocar la base (RF-2.6.2)', () => {
  it('sin token, 401', async () => {
    expect((await historial({})).statusCode).toBe(401);
    expect((await unBloqueo({})).statusCode).toBe(401);
  });

  it.each([[['CLIENTE']], [['SERVICIO']], [['CONDUCTOR']]] as Rol[][][])('con %j, 403: solo OPERADOR', async (roles) => {
    expect((await historial(token(roles))).statusCode).toBe(403);
    expect((await unBloqueo(token(roles))).statusCode).toBe(403);
  });

  it.each(['?page=-1', '?size=0', '?size=101', '?vigente=quizas', '?page=uno'])('la query %s, 400', async (query) => {
    const respuesta = await historial(token(['OPERADOR']), query);

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
  });

  it('un bloqueoId o un clienteId que no es UUID, 400', async () => {
    expect((await unBloqueo(token(['OPERADOR']), 'no-es-un-uuid')).statusCode).toBe(400);
    expect((await historial(token(['OPERADOR']), '', 'no-es-un-uuid')).statusCode).toBe(400);
  });
});

const levantamiento = (
  encabezados: Record<string, string>,
  payload: unknown = { motivo: 'Pagó la deuda' },
  bloqueoId = BLOQUEO,
  clienteId = SUB,
) =>
  crear().inject({
    method: 'PATCH',
    url: `/api/v1/clientes/${clienteId}/bloqueos/${bloqueoId}`,
    headers: encabezados,
    payload: payload as object,
  });

describe('levantarBloqueo: lo que se rechaza sin tocar la base (RF-2.6.3)', () => {
  it('sin token, 401', async () => {
    expect((await levantamiento({})).statusCode).toBe(401);
  });

  it.each([[['CLIENTE']], [['SERVICIO']], [['CONDUCTOR']]] as Rol[][][])('con %j, 403: solo OPERADOR levanta', async (roles) => {
    const respuesta = await levantamiento(token(roles));

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
  });

  it.each([
    ['sin motivo', {}],
    ['con motivo vacío', { motivo: '' }],
    ['con motivo de 501 caracteres', { motivo: 'x'.repeat(501) }],
    ['con un campo de más', { motivo: 'x', levantadoPor: 'otro' }],
  ])('un cuerpo %s, 400', async (_caso, payload) => {
    const respuesta = await levantamiento(token(['OPERADOR']), payload);

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
  });

  it('un bloqueoId o un clienteId que no es UUID, 400', async () => {
    expect((await levantamiento(token(['OPERADOR']), undefined, 'no-es-un-uuid')).statusCode).toBe(400);
    expect((await levantamiento(token(['OPERADOR']), undefined, BLOQUEO, 'no-es-un-uuid')).statusCode).toBe(400);
  });
});
