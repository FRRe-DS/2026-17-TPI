import type { FastifyBaseLogger } from 'fastify';
import { jwtVerify } from 'jose';
import { inspect } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aProblema, ErrorDeIntegracion, ModuloNoDisponible } from '../../src/errores.js';
import { crearM6 } from '../../src/historial/m6.js';
import { CONFIG } from '../ayudas/app.js';
import { errorDeM6, paginaDeM6, resumenDeM6, viajeDeM6 } from '../ayudas/m6-simulado.js';
import { crearServidorModulo, type Comportamiento } from '../ayudas/servidor-modulo.js';

const TIEMPO_MS = 200;
const CLIENTE = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const CONDUCTOR = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
// Un dato que M6 podría mandar en un cuerpo y que no puede llegar al log ni a la respuesta (RNF-19).
const DEL_CUERPO = 'dato-del-cuerpo-de-m6';

const viaje = (n: number, extra: object = {}) => resumenDeM6(n, CLIENTE, CONDUCTOR, extra);
const pagina = paginaDeM6;

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

      await m6({ urlM6: `${serv.url}/pasarela/m6` }).listarViajes(CLIENTE, 0, 20, 'id');

      expect(new URL(serv.rutaRecibida, serv.url).pathname).toBe('/pasarela/m6/trips');
    });
  });

  // El contrato de M6 declara `X-Correlation-Id`, de 100 caracteres como máximo: M2 lo manda además del encabezado configurado
  // (`X-Request-Id` en estas pruebas) y con el mismo valor.
  describe('la correlación hacia M6 (RNF-14.11, RNF-14.12; 007/T13)', () => {
    const ID = 'id-de-correlacion';
    const listarCon = (idCorrelacion: string, extra: Partial<typeof CONFIG> = {}) =>
      m6(extra).listarViajes(CLIENTE, 0, 20, idCorrelacion);

    it('cada intento, también el reintento, lleva X-Correlation-Id y el encabezado configurado con el mismo identificador', async () => {
      serv.responderCon([{ tipo: '5xx', estado: 502 }, ok(pagina([], 0))]);

      await listarCon(ID);

      expect(serv.llamadas).toBe(2);
      for (const intento of [0, 1]) {
        expect(serv.valoresDe(intento, 'x-correlation-id')).toEqual([ID]);
        expect(serv.valoresDe(intento, 'x-request-id')).toEqual([ID]);
      }
    });

    it('un identificador de 100 caracteres exactos va en los dos encabezados', async () => {
      serv.responderCon(ok(pagina([], 0)));
      const justo = 'a'.repeat(100);

      await listarCon(justo);

      expect(serv.valoresDe(0, 'x-correlation-id')).toEqual([justo]);
      expect(serv.valoresDe(0, 'x-request-id')).toEqual([justo]);
    });

    it('un identificador de 101 caracteres va solo en el encabezado configurado, en cada intento', async () => {
      serv.responderCon([{ tipo: '5xx', estado: 502 }, ok(pagina([], 0))]);
      const largo = 'a'.repeat(101);

      await listarCon(largo);

      expect(serv.llamadas).toBe(2);
      for (const intento of [0, 1]) {
        expect(serv.valoresDe(intento, 'x-correlation-id')).toEqual([]);
        expect(serv.valoresDe(intento, 'x-request-id')).toEqual([largo]);
      }
    });

    // `fetch` uniría dos claves que solo difieren en mayúsculas en un solo encabezado con el valor repetido.
    describe.each(['x-correlation-id', 'X-Correlation-Id', 'X-CORRELATION-ID'])('si el encabezado configurado es %s', (configurado) => {
      it('sale una sola vez', async () => {
        serv.responderCon([{ tipo: '5xx', estado: 502 }, ok(pagina([], 0))]);

        await listarCon(ID, { encabezadoCorrelacion: configurado });

        expect(serv.llamadas).toBe(2);
        for (const intento of [0, 1]) {
          expect(serv.valoresDe(intento, 'x-correlation-id')).toEqual([ID]);
          expect(serv.valoresDe(intento, 'x-request-id')).toEqual([]);
        }
      });

      it('con 100 caracteres sale y con 101 no sale ninguno: la llamada va sin correlación', async () => {
        serv.responderCon(ok(pagina([], 0)));

        await listarCon('a'.repeat(100), { encabezadoCorrelacion: configurado });
        expect(serv.valoresDe(0, 'x-correlation-id')).toEqual(['a'.repeat(100)]);

        serv.responderCon(ok(pagina([], 0)));
        await listarCon('a'.repeat(101), { encabezadoCorrelacion: configurado });
        expect(serv.llamadas).toBe(1);
        expect(serv.valoresDe(0, 'x-correlation-id')).toEqual([]);
        expect(serv.valoresDe(0, 'x-request-id')).toEqual([]);
      });
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
      // El segundo viaje no trae `driverId`: está fuera del contrato de M6, que lo exige, y M2 lo acepta igual.
      const items = [viaje(1), viaje(2, { driverId: undefined, state: 'CANCELLED' })];
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

    it('un driverId nulo está fuera del contrato de M6, pero es un viaje sin conductor y no una respuesta inválida', async () => {
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
      serv.responderCon({ tipo: '4xx', estado, cuerpo: errorDeM6(estado, DEL_CUERPO) });

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

    // El Retry-After solo cuenta en un 429: en otro 4xx no cambia nada (007/T15).
    it.each([400, 401, 403, 404])('un %i sigue dando error de integración aunque traiga Retry-After', async (estado) => {
      serv.responderCon({ tipo: '4xx', estado, cuerpo: errorDeM6(estado, DEL_CUERPO), encabezados: { 'Retry-After': '30' } });

      const error = await fallaDe(listar());

      expect(error).toBeInstanceOf(ErrorDeIntegracion);
      expect(serv.llamadas).toBe(1);
      expect(aProblema(error).encabezados).toEqual({ 'Content-Type': 'application/problem+json' });
    });
  });

  // RF-2.4.15: el 429 es el límite de pedidos de M6, no un rechazo. M2 responde 503 con el Retry-After de M6 si vale (solo
  // dígitos, de 1 a 3600) y si no, con el configurado, y no reintenta: otro pedido caería en la misma ventana del límite.
  describe('M6 limita los pedidos: el 429 da 503 con Retry-After (RF-2.4.15; 007/T15)', () => {
    const limite = (reintentarDespues?: string | string[]): Comportamiento => ({
      tipo: '4xx',
      estado: 429,
      cuerpo: errorDeM6(429, DEL_CUERPO),
      ...(reintentarDespues === undefined ? {} : { encabezados: { 'Retry-After': reintentarDespues } }),
    });

    it('con el Retry-After de M6: 503 que nombra a M6, con ese valor y un solo pedido', async () => {
      serv.responderCon(limite('30'));

      const error = await fallaDe(listar(0, 20, { reintentarDespuesS: 7 }));

      expect(error).toBeInstanceOf(ModuloNoDisponible);
      expect(serv.llamadas).toBe(1);
      const respuesta = aProblema(error, '/api/v1/clientes/x/viajes');
      expect(respuesta.codigo).toBe(503);
      expect(respuesta.cuerpo.detail).toBe('M6 no está disponible');
      expect(respuesta.encabezados).toEqual({ 'Content-Type': 'application/problem+json', 'Retry-After': '30' });
      // La causa va al log (RNF-14.8): el código de M6, nunca su cuerpo (RNF-19).
      expect((error as Error).cause).toMatchObject({ message: 'M6 respondió 429' });
      expect(inspect(error, { depth: 10 })).not.toContain(DEL_CUERPO);
    });

    it.each([
      ['el mínimo', '1', '1'],
      ['el máximo', '3600', '3600'],
      ['ceros a la izquierda', '030', '30'],
    ])('vale %s (%s): Retry-After %s', async (_caso, deM6, esperado) => {
      serv.responderCon(limite(deM6));

      const error = await fallaDe(listar(0, 20, { reintentarDespuesS: 7 }));

      expect(error).toBeInstanceOf(ModuloNoDisponible);
      expect(aProblema(error).encabezados['Retry-After']).toBe(esperado);
      expect(serv.llamadas).toBe(1);
    });

    it.each([
      ['falta', undefined],
      ['es 0', '0'],
      ['pasa de 3600', '3601'],
      ['es un número enorme', '99999999999999999999'],
      ['trae una unidad', '30s'],
      ['trae decimales', '1.5'],
      ['es una fecha HTTP', 'Wed, 11 Nov 2026 20:00:00 GMT'],
      ['viene repetido', ['30', '30']],
    ])('si el Retry-After de M6 %s: 503 con el valor configurado y un solo pedido', async (_caso, deM6) => {
      serv.responderCon(limite(deM6));

      const error = await fallaDe(listar(0, 20, { reintentarDespuesS: 7 }));

      expect(error).toBeInstanceOf(ModuloNoDisponible);
      expect(aProblema(error).encabezados['Retry-After']).toBe('7');
      expect(serv.llamadas).toBe(1);
    });

    it('también si el 429 no responde con JSON', async () => {
      serv.responderCon({ tipo: 'no-json', estado: 429, contenido: DEL_CUERPO, encabezados: { 'Retry-After': '12' } });

      const error = await fallaDe(listar(0, 20, { reintentarDespuesS: 7 }));

      expect(error).toBeInstanceOf(ModuloNoDisponible);
      expect(aProblema(error).encabezados['Retry-After']).toBe('12');
      expect(inspect(error, { depth: 10 })).not.toContain(DEL_CUERPO);
    });

    // El reintento es por el corte, no por el 429: con el 429 del segundo intento la llamada termina. Con dos reintentos
    // permitidos, un 429 que se reintentara haría un tercer pedido, que respondería bien.
    it('un intento cortado seguido de un 429 da lo mismo, con dos pedidos y sin un tercero', async () => {
      serv.responderCon([{ tipo: 'corta' }, limite('30'), ok(pagina([], 0))]);
      const lineas: { nivel: string; campos: Record<string, unknown> }[] = [];
      const anotar = (nivel: string) => (campos: Record<string, unknown>) => void lineas.push({ nivel, campos });
      const log = { info: anotar('info'), warn: anotar('warn') } as unknown as FastifyBaseLogger;
      const conLog = crearM6({ ...CONFIG, urlM6: serv.url, tiempoModulosMs: TIEMPO_MS, reintentosModulos: 2, reintentarDespuesS: 7 }, log);

      const error = await fallaDe(conLog.listarViajes(CLIENTE, 0, 20, 'id-de-correlacion'));

      expect(error).toBeInstanceOf(ModuloNoDisponible);
      expect(aProblema(error).encabezados['Retry-After']).toBe('30');
      expect(serv.llamadas).toBe(2);
      // Un 429 es una respuesta de M6: la línea va como `info`, con su código (RNF-14.10).
      expect(lineas).toEqual([{ nivel: 'info', campos: expect.objectContaining({ modulo: 'M6', estado: 429, intentos: 2 }) }]);
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
  const detalle = (extra: object = {}) => viajeDeM6(VIAJE, CLIENTE, CONDUCTOR, extra);

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
      serv.responderCon({ tipo: '4xx', estado: 404, cuerpo: errorDeM6(404, DEL_CUERPO) });

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
      serv.responderCon({ tipo: '4xx', estado, cuerpo: errorDeM6(estado, DEL_CUERPO) });

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
