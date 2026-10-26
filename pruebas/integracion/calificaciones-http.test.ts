import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrar } from '../../src/bd/migraciones.js';
import { crearPool, type BaseDeDatos, type PoolBd } from '../../src/bd/pool.js';
import { calificarConductor, listarCalificaciones, obtenerCalificacion } from '../../src/calificaciones/operaciones.js';
import { cargarContrato } from '../../src/contrato/cargar.js';
import { BaseNoDisponible } from '../../src/errores.js';
import { crearApp, POOL_FALSO } from '../ayudas/app.js';
import { type BaseDePrueba, crearBaseDePrueba } from '../ayudas/bd.js';
import { capturarLogs } from '../ayudas/logs.js';
import { errorDeM6, viajeDeM6 as viajeDe } from '../ayudas/m6-simulado.js';
import { type Comportamiento, crearServidorModulo } from '../ayudas/servidor-modulo.js';
import { armarToken } from '../ayudas/tokens.js';

// Las tres operaciones de calificaciones por HTTP, con PostgreSQL real y M6 simulado (RF-2.5 a RF-2.5.14, RNF-03, RNF-14,
// RNF-19). La orquestación fina (orden de las comprobaciones, concurrencia) la cubre `calificaciones.test.ts`; acá se mira la
// capa HTTP: el contrato, los permisos, la validación, los códigos y los logs.

const contrato = cargarContrato();
const CONDUCTOR = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
type Rol = 'CLIENTE' | 'OPERADOR' | 'SERVICIO' | 'CONDUCTOR';

const coleccion = (clienteId: string, consulta = '') => `/api/v1/clientes/${clienteId}/calificaciones${consulta}`;
const PROBLEMA = /^application\/problem\+json/;

