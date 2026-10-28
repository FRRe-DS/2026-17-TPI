import { afterEach, describe, expect, it } from 'vitest';
import { tokenDeServicio } from '../../../src/auth/tokens.js';
import { firmarToken } from '../../../panel/servidor/tokens.js';
import { capturarLogs } from '../../ayudas/logs.js';
import { armarToken } from '../../ayudas/tokens.js';
import { construirAppM6 } from '../../../panel/m6-simulado/app-m6.js';
import { crearEstadoM6 } from '../../../panel/m6-simulado/estado.js';
import { CLIENTE, CONDUCTOR, CONFIG_M6, crearM6, OTRO_CLIENTE, viaje } from '../ayudas/m6.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const abiertas: ReturnType<typeof crearM6>['app'][] = [];
function m6(viajes: Parameters<typeof crearM6>[0] = []) {
  const creado = crearM6(viajes);
  abiertas.push(creado.app);
  return creado.app;
}
afterEach(async () => {
  await Promise.all(abiertas.splice(0).map((app) => app.close()));
});

// El token que manda M2 de verdad: `tokenDeServicio` de src/auth/tokens.ts, con la configuración del M6 simulado.
const comoM2 = async (config = CONFIG_M6) => ({ authorization: `Bearer ${await tokenDeServicio(config)}` });

// Un token del consorcio armado a mano, válido para M6 salvo lo que se cambie.
const aMano = (claims: Record<string, unknown> = {}, opciones: Parameters<typeof armarToken>[0] = {}) => ({
  authorization: `Bearer ${armarToken({
    config: { claveTokens: CONFIG_M6.claveTokens, emisorTokens: CONFIG_M6.emisorTokens, audienciaTokens: CONFIG_M6.audienciaM6, campoRoles: 'roles' },
    claims: { roles: ['SERVICIO'], sub: 'm2-clientes', ...claims },
    ...opciones,
  })}`,
});

