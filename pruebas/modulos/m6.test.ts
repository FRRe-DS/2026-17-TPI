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