describe('calificaciones por HTTP (008/T8)', () => {
  let base: BaseDePrueba;
  let pool: PoolBd;
  const serv = crearServidorModulo();

  beforeAll(async () => {
    base = await crearBaseDePrueba();
    await migrar({ urlBd: base.urlBd, tiempoBdMs: 2000 });
    pool = crearPool({ urlBd: base.urlBd, tiempoBdMs: 2000 });
    await serv.levantar();
  });
  afterAll(async () => {
    await pool?.end();
    await base?.borrar();
    await serv.cerrar();
  });
  beforeEach(() => serv.responderCon({ tipo: 'ok' }));

  const cliente = async () => {
    const clienteId = randomUUID();
    await pool.consultar(
      `INSERT INTO clientes (cliente_id, nombre, apellido, telefono) VALUES ($1, 'Ana', 'Gómez', '+5493624000000')`,
      [clienteId],
    );
    return clienteId;
  };

  // El viaje como lo responde M6 (`Trip`): completado, del cliente y con conductor, salvo lo que cambie la prueba.
  const viajeDeM6 = (viajeId: string, clientId: string, extra: object = {}): Comportamiento => ({
    tipo: 'ok',
    cuerpo: viajeDe(viajeId, clientId, CONDUCTOR, extra),
  });

  // La app y los pedidos. Los tokens quedan a mano para buscarlos enteros en los logs (RNF-19). La URL de M6 se conoce recién
  // cuando levanta el simulado.
  function crear(config: { reintentarDespuesS?: number } = {}, bd: BaseDeDatos = pool) {
    const logs = capturarLogs();
    const app = crearApp(
      { listarCalificaciones, calificarConductor, obtenerCalificacion },
      { contrato, pool: bd, flujoLog: logs.flujo, config: { urlM6: serv.url, tiempoModulosMs: 300, reintentosModulos: 1, ...config } },
    );
    const tokens: string[] = [];
    const autorizacion = (sub: string, roles: Rol[]) => {
      const token = armarToken({ claims: { sub, roles } });
      tokens.push(token);
      return `Bearer ${token}`;
    };
    return {
      app,
      logs,
      tokens,
      alta: (clienteId: string, payload: unknown, clave: string | null = randomUUID(), roles: Rol[] = ['CLIENTE'], sub = clienteId) =>
        app.inject({
          method: 'POST',
          url: coleccion(clienteId),
          headers: { authorization: autorizacion(sub, roles), ...(clave === null ? {} : { 'idempotency-key': clave }) },
          payload: payload as object,
        }),
      lectura: (url: string, sub: string, roles: Rol[] = ['CLIENTE']) =>
        app.inject({ method: 'GET', url, headers: { authorization: autorizacion(sub, roles) } }),
    };
  }

  // Una calificación ya hecha por la operación, para las lecturas.
  async function calificada(clienteId: string, extra: object = {}) {
    const viajeId = randomUUID();
    serv.responderCon(viajeDeM6(viajeId, clienteId));
    const respuesta = await crear().alta(clienteId, { viajeId, puntaje: 4, ...extra });
    expect(respuesta.statusCode).toBe(201);
    return respuesta.json() as { calificacionId: string; viajeId: string };
  }

  describe('calificarConductor, 201 (RF-2.5)', () => {
    it('201 con la calificación del contrato, el conductor de M6, X-Request-Id y Location a ella', async () => {
      const clienteId = await cliente();
      const viajeId = randomUUID();
      serv.responderCon(viajeDeM6(viajeId, clienteId));
      const { alta, lectura } = crear();

      const respuesta = await alta(clienteId, { viajeId, puntaje: 5, comentario: 'Muy amable' });

      expect(respuesta.statusCode).toBe(201);
      expect(respuesta.headers['content-type']).toMatch(/^application\/json/);
      expect(respuesta.headers['x-request-id']).toBeTypeOf('string');
      expect(respuesta.json()).toEqual({
        calificacionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        viajeId,
        conductorId: CONDUCTOR,
        puntaje: 5,
        comentario: 'Muy amable',
        creadoEn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
      expect(respuesta.headers.location).toBe(coleccion(clienteId, `/${respuesta.json().calificacionId}`));
      const leida = await lectura(respuesta.headers.location as string, clienteId);
      expect([leida.statusCode, leida.json()]).toEqual([200, respuesta.json()]);
    });

    it('sin comentario, el campo no está en la respuesta', async () => {
      const clienteId = await cliente();
      const viajeId = randomUUID();
      serv.responderCon(viajeDeM6(viajeId, clienteId));

      const respuesta = await crear().alta(clienteId, { viajeId, puntaje: 1 });

      expect(respuesta.statusCode).toBe(201);
      expect(respuesta.json()).not.toHaveProperty('comentario');
    });

    it('la repetición con la misma clave y cuerpo da el mismo 201 y el mismo Location, sin llamar a M6 (RF-2.5.4)', async () => {
      const clienteId = await cliente();
      const viajeId = randomUUID();
      serv.responderCon(viajeDeM6(viajeId, clienteId));
      const { alta } = crear();
      const primera = await alta(clienteId, { viajeId, puntaje: 3 }, 'clave-repetida');
      serv.responderCon({ tipo: '5xx', estado: 500 });

      const segunda = await alta(clienteId, { puntaje: 3, viajeId }, 'clave-repetida');

      expect([segunda.statusCode, segunda.headers.location, segunda.json()]).toEqual([201, primera.headers.location, primera.json()]);
      expect(serv.llamadas).toBe(0);
    });
  });

  describe('listarCalificaciones y obtenerCalificacion, 200 (RF-2.5.8, RF-2.5.10)', () => {
    it('la página con los valores por defecto de page y size, de la más nueva a la más antigua', async () => {
      const clienteId = await cliente();
      const primera = await calificada(clienteId);
      const segunda = await calificada(clienteId);

      const respuesta = await crear().lectura(coleccion(clienteId), clienteId);

      expect(respuesta.statusCode).toBe(200);
      expect(respuesta.headers['content-type']).toMatch(/^application\/json/);
      expect(respuesta.headers['x-request-id']).toBeTypeOf('string');
      expect(respuesta.json()).toMatchObject({ page: 0, size: 20, totalElementos: 2, totalPaginas: 1 });
      expect(respuesta.json().items.map((item: { calificacionId: string }) => item.calificacionId)).toEqual([
        segunda.calificacionId,
        primera.calificacionId,
      ]);
    });

    it('page y size de la URL; una página fuera del total, vacía; un cliente sin calificaciones, vacío (RF-2.5.9)', async () => {
      const [conDos, sinNinguna] = [await cliente(), await cliente()];
      await calificada(conDos);
      await calificada(conDos);
      const { lectura } = crear();

      const segunda = await lectura(coleccion(conDos, '?page=1&size=1'), conDos);
      const fuera = await lectura(coleccion(conDos, '?page=5&size=1'), conDos);
      const vacia = await lectura(coleccion(sinNinguna), sinNinguna);

      expect(segunda.json()).toMatchObject({ page: 1, size: 1, totalElementos: 2, totalPaginas: 2 });
      expect(segunda.json().items).toHaveLength(1);
      expect(fuera.json()).toMatchObject({ page: 5, totalElementos: 2, items: [] });
      expect([vacia.statusCode, vacia.json()]).toEqual([200, { page: 0, size: 20, totalElementos: 0, totalPaginas: 0, items: [] }]);
    });

    it.each([[['OPERADOR']], [['CLIENTE', 'OPERADOR']]] as Rol[][][])('%j lee las calificaciones de otro cliente', async (roles) => {
      const clienteId = await cliente();
      const { calificacionId } = await calificada(clienteId);
      const { lectura } = crear();

      const lista = await lectura(coleccion(clienteId), randomUUID(), roles);
      const una = await lectura(coleccion(clienteId, `/${calificacionId}`), randomUUID(), roles);

      expect([lista.statusCode, lista.json().items]).toEqual([200, [expect.objectContaining({ calificacionId })]]);
      expect([una.statusCode, una.json().calificacionId]).toEqual([200, calificacionId]);
    });
  });

  describe('400 sale antes de la base y de M6 (RF-2.5.7, RNF-03)', () => {
    const VIAJE = randomUUID();
    it.each([
      ['puntaje 0', { viajeId: VIAJE, puntaje: 0 }],
      ['puntaje 6', { viajeId: VIAJE, puntaje: 6 }],
      ['puntaje 4.5', { viajeId: VIAJE, puntaje: 4.5 }],
      ['puntaje "5" como texto', { viajeId: VIAJE, puntaje: '5' }],
      ['puntaje null', { viajeId: VIAJE, puntaje: null }],
      ['sin puntaje', { viajeId: VIAJE }],
      ['sin viajeId', { puntaje: 5 }],
      ['un viajeId que no es UUID', { viajeId: 'no-es-un-uuid', puntaje: 5 }],
      ['un comentario de 501 caracteres', { viajeId: VIAJE, puntaje: 5, comentario: 'x'.repeat(501) }],
      ['un comentario que no es texto', { viajeId: VIAJE, puntaje: 5, comentario: 7 }],
      ['un campo de más', { viajeId: VIAJE, puntaje: 5, conductorId: CONDUCTOR }],
      ['un cuerpo vacío', {}],
      ['un cuerpo que no es un objeto', [1, 2]],
    ])('400 con %s', async (_caso, payload) => {
      const clienteId = await cliente();

      const respuesta = await crear().alta(clienteId, payload);

      expect(respuesta.statusCode).toBe(400);
      expect(respuesta.headers['content-type']).toMatch(PROBLEMA);
      expect(serv.llamadas).toBe(0);
    });

    it.each([
      ['sin Idempotency-Key', null],
      ['con una Idempotency-Key vacía', ''],
      ['con una Idempotency-Key de 256 caracteres', 'k'.repeat(256)],
    ])('400 %s', async (_caso, clave) => {
      const clienteId = await cliente();

      const respuesta = await crear().alta(clienteId, { viajeId: VIAJE, puntaje: 5 }, clave);

      expect(respuesta.statusCode).toBe(400);
      expect(respuesta.headers['content-type']).toMatch(PROBLEMA);
      expect(serv.llamadas).toBe(0);
    });

    it('400 con un clienteId que no es UUID, en el alta y en las dos lecturas', async () => {
      const { alta, lectura } = crear();

      const respuestas = await Promise.all([
        alta('no-es-un-uuid', { viajeId: VIAJE, puntaje: 5 }),
        lectura(coleccion('no-es-un-uuid'), 'no-es-un-uuid'),
        lectura(coleccion('no-es-un-uuid', `/${randomUUID()}`), 'no-es-un-uuid'),
      ]);

      expect(respuestas.map(({ statusCode }) => statusCode)).toEqual([400, 400, 400]);
    });

    it('400 con un calificacionId que no es UUID', async () => {
      const clienteId = await cliente();

      const respuesta = await crear().lectura(coleccion(clienteId, '/no-es-un-uuid'), clienteId);

      expect(respuesta.statusCode).toBe(400);
      expect(respuesta.headers['content-type']).toMatch(PROBLEMA);
    });

    it.each(['?page=-1', '?page=abc', '?size=0', '?size=101', '?size=1.5'])('400 con %s en el listado', async (consulta) => {
      const clienteId = await cliente();

      const respuesta = await crear().lectura(coleccion(clienteId, consulta), clienteId);

      expect(respuesta.statusCode).toBe(400);
      expect(respuesta.headers['content-type']).toMatch(PROBLEMA);
    });
  });

  describe('401 y 403 salen antes de la base y de M6 (RF-2.5.12)', () => {
    it.each([
      ['sin token', {}],
      ['con un token mal firmado', { authorization: `Bearer ${armarToken({ clave: 'otra-clave-de-32-caracteres-xxxxx!' })}` }],
    ])('401 %s, en las tres operaciones', async (_caso, headers) => {
      const clienteId = await cliente();
      const { app } = crear({}, POOL_FALSO);

      const respuestas = await Promise.all([
        app.inject({ method: 'POST', url: coleccion(clienteId), headers: { ...headers, 'idempotency-key': 'k' }, payload: { viajeId: randomUUID(), puntaje: 5 } }),
        app.inject({ method: 'GET', url: coleccion(clienteId), headers }),
        app.inject({ method: 'GET', url: coleccion(clienteId, `/${randomUUID()}`), headers }),
      ]);

      for (const respuesta of respuestas) {
        expect(respuesta.statusCode).toBe(401);
        expect(respuesta.headers['www-authenticate']).toBe('Bearer');
      }
      expect(serv.llamadas).toBe(0);
    });

    it('403 si un CLIENTE califica, lista o consulta las de otro, sin tocar la base ni M6', async () => {
      const otro = randomUUID();
      const { alta, lectura } = crear({}, POOL_FALSO);

      const respuestas = await Promise.all([
        alta(otro, { viajeId: randomUUID(), puntaje: 5 }, 'k', ['CLIENTE'], randomUUID()),
        lectura(coleccion(otro), randomUUID()),
        lectura(coleccion(otro, `/${randomUUID()}`), randomUUID()),
      ]);

      for (const respuesta of respuestas) {
        expect(respuesta.statusCode).toBe(403);
        expect(respuesta.headers['content-type']).toMatch(PROBLEMA);
      }
      expect(serv.llamadas).toBe(0);
    });

    it.each([['OPERADOR'], ['SERVICIO'], ['CONDUCTOR']] as Rol[][])('403 si %s califica, que solo admite CLIENTE', async (rol) => {
      const clienteId = await cliente();

      const respuesta = await crear({}, POOL_FALSO).alta(clienteId, { viajeId: randomUUID(), puntaje: 5 }, 'k', [rol]);

      expect(respuesta.statusCode).toBe(403);
      expect(serv.llamadas).toBe(0);
    });

    it.each([['SERVICIO'], ['CONDUCTOR']] as Rol[][])('403 si %s lee, que solo admiten CLIENTE y OPERADOR', async (rol) => {
      const clienteId = await cliente();
      const { lectura } = crear({}, POOL_FALSO);

      const respuestas = await Promise.all([
        lectura(coleccion(clienteId), clienteId, [rol]),
        lectura(coleccion(clienteId, `/${randomUUID()}`), clienteId, [rol]),
      ]);

      expect(respuestas.map(({ statusCode }) => statusCode)).toEqual([403, 403]);
    });
  });

  describe('404, 409 y 422 con su type (RF-2.5.1 a RF-2.5.3, RF-2.5.10, RF-2.5.11)', () => {
    it('404 si el perfil no existe, en las tres operaciones y sin llamar a M6', async () => {
      const clienteId = randomUUID();
      const { alta, lectura } = crear();

      const respuestas = await Promise.all([
        alta(clienteId, { viajeId: randomUUID(), puntaje: 5 }),
        lectura(coleccion(clienteId), clienteId),
        lectura(coleccion(clienteId, `/${randomUUID()}`), clienteId),
      ]);

      for (const respuesta of respuestas) {
        expect(respuesta.statusCode).toBe(404);
        expect(respuesta.headers['content-type']).toMatch(PROBLEMA);
      }
      expect(serv.llamadas).toBe(0);
    });

    it('404 si la calificación no existe o es de otro cliente, con la misma respuesta', async () => {
      const [uno, otro] = [await cliente(), await cliente()];
      const deOtro = await calificada(otro);
      const { lectura } = crear();

      const inexistente = await lectura(coleccion(uno, `/${randomUUID()}`), uno);
      const ajena = await lectura(coleccion(uno, `/${deOtro.calificacionId}`), uno);

      expect([inexistente.statusCode, ajena.statusCode]).toEqual([404, 404]);
      expect(ajena.json()).toEqual({ ...inexistente.json(), instance: expect.any(String) });
    });

    it('404 si M6 dice que el viaje no existe o es de otro cliente, sin guardar nada', async () => {
      const clienteId = await cliente();
      const { alta } = crear();
      const viajeId = randomUUID();
      serv.responderCon({ tipo: '4xx', estado: 404 });
      const inexistente = await alta(clienteId, { viajeId, puntaje: 5 });
      serv.responderCon(viajeDeM6(viajeId, randomUUID()));
      const ajeno = await alta(clienteId, { viajeId, puntaje: 5 });

      expect([inexistente.statusCode, ajeno.statusCode]).toEqual([404, 404]);
      expect(ajeno.json().detail).toBe(inexistente.json().detail);
      const filas = await pool.consultar('SELECT 1 FROM calificaciones WHERE cliente_id = $1', [clienteId]);
      expect(filas.rowCount).toBe(0);
    });

    it('409 /errores/calificacion-duplicada si el cliente ya calificó el viaje, con otra clave y sin llamar a M6', async () => {
      const clienteId = await cliente();
      const { viajeId } = await calificada(clienteId);
      serv.responderCon(viajeDeM6(viajeId, clienteId));

      const respuesta = await crear().alta(clienteId, { viajeId, puntaje: 1 });

      expect(respuesta.statusCode).toBe(409);
      expect(respuesta.headers['content-type']).toMatch(PROBLEMA);
      expect(respuesta.json()).toMatchObject({ type: '/errores/calificacion-duplicada', status: 409 });
      expect(serv.llamadas).toBe(0);
    });

    it('422 /errores/viaje-no-completado si el viaje del cliente no está completado, sin guardar nada', async () => {
      const clienteId = await cliente();
      const viajeId = randomUUID();
      serv.responderCon(viajeDeM6(viajeId, clienteId, { state: 'IN_PROGRESS', driverId: undefined }));

      const respuesta = await crear().alta(clienteId, { viajeId, puntaje: 5 });

      expect(respuesta.statusCode).toBe(422);
      expect(respuesta.headers['content-type']).toMatch(PROBLEMA);
      expect(respuesta.json()).toMatchObject({ type: '/errores/viaje-no-completado', status: 422 });
      const filas = await pool.consultar('SELECT 1 FROM calificaciones WHERE cliente_id = $1', [clienteId]);
      expect(filas.rowCount).toBe(0);
    });

    it('422 /errores/idempotencia-reutilizada si la clave se usa con otro cuerpo, sin llamar a M6 ni cambiar la primera', async () => {
      const clienteId = await cliente();
      const viajeId = randomUUID();
      serv.responderCon(viajeDeM6(viajeId, clienteId));
      const { alta } = crear();
      const primera = await alta(clienteId, { viajeId, puntaje: 5 }, 'clave-1');
      serv.responderCon(viajeDeM6(viajeId, clienteId));

      const segunda = await alta(clienteId, { viajeId, puntaje: 2 }, 'clave-1');

      expect(segunda.statusCode).toBe(422);
      expect(segunda.json()).toMatchObject({ type: '/errores/idempotencia-reutilizada', status: 422 });
      expect(serv.llamadas).toBe(0);
      expect((await alta(clienteId, { viajeId, puntaje: 5 }, 'clave-1')).json()).toEqual(primera.json());
    });
  });

  describe('500 y 503 (RF-2.5.5, RF-2.5.6, RNF-13, RNF-14)', () => {
    it.each([
      ['un 5xx', { tipo: '5xx', estado: 502 }, 2],
      ['un cuerpo que no es JSON', { tipo: 'no-json' }, 2],
      ['un corte de la conexión', { tipo: 'corta' }, 2],
      ['una demora mayor al tiempo', { tipo: 'demora-cuerpo', retardoMs: 1200 }, 2],
      ['un 200 sin la forma esperada', { tipo: 'ok', cuerpo: { viaje: 1 } }, 1],
    ] as const)('%s de M6: 503 problem+json con Retry-After, sin guardar nada', async (_caso, falla, llamadas) => {
      const clienteId = await cliente();
      serv.responderCon(falla);

      const respuesta = await crear({ reintentarDespuesS: 7 }).alta(clienteId, { viajeId: randomUUID(), puntaje: 5 });

      expect(respuesta.statusCode).toBe(503);
      expect(respuesta.headers['content-type']).toMatch(PROBLEMA);
      expect(respuesta.headers['retry-after']).toBe('7');
      expect(respuesta.json()).toMatchObject({ status: 503, detail: 'M6 no está disponible' });
      expect(serv.llamadas).toBe(llamadas);
      const filas = await pool.consultar('SELECT 1 FROM calificaciones WHERE cliente_id = $1', [clienteId]);
      expect(filas.rowCount).toBe(0);
    });

    it.each([400, 401, 403])('un %i de M6 no se reintenta y da 500 genérico, sin Retry-After ni datos de M6', async (estado) => {
      const clienteId = await cliente();
      serv.responderCon({ tipo: '4xx', estado, cuerpo: errorDeM6('X', 'dato-de-m6') });

      const respuesta = await crear().alta(clienteId, { viajeId: randomUUID(), puntaje: 5 });

      expect(respuesta.statusCode).toBe(500);
      expect(respuesta.headers['content-type']).toMatch(PROBLEMA);
      expect(respuesta.headers['retry-after']).toBeUndefined();
      expect(respuesta.body).not.toContain('dato-de-m6');
      expect(serv.llamadas).toBe(1);
    });

    // RNF-14: el 500 deja en el log la causa (el código de M6) con el id de correlación de la solicitud, que también llegó a M6.
    it('el 500 por un 4xx de M6 se registra con su causa y el id de correlación, que también llegó a M6', async () => {
      const clienteId = await cliente();
      serv.responderCon({ tipo: '4xx', estado: 401 });
      const { app, logs, tokens } = crear();
      const token = armarToken({ claims: { sub: clienteId, roles: ['CLIENTE'] } });
      tokens.push(token);

      const respuesta = await app.inject({
        method: 'POST',
        url: coleccion(clienteId),
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'k', 'x-request-id': 'calificar-500' },
        payload: { viajeId: randomUUID(), puntaje: 5 },
      });

      expect(respuesta.statusCode).toBe(500);
      expect(respuesta.headers['x-request-id']).toBe('calificar-500');
      expect(serv.encabezadosRecibidos.get('x-request-id')).toBe('calificar-500');
      expect(logs.lineas().filter(({ level }) => level === 50)).toEqual([
        expect.objectContaining({
          idCorrelacion: 'calificar-500',
          err: expect.objectContaining({ causa: expect.objectContaining({ mensaje: 'M6 respondió 401' }) }),
        }),
      ]);
    });

    it('el 503 de M6 se registra con su causa y el id de correlación (RNF-14)', async () => {
      const clienteId = await cliente();
      serv.responderCon({ tipo: '5xx', estado: 502 });
      const { app, logs, tokens } = crear();
      const token = armarToken({ claims: { sub: clienteId, roles: ['CLIENTE'] } });
      tokens.push(token);

      const respuesta = await app.inject({
        method: 'POST',
        url: coleccion(clienteId),
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'k', 'x-request-id': 'calificar-503' },
        payload: { viajeId: randomUUID(), puntaje: 5 },
      });

      expect(respuesta.statusCode).toBe(503);
      expect(logs.lineas().filter(({ level }) => level === 50)).toEqual([
        expect.objectContaining({
          idCorrelacion: 'calificar-503',
          err: expect.objectContaining({ causa: expect.objectContaining({ mensaje: 'M6 respondió 502' }) }),
        }),
      ]);
    });

    it('el 503 de la base no lleva Retry-After y no llama a M6, en las tres operaciones', async () => {
      const caida: BaseDeDatos = { ...POOL_FALSO, consultar: async () => Promise.reject(new BaseNoDisponible()) };
      const clienteId = randomUUID();
      const { alta, lectura } = crear({}, caida);

      const respuestas = await Promise.all([
        alta(clienteId, { viajeId: randomUUID(), puntaje: 5 }),
        lectura(coleccion(clienteId), clienteId),
        lectura(coleccion(clienteId, `/${randomUUID()}`), clienteId),
      ]);

      for (const respuesta of respuestas) {
        expect(respuesta.statusCode).toBe(503);
        expect(respuesta.headers['content-type']).toMatch(PROBLEMA);
        expect(respuesta.headers['retry-after']).toBeUndefined();
      }
      expect(serv.llamadas).toBe(0);
    });
  });

  // RNF-19: el log no trae el token del usuario, el token de servicio que va a M6, el comentario, la clave de idempotencia ni
  // identificadores de viajes, conductores o calificaciones, ni en el éxito, ni en las lecturas, ni en los errores.
  describe('lo que no puede llegar a los logs (RNF-14, RNF-19)', () => {
    it('ni tokens, ni comentario, ni clave, ni identificadores de viajes, conductores o calificaciones', async () => {
      const clienteId = await cliente();
      const comentario = 'Comentario-privado-del-cliente';
      const clave = 'clave-secreta-de-idempotencia';
      const viajeId = randomUUID();
      const { alta, lectura, logs, tokens } = crear();
      const credenciales: string[] = [];
      const anotarCredenciales = () =>
        credenciales.push(...serv.autorizaciones.flatMap((a) => (a === undefined ? [] : [a.replace('Bearer ', '')])));

      serv.responderCon(viajeDeM6(viajeId, clienteId));
      const creada = await alta(clienteId, { viajeId, puntaje: 5, comentario }, clave);
      expect(creada.statusCode).toBe(201);
      anotarCredenciales();
      const { calificacionId } = creada.json() as { calificacionId: string };
      const otroViaje = randomUUID();
      for (const falla of [{ tipo: '5xx', estado: 500, cuerpo: { error: CONDUCTOR } }, { tipo: '4xx', estado: 403 }] as const) {
        serv.responderCon(falla);
        expect((await alta(clienteId, { viajeId: otroViaje, puntaje: 2, comentario }, `${clave}-${falla.estado}`)).statusCode).toBeGreaterThanOrEqual(500);
        anotarCredenciales();
      }
      serv.responderCon(viajeDeM6(viajeId, clienteId));
      expect((await alta(clienteId, { viajeId, puntaje: 1, comentario }, clave)).statusCode).toBe(422);
      expect((await alta(clienteId, { viajeId, puntaje: 5, comentario }, `${clave}-otra`)).statusCode).toBe(409);
      expect((await lectura(coleccion(clienteId), clienteId)).statusCode).toBe(200);
      expect((await lectura(coleccion(clienteId, `/${calificacionId}`), clienteId)).statusCode).toBe(200);
      expect((await lectura(coleccion(clienteId, `/${randomUUID()}`), clienteId)).statusCode).toBe(404);

      const texto = logs.texto();
      expect(logs.lineas().length).toBeGreaterThan(0);
      expect(credenciales.every((credencial) => credencial !== '' && !tokens.includes(credencial))).toBe(true);
      const prohibidos = [...tokens, ...credenciales, 'Bearer ey', comentario, clave, viajeId, otroViaje, CONDUCTOR, calificacionId];
      for (const prohibido of prohibidos) expect(texto).not.toContain(prohibido);
      // La línea de la solicitud lleva la plantilla de la ruta, no los identificadores (RNF-19).
      expect(logs.lineas().filter(({ metodo }) => metodo === 'GET').map(({ ruta }) => ruta)).toEqual([
        '/api/v1/clientes/:clienteId/calificaciones',
        '/api/v1/clientes/:clienteId/calificaciones/:calificacionId',
        '/api/v1/clientes/:clienteId/calificaciones/:calificacionId',
      ]);
    });
  });
});
