import { describe, expect, it } from 'vitest';
import { cargarContrato } from '../../src/contrato/cargar.js';
import { manejadores } from '../../src/operaciones/index.js';
import { crearApp } from '../ayudas/app.js';
import { bearer } from '../ayudas/tokens.js';

// Los roles de las ocho operaciones de la spec 004 con los manejadores y el contrato del servicio (RF-2.1.1.1, RF-2.1.2.1,
// RF-2.6, RNF-03, RNF-07): quién llega a la operación, quién recibe 403 y quién 401. La app usa POOL_FALSO, así que una
// solicitud que pasa la autorización llega a la base y termina en 500; un rechazo, en cambio, nunca la toca.

const contrato = cargarContrato();
const SUB = '6f1c1d1e-3b0a-4f55-9a6b-0d7a8f4c2e11';
const OTRO = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const BLOQUEO = 'b3a1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const PROBLEMA_JSON = /^application\/problem\+json/;
const LLEGA_A_LA_BASE = 500;

type Rol = 'CLIENTE' | 'CONDUCTOR' | 'OPERADOR' | 'SERVICIO';

type Operacion = {
  operationId: string;
  // Los roles que admite el contrato.
  roles: Rol[];
  // La solicitud sobre el recurso de `clienteId`, con un cuerpo válido.
  pedir: (clienteId: string) => { method: 'GET' | 'POST' | 'PATCH'; url: string; payload?: object; headers?: Record<string, string> };
};

const OPERACIONES: Operacion[] = [
  {
    operationId: 'crearCliente',
    roles: ['CLIENTE'],
    pedir: () => ({
      method: 'POST',
      url: '/api/v1/clientes',
      payload: { nombre: 'Ana', apellido: 'Gómez', telefono: '+5493624000000' },
      headers: { 'idempotency-key': 'clave-1' },
    }),
  },
  { operationId: 'obtenerCliente', roles: ['CLIENTE', 'OPERADOR'], pedir: (id) => ({ method: 'GET', url: `/api/v1/clientes/${id}` }) },
  {
    operationId: 'actualizarCliente',
    roles: ['CLIENTE'],
    pedir: (id) => ({ method: 'PATCH', url: `/api/v1/clientes/${id}`, payload: { nombre: 'Beatriz' } }),
  },
  {
    operationId: 'obtenerEstadoCuenta',
    roles: ['CLIENTE', 'OPERADOR', 'SERVICIO'],
    pedir: (id) => ({ method: 'GET', url: `/api/v1/clientes/${id}/estado-cuenta` }),
  },
  { operationId: 'listarBloqueos', roles: ['OPERADOR'], pedir: (id) => ({ method: 'GET', url: `/api/v1/clientes/${id}/bloqueos` }) },
  {
    operationId: 'crearBloqueo',
    roles: ['OPERADOR'],
    pedir: (id) => ({
      method: 'POST',
      url: `/api/v1/clientes/${id}/bloqueos`,
      payload: { motivo: 'Deuda pendiente' },
      headers: { 'idempotency-key': 'clave-1' },
    }),
  },
  {
    operationId: 'obtenerBloqueo',
    roles: ['OPERADOR'],
    pedir: (id) => ({ method: 'GET', url: `/api/v1/clientes/${id}/bloqueos/${BLOQUEO}` }),
  },
  {
    operationId: 'levantarBloqueo',
    roles: ['OPERADOR'],
    pedir: (id) => ({ method: 'PATCH', url: `/api/v1/clientes/${id}/bloqueos/${BLOQUEO}`, payload: { motivo: 'Pagó la deuda' } }),
  },
];

const COMBINACIONES: Rol[][] = [
  ['CLIENTE'],
  ['OPERADOR'],
  ['SERVICIO'],
  ['CONDUCTOR'],
  ['CLIENTE', 'OPERADOR'],
  ['CLIENTE', 'CONDUCTOR'],
  ['CLIENTE', 'SERVICIO'],
];

// Lo que responde la app a `operacion` sobre el recurso de `clienteId`, con un token de `sub` y `roles`, o sin token.
function llamar(operacion: Operacion, clienteId: string, roles?: Rol[], sub = SUB) {
  const { headers = {}, ...solicitud } = operacion.pedir(clienteId);
  return crearApp(manejadores, { contrato }).inject({
    ...solicitud,
    headers: { ...headers, ...(roles === undefined ? {} : bearer({ claims: { sub, roles } })) },
  });
}

