import { jwtVerify } from 'jose';
import { inspect } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aProblema, ErrorDeIntegracion, ModuloNoDisponible } from '../../src/errores.js';
import { crearM6 } from '../../src/historial/m6.js';
import { CONFIG } from '../ayudas/app.js';
import { crearServidorModulo, type Comportamiento } from '../ayudas/servidor-modulo.js';

const TIEMPO_MS = 200;
const CLIENTE = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const CONDUCTOR = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
// Un dato que M6 podría mandar en un cuerpo y que no puede llegar al log ni a la respuesta (RNF-19).
const DEL_CUERPO = 'dato-del-cuerpo-de-m6';

const viaje = (n: number, extra: object = {}) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  state: 'COMPLETED',
  clientId: CLIENTE,
  driverId: CONDUCTOR,
  distanceKm: 3.2,
  durationMinutes: 12,
  createdAt: '2026-10-01T10:00:00Z',
  ...extra,
});

// La respuesta de M6 según su contrato publicado (`TripSummaryPage`, Grupo 12).
const pagina = (items: unknown[], total: number, extra: object = {}) => ({ items, page: 1, pageSize: 20, total, ...extra });

const ok = (cuerpo: unknown): Comportamiento => ({ tipo: 'ok', cuerpo });

describe('crearM6: el pedido de viajes a M6 y la lectura de su respuesta (007/T4)', () => {
  const serv = crearServidorModulo();
  beforeAll(() => serv.levantar());
  afterAll(() => serv.cerrar());

  const m6 = (extra: Partial<typeof CONFIG> = {}) =>
    crearM6({ ...CONFIG, urlM6: serv.url, tiempoModulosMs: TIEMPO_MS, reintentosModulos: 1, ...extra });
  const listar = (page = 0, size = 20, extra: Partial<typeof CONFIG> = {}) =>
    m6(extra).listarViajes(CLIENTE, page, size, 'id-de-correlacion');
  const fallaDe = (promesa: Promise<unknown>) => promesa.catch((motivo: unknown) => motivo);

  describe('el pedido (RF-2.4, RF-2.4.9, RNF-14)', () => {
    it('pide GET /trips con clientId, la página de M6 (page + 1), pageSize y el id de correlación', async () => {
      serv.responderCon(ok(pagina([], 0)));

      await listar(2, 15);

      const url = new URL(serv.rutaRecibida, serv.url);
      expect(url.pathname).toBe('/trips');
      expect(Object.fromEntries(url.searchParams)).toEqual({ clientId: CLIENTE, page: '3', pageSize: '15' });
      expect(serv.encabezadosRecibidos.get('x-request-id')).toBe('id-de-correlacion');
    });

    it('suma /trips a la URL base de M6, que puede traer un camino', async () => {
      serv.responderCon(ok(pagina([], 0)));

      await m6({ urlM6: `${serv.url}/api/v1` }).listarViajes(CLIENTE, 0, 20, 'id');

      expect(new URL(serv.rutaRecibida, serv.url).pathname).toBe('/api/v1/trips');
    });
  });

  // RF-2.4.11, ADR 009: M2 se presenta con un token de servicio de vida corta, firmado en cada intento.
  describe('el token de servicio (RF-2.4.11, RNF-19)', () => {
    const tokenDe = (autorizacion: string | undefined) => /^Bearer (\S+)$/.exec(autorizacion ?? '')?.[1] ?? '';

    // Lo verifica como lo haría M6: con la clave del consorcio, el emisor de M1 y su propia audiencia.
    const verificarComoM6 = (token: string, audiencia = CONFIG.audienciaM6) =>
      jwtVerify(token, new TextEncoder().encode(CONFIG.claveTokens), {
        algorithms: ['HS256'],
        issuer: CONFIG.emisorTokens,
        audience: audiencia,
        requiredClaims: ['exp'],
      });

    it('M6 recibe un token de servicio que verifica con la clave y la audiencia de M6', async () => {
      serv.responderCon(ok(pagina([], 0)));

      await listar(0, 20, { audienciaM6: 'm6-de-prueba' });

      const { payload } = await verificarComoM6(tokenDe(serv.autorizaciones[0]), 'm6-de-prueba');
      expect(payload).toMatchObject({ sub: 'm2-clientes', roles: ['SERVICIO'], aud: 'm6-de-prueba' });
      expect(payload.exp! - payload.iat!).toBe(60);
    });

    it('el reintento lleva un token de servicio propio, que también verifica', async () => {
      serv.responderCon([{ tipo: '5xx', estado: 500 }, ok(pagina([], 0))]);

      await listar();

      expect(serv.llamadas).toBe(2);
      for (const autorizacion of serv.autorizaciones) await verificarComoM6(tokenDe(autorizacion));
    });

    it.each([
      ['un 503 tras el reintento', { tipo: '5xx', estado: 500 }],
      ['un 503 por una demora', { tipo: 'demora-cuerpo', retardoMs: TIEMPO_MS * 4 }],
      ['un 500 por un 401 de M6', { tipo: '4xx', estado: 401 }],
    ] as const)('no aparece en detail, en la causa ni en el error ante %s', async (_caso, falla) => {
      serv.responderCon(falla);

      const error = await fallaDe(listar());
      const token = tokenDe(serv.autorizaciones[0]);

      expect(token).not.toBe('');
      expect(JSON.stringify(aProblema(error).cuerpo)).not.toContain(token);
      expect(inspect(error, { depth: 10 })).not.toContain(token);
      expect(inspect((error as Error).cause, { depth: 10 })).not.toContain(token);
    });
  });

  // 007/V: una página tan lejana que su desplazamiento no es un entero seguro no tiene viajes, y M6 no puede recibir su número
  // (`1e+21`). Se le pide la primera, solo para el total.
  describe('una página inalcanzable (RF-2.4.3)', () => {
    it.each([1e21, Number.MAX_SAFE_INTEGER])('la página %d pide a M6 la primera y devuelve sin viajes, con su total', async (page) => {
      serv.responderCon(ok(pagina([viaje(1), viaje(2)], 42)));

      const resultado = await listar(page, 20);

      expect(Object.fromEntries(new URL(serv.rutaRecibida, serv.url).searchParams)).toEqual({
        clientId: CLIENTE,
        page: '1',
        pageSize: '20',
      });
      expect(resultado).toEqual({ items: [], total: 42 });
    });

    it('si esa primera página no tiene la forma esperada, igual es un 503', async () => {
      serv.responderCon(ok(pagina([], -1)));

      expect(await fallaDe(listar(1e21, 20))).toBeInstanceOf(ModuloNoDisponible);
    });
  });

  describe('un 200 con la forma esperada (RF-2.4, RF-2.4.3)', () => {
    it('devuelve los viajes y el total, en el orden de M6', async () => {
      const items = [viaje(1), viaje(2, { driverId: undefined, state: 'CANCELLED_BY_CLIENT' })];
      serv.responderCon(ok(pagina(items, 42)));

      const resultado = await listar();

      expect(resultado.total).toBe(42);
      expect(resultado.items.map((item) => item.id)).toEqual([viaje(1).id, viaje(2).id]);
      expect(serv.llamadas).toBe(1);
    });

    it('una página vacía es una respuesta válida, con su total', async () => {
      serv.responderCon(ok(pagina([], 0)));
      expect(await listar()).toMatchObject({ items: [], total: 0 });

      serv.responderCon(ok(pagina([], 45, { page: 10 })));
      expect(await listar(9, 20)).toMatchObject({ items: [], total: 45 });
    });

    it('acepta tantos viajes como el size pedido', async () => {
      serv.responderCon(ok(pagina([viaje(1), viaje(2)], 2)));

      expect((await listar(0, 2)).items).toHaveLength(2);
    });

    it('un driverId nulo es un viaje sin conductor, no una respuesta inválida', async () => {
      serv.responderCon(ok(pagina([viaje(1, { driverId: null })], 1)));

      expect((await listar()).items).toHaveLength(1);
    });
  });

  // RF-2.4.6: tras un reintento, 503 que nombra a M6 y lleva Retry-After. La causa no trae el cuerpo (RNF-19).
  describe('M6 no está disponible: 503 con Retry-After (RF-2.4.6, RNF-13)', () => {
    it.each([
      ['un 5xx', { tipo: '5xx', estado: 502, cuerpo: { error: DEL_CUERPO } }],
      ['un cuerpo que no es JSON', { tipo: 'no-json', contenido: `<html>${DEL_CUERPO}</html>` }],
      ['un corte de la conexión', { tipo: 'corta' }],
      ['una demora mayor al tiempo', { tipo: 'demora-cuerpo', retardoMs: TIEMPO_MS * 4, cuerpo: pagina([], 0) }],
    ] as const)('%s: se reintenta una vez y da 503', async (_caso, falla) => {
      serv.responderCon(falla);

      const error = await fallaDe(listar(0, 20, { reintentarDespuesS: 7 }));

      expect(error).toBeInstanceOf(ModuloNoDisponible);
      expect(serv.llamadas).toBe(2);
      const respuesta = aProblema(error);
      expect(respuesta.codigo).toBe(503);
      expect(respuesta.cuerpo.detail).toBe('M6 no está disponible');
      expect(respuesta.encabezados['Retry-After']).toBe('7');
      expect(inspect(error, { depth: 10 })).not.toContain(DEL_CUERPO);
    });

    it('si el reintento responde bien, devuelve esa respuesta', async () => {
      serv.responderCon([{ tipo: '5xx', estado: 500 }, ok(pagina([viaje(1)], 1))]);

      expect((await listar()).items).toHaveLength(1);
      expect(serv.llamadas).toBe(2);
    });
  });

  // RF-2.4.10: un 200 que no tiene la forma esperada es falta de disponibilidad. No se reintenta: M6 respondió.
  describe('un 200 que no tiene la forma esperada: 503 con Retry-After (RF-2.4.10)', () => {
    it.each([
      ['un arreglo de viajes, sin paginar', [viaje(1)]],
      ['nulo', null],
      ['un texto', 'viajes'],
      ['sin items', { page: 1, pageSize: 20, total: 0 }],
      ['items que no es una lista', pagina({ 0: viaje(1) } as unknown as unknown[], 1)],
      ['sin total', { items: [], page: 1, pageSize: 20 }],
      ['un total negativo', pagina([], -1)],
      ['un total con decimales', pagina([], 1.5)],
      ['un total en texto', pagina([], '3' as unknown as number)],
      ['un total nulo', pagina([], null as unknown as number)],
      ['un total que no es un entero seguro', pagina([], 2 ** 53)],
      ['un viaje que no es un objeto', pagina([viaje(1), 'viaje'], 2)],
      ['un viaje nulo', pagina([null], 1)],
      ['un viaje sin id', pagina([viaje(1, { id: undefined })], 1)],
      ['un viaje con id numérico', pagina([viaje(1, { id: 7 })], 1)],
      ['un viaje sin state', pagina([viaje(1, { state: undefined })], 1)],
      ['un viaje con state numérico', pagina([viaje(1, { state: 3 })], 1)],
      ['un viaje con driverId numérico', pagina([viaje(1, { driverId: 5 })], 1)],
      ['un viaje con clientId numérico', pagina([viaje(1, { clientId: 5 })], 1)],
      ['un viaje con un id que no es un UUID', pagina([viaje(1, { id: 'viaje-1' })], 1)],
      ['un viaje con un driverId que no es un UUID', pagina([viaje(1, { driverId: 'conductor-7' })], 1)],
    ])('%s', async (_caso, cuerpo) => {
      serv.responderCon(ok(cuerpo));

      const error = await fallaDe(listar(0, 20, { reintentarDespuesS: 5 }));

      expect(error).toBeInstanceOf(ModuloNoDisponible);
      expect(aProblema(error).encabezados['Retry-After']).toBe('5');
      expect(serv.llamadas).toBe(1);
    });

    it('más viajes que el size pedido', async () => {
      serv.responderCon(ok(pagina([viaje(1), viaje(2), viaje(3)], 3)));

      const error = await fallaDe(listar(0, 2));

      expect(error).toBeInstanceOf(ModuloNoDisponible);
      expect(aProblema(error).encabezados['Retry-After']).toBe('5');
    });

    it('la causa dice qué falló, sin nada del cuerpo de M6', async () => {
      serv.responderCon(ok(pagina([{ ...viaje(1), state: 9, nota: DEL_CUERPO }], 1)));

      const error = (await fallaDe(listar())) as Error;

      expect(error.cause).toBeInstanceOf(Error);
      expect((error.cause as Error).message).toBe('M6 respondió 200 con un cuerpo que no tiene la forma esperada');
      expect(inspect(error, { depth: 10 })).not.toContain(DEL_CUERPO);
      expect(inspect(error, { depth: 10 })).not.toContain(CONDUCTOR);
    });
  });

  // RF-2.4.7: un 4xx es un problema de configuración o de acuerdo entre módulos, no del cliente de M2: 500, sin reintento.
  describe('M6 rechaza el pedido: error de integración (RF-2.4.7)', () => {
    it.each([400, 401, 403, 404, 409, 422])('un %i no se reintenta y da 500 sin datos de M6', async (estado) => {
      serv.responderCon({ tipo: '4xx', estado, cuerpo: { type: 'about:blank', status: estado, detail: DEL_CUERPO } });

      const error = await fallaDe(listar());

      expect(error).toBeInstanceOf(ErrorDeIntegracion);
      expect(serv.llamadas).toBe(1);
      const respuesta = aProblema(error, '/api/v1/clientes/x/viajes');
      expect(respuesta.codigo).toBe(500);
      expect(respuesta.cuerpo).toEqual({
        type: 'about:blank',
        title: 'Error interno',
        status: 500,
        detail: 'Ocurrió un error interno',
        instance: '/api/v1/clientes/x/viajes',
      });
      expect(respuesta.encabezados).toEqual({ 'Content-Type': 'application/problem+json' });
      // La causa va al log (RF-2.4.7, RNF-14): el código de M6, nunca su cuerpo (RNF-19).
      expect((error as Error).cause).toMatchObject({ message: `M6 respondió ${estado}` });
      expect(inspect(error, { depth: 10 })).not.toContain(DEL_CUERPO);
    });

    it('un 4xx que no es JSON también', async () => {
      serv.responderCon({ tipo: 'no-json', estado: 401, contenido: DEL_CUERPO });

      const error = await fallaDe(listar());

      expect(error).toBeInstanceOf(ErrorDeIntegracion);
      expect(inspect(error, { depth: 10 })).not.toContain(DEL_CUERPO);
    });
  });
});

