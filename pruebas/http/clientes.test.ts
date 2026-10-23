import { describe, expect, it } from 'vitest';
import { actualizarCliente, crearCliente, obtenerCliente, obtenerEstadoCuenta } from '../../src/clientes/operaciones.js';
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
  return crearApp({ crearCliente, obtenerCliente, actualizarCliente, obtenerEstadoCuenta }, { contrato });
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