describe('token de servicio (RNF-13.7): el M6 simulado acepta lo que manda M2 y nada más', () => {
  it('acepta el token de servicio de M2', async () => {
    const respuesta = await m6([viaje(id(1))]).inject({ method: 'GET', url: `/api/v1/trips/${id(1)}`, headers: await comoM2() });

    expect(respuesta.statusCode).toBe(200);
  });

  it('acepta el token armado a mano con el formato del acuerdo', async () => {
    expect((await m6([viaje(id(1))]).inject({ method: 'GET', url: `/api/v1/trips/${id(1)}`, headers: aMano() })).statusCode).toBe(200);
  });

  it.each([
    ['sin token', async () => ({})],
    ['sin Bearer', async () => ({ authorization: armarToken() })],
    ['con un token que no es un JWT', async () => ({ authorization: 'Bearer no-es-un-jwt' })],
    ['con un token sin rol SERVICIO', async () => aMano({ roles: ['CLIENTE'] })],
    ['con los roles vacíos', async () => aMano({ roles: [] })],
    ['sin el campo de roles', async () => aMano({ roles: undefined })],
    ['con SERVICIO en minúscula', async () => aMano({ roles: ['servicio'] })],
    ['con el rol como texto y no como lista', async () => aMano({ roles: 'SERVICIO' })],
    ['de otra audiencia', async () => comoM2({ ...CONFIG_M6, audienciaM6: 'otra-audiencia' })],
    ['con la audiencia de M2 y no la de M6', async () => aMano({ aud: CONFIG_M6.audienciaTokens })],
    ['de otro emisor', async () => aMano({ iss: 'otro-emisor' })],
    ['firmado con otra clave', async () => comoM2({ ...CONFIG_M6, claveTokens: 'otra-clave-de-prueba-de-32-caracteres' })],
    ['vencido', async () => aMano({ exp: Math.floor(Date.now() / 1000) - 120 })],
    ['sin exp', async () => aMano({ exp: undefined })],
    ['sin firma (alg none)', async () => aMano({}, { alg: 'none' })],
    ['con HS512', async () => aMano({}, { alg: 'HS512' })],
  ])('responde 401 %s', async (_caso, encabezados) => {
    const respuesta = await m6([viaje(id(1))]).inject({ method: 'GET', url: `/api/v1/trips/${id(1)}`, headers: await encabezados() });

    expect(respuesta.statusCode).toBe(401);
    expect(respuesta.json()).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('un token de persona que firma el panel (rol CLIENTE, audiencia de M2) no sirve', async () => {
    const token = await firmarToken({ sub: CLIENTE, roles: ['CLIENTE'] }, CONFIG_M6);

    const respuesta = await m6([viaje(id(1))]).inject({ method: 'GET', url: `/api/v1/trips/${id(1)}`, headers: { authorization: `Bearer ${token}` } });

    expect(respuesta.statusCode).toBe(401);
  });

  it('el 401 va antes que todo: también en una ruta que no existe y en la lista', async () => {
    const app = m6();
    expect((await app.inject({ method: 'GET', url: '/api/v1/otra' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/api/v1/trips?clientId=${CLIENTE}` })).statusCode).toBe(401);
  });

  it('el 401 no repite el token', async () => {
    const respuesta = await m6().inject({ method: 'GET', url: '/api/v1/trips', headers: aMano({ roles: ['CLIENTE'] }) });

    expect(respuesta.body).not.toContain('eyJ');
  });
});

describe('GET /api/v1/trips (RF-2.4): filtra, ordena y pagina como el contrato', () => {
  const VIAJES = [
    viaje(id(1), { createdAt: '2026-10-01T10:00:00.000Z' }),
    viaje(id(2), { createdAt: '2026-10-03T10:00:00.000Z', state: 'IN_PROGRESS', driverId: undefined, distanceKm: null, durationMinutes: null }),
    viaje(id(3), { createdAt: '2026-10-02T10:00:00.000Z', state: 'CANCELLED_BY_CLIENT' }),
    viaje(id(4), { clientId: OTRO_CLIENTE, createdAt: '2026-10-04T10:00:00.000Z' }),
  ];

  const listar = async (query: string) => {
    const respuesta = await m6(VIAJES).inject({ method: 'GET', url: `/api/v1/trips?${query}`, headers: await comoM2() });
    return { estado: respuesta.statusCode, cuerpo: respuesta.json<{ items: { id: string; state: string }[]; page: number; pageSize: number; total: number }>() };
  };

  it('filtra por clientId y ordena por createdAt, el más nuevo primero', async () => {
    const { estado, cuerpo } = await listar(`clientId=${CLIENTE}`);

    expect(estado).toBe(200);
    expect(cuerpo.items.map((v) => v.id)).toEqual([id(2), id(3), id(1)]);
    expect(cuerpo).toMatchObject({ page: 1, pageSize: 20, total: 3 });
  });

  it('el clientId no distingue mayúsculas', async () => {
    expect((await listar(`clientId=${CLIENTE.toUpperCase()}`)).cuerpo.total).toBe(3);
  });

  it('filtra por state', async () => {
    const { cuerpo } = await listar(`clientId=${CLIENTE}&state=COMPLETED`);

    expect(cuerpo.items.map((v) => v.id)).toEqual([id(1)]);
    expect(cuerpo.total).toBe(1);
  });

  it('filtra por state solo', async () => {
    expect((await listar('state=COMPLETED')).cuerpo.items.map((v) => v.id)).toEqual([id(4), id(1)]);
  });

  it('filtra por driverId', async () => {
    expect((await listar(`driverId=${CONDUCTOR}`)).cuerpo.total).toBe(3);
  });

  it('un cliente sin viajes recibe una página vacía', async () => {
    expect((await listar('clientId=55555555-5555-4555-8555-555555555555')).cuerpo).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
  });

  it('pagina con page desde 1 y pageSize', async () => {
    const primera = await listar(`clientId=${CLIENTE}&page=1&pageSize=2`);
    const segunda = await listar(`clientId=${CLIENTE}&page=2&pageSize=2`);
    const fuera = await listar(`clientId=${CLIENTE}&page=3&pageSize=2`);

    expect(primera.cuerpo).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(primera.cuerpo.items.map((v) => v.id)).toEqual([id(2), id(3)]);
    expect(segunda.cuerpo.items.map((v) => v.id)).toEqual([id(1)]);
    expect(fuera.cuerpo).toMatchObject({ items: [], page: 3, total: 3 });
  });

  it('el resumen no lleva coordenadas, y un viaje sin conductor no trae driverId', async () => {
    const { cuerpo } = await listar(`clientId=${CLIENTE}&state=IN_PROGRESS`);

    expect(cuerpo.items[0]).toEqual({ id: id(2), state: 'IN_PROGRESS', clientId: CLIENTE, distanceKm: null, durationMinutes: null, createdAt: '2026-10-03T10:00:00.000Z' });
  });

  it('sin ningún filtro responde 400 FILTER_REQUIRED, como el M6 del Grupo 12 con rol SERVICIO', async () => {
    const { estado, cuerpo } = await listar('page=1');

    expect(estado).toBe(400);
    expect(cuerpo).toMatchObject({ code: 'FILTER_REQUIRED' });
  });

  it.each([
    'clientId=no-es-uuid',
    'driverId=123',
    'state=TERMINADO',
    `clientId=${CLIENTE}&page=0`,
    `clientId=${CLIENTE}&page=1.5`,
    `clientId=${CLIENTE}&page=abc`,
    `clientId=${CLIENTE}&pageSize=0`,
    `clientId=${CLIENTE}&pageSize=101`,
  ])('rechaza %s con 400', async (query) => {
    const { estado, cuerpo } = await listar(query);

    expect(estado).toBe(400);
    expect(cuerpo).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('acepta pageSize 100', async () => {
    expect((await listar(`clientId=${CLIENTE}&pageSize=100`)).cuerpo.pageSize).toBe(100);
  });
});

describe('GET /api/v1/trips/{id} (RF-2.5)', () => {
  it('devuelve el viaje completo, de cualquier cliente: el rol SERVICIO puede verlos todos', async () => {
    const app = m6([viaje(id(1)), viaje(id(4), { clientId: OTRO_CLIENTE })]);
    const encabezados = await comoM2();

    expect((await app.inject({ method: 'GET', url: `/api/v1/trips/${id(1)}`, headers: encabezados })).json()).toEqual(viaje(id(1)));
    expect((await app.inject({ method: 'GET', url: `/api/v1/trips/${id(4)}`, headers: encabezados })).json()).toMatchObject({ clientId: OTRO_CLIENTE });
  });

  it('el id no distingue mayúsculas', async () => {
    const respuesta = await m6([viaje(id(1))]).inject({ method: 'GET', url: `/api/v1/trips/${id(1).toUpperCase()}`, headers: await comoM2() });

    expect(respuesta.statusCode).toBe(200);
  });

  it.each([
    ['un viaje que no existe', '/api/v1/trips/44444444-4444-4444-8444-444444444444'],
    ['un id que no es UUID', '/api/v1/trips/no-es-uuid'],
    ['una ruta que no existe', '/api/v1/viajes'],
  ])('%s da 404 NOT_FOUND', async (_caso, url) => {
    const respuesta = await m6([viaje(id(1))]).inject({ method: 'GET', url, headers: await comoM2() });

    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.json()).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('logs del M6 simulado', () => {
  it('una línea por pedido, con la plantilla de la ruta y sin el token', async () => {
    const logs = capturarLogs();
    const estado = crearEstadoM6();
    estado.guardar(viaje(id(1)));
    const app = construirAppM6({ config: CONFIG_M6, estado, flujoLog: logs.flujo });
    abiertas.push(app);
    const encabezados = await comoM2();

    await app.inject({ method: 'GET', url: `/api/v1/trips/${id(1)}`, headers: { ...encabezados, 'x-request-id': 'de-m2' } });
    await app.inject({ method: 'GET', url: `/api/v1/trips?clientId=${CLIENTE}`, headers: encabezados });

    expect(logs.lineas().map((l) => [l['metodo'], l['ruta'], l['estado']])).toEqual([
      ['GET', '/api/v1/trips/:id', 200],
      ['GET', '/api/v1/trips', 200],
    ]);
    expect(logs.lineas()[0]?.idCorrelacion).toBe('de-m2');
    expect(logs.texto()).not.toContain(encabezados.authorization.slice(7));
    expect(logs.texto()).not.toContain(CLIENTE);
  });
});