describe('crearM6: el viaje a calificar, GET /trips/{id} (008/T4)', () => {
  const serv = crearServidorModulo();
  beforeAll(() => serv.levantar());
  afterAll(() => serv.cerrar());

  const VIAJE = '5c4b3a29-1807-4f6e-9d5c-4b3a29180765';
  const OTRO_CLIENTE = '9e8d7c6b-5a49-4382-a170-6f5e4d3c2b1a';

  // El viaje según el contrato publicado de M6 (`Trip`, Grupo 12), con los campos que M2 no lee.
  const detalle = (extra: object = {}) => ({
    id: VIAJE,
    requestId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    clientId: CLIENTE,
    driverId: CONDUCTOR,
    vehicleId: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
    originLatitude: -27.45,
    originLongitude: -58.98,
    destinationLatitude: -27.47,
    destinationLongitude: -58.83,
    state: 'COMPLETED',
    distanceKm: 3.2,
    durationMinutes: 12,
    ...extra,
  });

  const m6 = (extra: Partial<typeof CONFIG> = {}) =>
    crearM6({ ...CONFIG, urlM6: serv.url, tiempoModulosMs: TIEMPO_MS, reintentosModulos: 1, ...extra });
  const obtener = (clienteId = CLIENTE, extra: Partial<typeof CONFIG> = {}) =>
    m6(extra).obtenerViaje(VIAJE, clienteId, 'id-de-correlacion');
  const fallaDe = (promesa: Promise<unknown>) => promesa.catch((motivo: unknown) => motivo);

  describe('el pedido (RF-2.5, RNF-14)', () => {
    it('pide GET /trips/{id} con el id del viaje y el id de correlación', async () => {
      serv.responderCon(ok(detalle()));

      await obtener();

      const url = new URL(serv.rutaRecibida, serv.url);
      expect(url.pathname).toBe(`/trips/${VIAJE}`);
      expect(url.search).toBe('');
      expect(serv.encabezadosRecibidos.get('x-request-id')).toBe('id-de-correlacion');
    });

    it('suma /trips/{id} a la URL base de M6, que puede traer un camino', async () => {
      serv.responderCon(ok(detalle()));

      await m6({ urlM6: `${serv.url}/api/v1` }).obtenerViaje(VIAJE, CLIENTE, 'id');

      expect(new URL(serv.rutaRecibida, serv.url).pathname).toBe(`/api/v1/trips/${VIAJE}`);
    });
  });

  describe('el token de servicio (RF-2.5.13, RNF-19)', () => {
    const tokenDe = (autorizacion: string | undefined) => /^Bearer (\S+)$/.exec(autorizacion ?? '')?.[1] ?? '';
    const verificarComoM6 = (token: string, audiencia = CONFIG.audienciaM6) =>
      jwtVerify(token, new TextEncoder().encode(CONFIG.claveTokens), {
        algorithms: ['HS256'],
        issuer: CONFIG.emisorTokens,
        audience: audiencia,
        requiredClaims: ['exp'],
      });

    it('M6 recibe un token de servicio que verifica con la clave y la audiencia de M6, nunca otro', async () => {
      serv.responderCon(ok(detalle()));

      await obtener(CLIENTE, { audienciaM6: 'm6-de-prueba' });

      const { payload } = await verificarComoM6(tokenDe(serv.autorizaciones[0]), 'm6-de-prueba');
      expect(payload).toMatchObject({ sub: 'm2-clientes', roles: ['SERVICIO'], aud: 'm6-de-prueba' });
      expect(payload.exp! - payload.iat!).toBe(60);
    });

    it('el reintento lleva un token de servicio propio, que también verifica', async () => {
      serv.responderCon([{ tipo: '5xx', estado: 500 }, ok(detalle())]);

      await obtener();

      expect(serv.llamadas).toBe(2);
      for (const autorizacion of serv.autorizaciones) await verificarComoM6(tokenDe(autorizacion));
    });

    it.each([
      ['un 503 tras el reintento', { tipo: '5xx', estado: 500 }],
      ['un 500 por un 401 de M6', { tipo: '4xx', estado: 401 }],
      ['un 503 por un viaje con mala forma', ok(detalle({ state: 7 }))],
    ] as const)('no aparece en detail, en la causa ni en el error ante %s', async (_caso, falla) => {
      serv.responderCon(falla);

      const error = await fallaDe(obtener());
      const token = tokenDe(serv.autorizaciones[0]);

      expect(token).not.toBe('');
      expect(JSON.stringify(aProblema(error).cuerpo)).not.toContain(token);
      expect(inspect(error, { depth: 10 })).not.toContain(token);
    });
  });

  describe('un viaje completado del cliente (RF-2.5)', () => {
    it('devuelve el estado y el conductor que informa M6', async () => {
      serv.responderCon(ok(detalle()));

      expect(await obtener()).toEqual({ estado: 'COMPLETED', conductorId: CONDUCTOR });
      expect(serv.llamadas).toBe(1);
    });

    it('compara el dueño sin distinguir mayúsculas y devuelve el conductor en minúsculas: son UUID', async () => {
      serv.responderCon(ok(detalle({ clientId: CLIENTE.toUpperCase(), driverId: CONDUCTOR.toUpperCase() })));

      expect(await obtener()).toEqual({ estado: 'COMPLETED', conductorId: CONDUCTOR });
      expect(await obtener(CLIENTE.toUpperCase())).toEqual({ estado: 'COMPLETED', conductorId: CONDUCTOR });
    });

    it('si el reintento responde bien, devuelve esa respuesta', async () => {
      serv.responderCon([{ tipo: '5xx', estado: 503 }, ok(detalle())]);

      expect(await obtener()).toEqual({ estado: 'COMPLETED', conductorId: CONDUCTOR });
      expect(serv.llamadas).toBe(2);
    });
  });

  // RF-2.5.2: cualquier estado en texto distinto de COMPLETED, también uno que M2 no conoce. Sin conductor: no hace falta.
  describe('un viaje del cliente que no está completado (RF-2.5.2)', () => {
    it.each(['PENDING_ARRIVAL', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'CANCELLED_BY_CLIENT', 'CANCELLED_BY_DRIVER', 'ARCHIVED', 'completed', ''])(
      'el estado «%s» vuelve tal cual, sin conductor',
      async (state) => {
        serv.responderCon(ok(detalle({ state })));

        expect(await obtener()).toEqual({ estado: state });
      },
    );

    it.each([
      ['sin driverId', { driverId: undefined }],
      ['con driverId nulo', { driverId: null }],
      ['con un driverId que no es un UUID', { driverId: 'conductor-7' }],
    ])('un viaje en curso %s no es una mala forma: el conductor solo se exige al completar', async (_caso, extra) => {
      serv.responderCon(ok(detalle({ state: 'IN_PROGRESS', ...extra })));

      expect(await obtener()).toEqual({ estado: 'IN_PROGRESS' });
    });
  });

  // RF-2.5.1: un viaje inexistente y uno de otro cliente son lo mismo para quien llama. El dueño se mira antes que el estado y
  // que el conductor: un viaje ajeno nunca revela su estado.
  describe('un viaje que no existe o es de otro cliente (RF-2.5.1)', () => {
    it('un 404 de M6 da null, sin reintento', async () => {
      serv.responderCon({ tipo: '4xx', estado: 404, cuerpo: { code: 'NOT_FOUND', message: DEL_CUERPO } });

      expect(await obtener()).toBeNull();
      expect(serv.llamadas).toBe(1);
    });

    it.each([
      ['completado', detalle({ clientId: OTRO_CLIENTE })],
      ['en curso', detalle({ clientId: OTRO_CLIENTE, state: 'IN_PROGRESS' })],
      ['completado sin conductor', detalle({ clientId: OTRO_CLIENTE, driverId: undefined })],
      ['completado con un conductor que no es un UUID', detalle({ clientId: OTRO_CLIENTE, driverId: 'conductor-7' })],
      ['con un clientId que no es un UUID', detalle({ clientId: 'cliente-7' })],
      ['con un clientId vacío', detalle({ clientId: '' })],
    ])('un viaje de otro cliente, %s, da null', async (_caso, cuerpo) => {
      serv.responderCon(ok(cuerpo));

      expect(await obtener()).toBeNull();
    });
  });

  // RF-2.5.5 y RNF-13: tras un reintento, 503 que nombra a M6 y lleva Retry-After. La causa no trae el cuerpo (RNF-19).
  describe('M6 no está disponible: 503 con Retry-After (RF-2.5.5, RNF-13)', () => {
    it.each([
      ['un 5xx', { tipo: '5xx', estado: 502, cuerpo: { error: DEL_CUERPO } }],
      ['un cuerpo que no es JSON', { tipo: 'no-json', contenido: `<html>${DEL_CUERPO}</html>` }],
      ['un corte de la conexión', { tipo: 'corta' }],
      ['una demora mayor al tiempo', { tipo: 'demora-cuerpo', retardoMs: TIEMPO_MS * 4, cuerpo: detalle() }],
    ] as const)('%s: se reintenta una vez y da 503', async (_caso, falla) => {
      serv.responderCon(falla);

      const error = await fallaDe(obtener(CLIENTE, { reintentarDespuesS: 7 }));

      expect(error).toBeInstanceOf(ModuloNoDisponible);
      expect(serv.llamadas).toBe(2);
      const respuesta = aProblema(error);
      expect(respuesta.codigo).toBe(503);
      expect(respuesta.cuerpo.detail).toBe('M6 no está disponible');
      expect(respuesta.encabezados['Retry-After']).toBe('7');
      expect(inspect(error, { depth: 10 })).not.toContain(DEL_CUERPO);
    });
  });

  // RF-2.5.5: un 200 sin la forma que M2 necesita es falta de disponibilidad. No se reintenta: M6 respondió.
  describe('un 200 que no tiene la forma esperada: 503 con Retry-After (RF-2.5.5)', () => {
    it.each([
      ['nulo', null],
      ['un texto', 'viaje'],
      ['una lista', [detalle()]],
      ['sin state', detalle({ state: undefined })],
      ['con state nulo', detalle({ state: null })],
      ['con state numérico', detalle({ state: 3 })],
      ['sin clientId', detalle({ clientId: undefined })],
      ['con clientId nulo', detalle({ clientId: null })],
      ['con clientId numérico', detalle({ clientId: 5 })],
      ['completado sin driverId', detalle({ driverId: undefined })],
      ['completado con driverId nulo', detalle({ driverId: null })],
      ['completado con driverId vacío', detalle({ driverId: '' })],
      ['completado con driverId numérico', detalle({ driverId: 5 })],
      ['completado con un driverId que no es un UUID', detalle({ driverId: 'conductor-7' })],
    ])('%s', async (_caso, cuerpo) => {
      serv.responderCon(ok(cuerpo));

      const error = await fallaDe(obtener(CLIENTE, { reintentarDespuesS: 5 }));

      expect(error).toBeInstanceOf(ModuloNoDisponible);
      expect(aProblema(error).encabezados['Retry-After']).toBe('5');
      expect(serv.llamadas).toBe(1);
    });

    it('la causa dice qué falló, sin nada del cuerpo de M6', async () => {
      serv.responderCon(ok(detalle({ driverId: `no-uuid-${DEL_CUERPO}` })));

      const error = (await fallaDe(obtener())) as Error;

      expect(error.cause).toBeInstanceOf(Error);
      expect((error.cause as Error).message).toBe('M6 respondió 200 con un cuerpo que no tiene la forma esperada');
      expect(inspect(error, { depth: 10 })).not.toContain(DEL_CUERPO);
      expect(inspect(error, { depth: 10 })).not.toContain(VIAJE);
      expect(inspect(error, { depth: 10 })).not.toContain(CLIENTE);
    });
  });

  // RF-2.5.6: un 4xx distinto de 404 es un problema de configuración o de acuerdo entre módulos: 500, sin reintento.
  describe('M6 rechaza el pedido: error de integración (RF-2.5.6)', () => {
    it.each([400, 401, 403, 409, 422, 429])('un %i no se reintenta y da 500 sin datos de M6', async (estado) => {
      serv.responderCon({ tipo: '4xx', estado, cuerpo: { code: 'X', message: DEL_CUERPO } });

      const error = await fallaDe(obtener());

      expect(error).toBeInstanceOf(ErrorDeIntegracion);
      expect(serv.llamadas).toBe(1);
      const respuesta = aProblema(error, '/api/v1/clientes/x/calificaciones');
      expect(respuesta.codigo).toBe(500);
      expect(respuesta.cuerpo.detail).toBe('Ocurrió un error interno');
      expect((error as Error).cause).toMatchObject({ message: `M6 respondió ${estado}` });
      expect(inspect(error, { depth: 10 })).not.toContain(DEL_CUERPO);
    });
  });
});