describe('los ocho operationId de la spec 004 están registrados en el servicio (RNF-03)', () => {
  it('el servicio trae un manejador para cada uno, y el contrato los declara con los roles de la matriz', () => {
    const delContrato = Object.values(contrato.paths ?? {}).flatMap((ruta) =>
      Object.values(ruta as Record<string, { operationId?: string; security?: Record<string, string[]>[] }>),
    );

    for (const { operationId, roles } of OPERACIONES) {
      expect(manejadores).toHaveProperty(operationId);
      const declarada = delContrato.find((operacion) => operacion.operationId === operationId);
      expect(declarada?.security?.flatMap((esquema) => esquema.bearerAuth ?? []).sort()).toEqual([...roles].sort());
    }
  });
});

describe.each(OPERACIONES)('$operationId: roles del token (RF-2.1.1.1, RF-2.1.2.1, RF-2.6)', (operacion) => {
  it('sin token, 401 en problem+json', async () => {
    const respuesta = await llamar(operacion, SUB);

    expect(respuesta.statusCode).toBe(401);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
  });

  it('con un token de firma ajena, 401', async () => {
    const { method, url, payload, headers } = operacion.pedir(SUB);
    const respuesta = await crearApp(manejadores, { contrato }).inject({
      method,
      url,
      payload,
      headers: { ...headers, ...bearer({ clave: 'otra-clave-que-no-es-la-del-servicio-1234567890', claims: { sub: SUB, roles: operacion.roles } }) },
    });

    expect(respuesta.statusCode).toBe(401);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
  });

  it.each(COMBINACIONES)('con %s sobre su propio recurso', async (...roles) => {
    const respuesta = await llamar(operacion, SUB, roles);

    if (roles.some((rol) => operacion.roles.includes(rol))) {
      expect(respuesta.statusCode).toBe(LLEGA_A_LA_BASE);
    } else {
      expect(respuesta.statusCode).toBe(403);
      expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
    }
  });
});

describe('el recurso de otro cliente según el rol efectivo (RF-2.1.1.1, RF-2.1.2.1, RF-2.6)', () => {
  const [, obtenerCliente, actualizarCliente, obtenerEstadoCuenta, listarBloqueos] = OPERACIONES as [
    Operacion,
    Operacion,
    Operacion,
    Operacion,
    Operacion,
  ];

  it.each([
    ['obtenerCliente', obtenerCliente],
    ['actualizarCliente', actualizarCliente],
    ['obtenerEstadoCuenta', obtenerEstadoCuenta],
  ])('%s: un CLIENTE que es solo CLIENTE recibe 403 en problem+json, antes de mirar si existe', async (_nombre, operacion) => {
    for (const roles of [['CLIENTE'], ['CLIENTE', 'CONDUCTOR']] as Rol[][]) {
      const respuesta = await llamar(operacion, OTRO, roles);

      expect(respuesta.statusCode).toBe(403);
      expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
    }
  });

  it.each([
    ['obtenerCliente', obtenerCliente],
    ['obtenerEstadoCuenta', obtenerEstadoCuenta],
  ])('%s: CLIENTE+OPERADOR usa las lecturas de OPERADOR y llega al perfil de otro', async (_nombre, operacion) => {
    expect((await llamar(operacion, OTRO, ['CLIENTE', 'OPERADOR'])).statusCode).toBe(LLEGA_A_LA_BASE);
  });

  it('actualizarCliente: CLIENTE+OPERADOR no cambia el perfil de otro, porque la operación solo admite CLIENTE', async () => {
    expect((await llamar(actualizarCliente, OTRO, ['CLIENTE', 'OPERADOR'])).statusCode).toBe(403);
  });

  it.each([
    ['obtenerCliente', obtenerCliente, ['OPERADOR']],
    ['obtenerEstadoCuenta', obtenerEstadoCuenta, ['OPERADOR']],
    ['obtenerEstadoCuenta', obtenerEstadoCuenta, ['SERVICIO']],
    ['listarBloqueos', listarBloqueos, ['OPERADOR']],
  ] as [string, Operacion, Rol[]][])('%s: %j llega a cualquier cliente', async (_nombre, operacion, roles) => {
    expect((await llamar(operacion, OTRO, roles)).statusCode).toBe(LLEGA_A_LA_BASE);
  });

  it('SERVICIO solo llega a obtenerEstadoCuenta: las otras siete operaciones le dan 403', async () => {
    const respuestas = await Promise.all(OPERACIONES.map((operacion) => llamar(operacion, OTRO, ['SERVICIO'])));

    expect(respuestas.map((respuesta, i) => [OPERACIONES[i]?.operationId, respuesta.statusCode])).toEqual(
      OPERACIONES.map(({ operationId }) => [operationId, operationId === 'obtenerEstadoCuenta' ? LLEGA_A_LA_BASE : 403]),
    );
  });
});
