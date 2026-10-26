import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrar } from '../../src/bd/migraciones.js';
import { crearPool, type BaseDeDatos, type PoolBd } from '../../src/bd/pool.js';
import { crearCalificacion } from '../../src/calificaciones/repositorio.js';
import { cargarContrato } from '../../src/contrato/cargar.js';
import { BaseNoDisponible } from '../../src/errores.js';
import { listarHistorialViajes } from '../../src/historial/operaciones.js';
import { crearApp, POOL_FALSO } from '../ayudas/app.js';
import { type BaseDePrueba, crearBaseDePrueba } from '../ayudas/bd.js';
import { capturarLogs } from '../ayudas/logs.js';
import { errorDeM6, paginaDeM6, resumenDeM6 } from '../ayudas/m6-simulado.js';
import { crearServidorModulo } from '../ayudas/servidor-modulo.js';
import { armarToken } from '../ayudas/tokens.js';

const contrato = cargarContrato();
const CONDUCTOR = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
const OTRO_CONDUCTOR = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
type Rol = 'CLIENTE' | 'OPERADOR' | 'SERVICIO' | 'CONDUCTOR';

const viaje = (n: number, clientId: string, extra: object = {}) => resumenDeM6(n, clientId, CONDUCTOR, extra);
const pagina = paginaDeM6;
const url = (id: string, consulta = '') => `/api/v1/clientes/${id}/viajes${consulta}`;

describe('listarHistorialViajes por HTTP, con PostgreSQL real y M6 simulado (007/T6)', () => {
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

  // Cada prueba parte con el contador de llamadas a M6 en cero y una respuesta válida.
  beforeEach(() => serv.responderCon({ tipo: 'ok', cuerpo: pagina([], 0) }));

  const perfil = async () => {
    const id = randomUUID();
    await pool.consultar(
      `INSERT INTO clientes (cliente_id, nombre, apellido, telefono) VALUES ($1, 'Ana', 'Ejemplo', '+5493624000000')`,
      [id],
    );
    return id;
  };

  // La app y un pedido: el token y el log quedan a mano para mirar después que no se filtraron. La URL de M6 se conoce
  // recién cuando levanta el simulado.
  function crear(config: { reintentarDespuesS?: number } = {}, bd: BaseDeDatos = pool) {
    const logs = capturarLogs();
    const app = crearApp(
      { listarHistorialViajes },
      { contrato, pool: bd, flujoLog: logs.flujo, config: { urlM6: serv.url, tiempoModulosMs: 300, reintentosModulos: 1, ...config } },
    );
    const tokens: string[] = [];
    const pedir = (id: string, consulta = '', roles: Rol[] = ['CLIENTE'], sub = id) => {
      const token = armarToken({ claims: { sub, roles } });
      tokens.push(token);
      return app.inject({ method: 'GET', url: url(id, consulta), headers: { authorization: `Bearer ${token}` } });
    };
    return { app, pedir, logs, tokens };
  }
  const consultaDeM6 = () => Object.fromEntries(new URL(serv.rutaRecibida, serv.url).searchParams);

  describe('200 (RF-2.4, RF-2.4.1, RF-2.4.2)', () => {
    it('un CLIENTE ve su historial: página convertida, X-Request-Id y los valores por defecto de page y size', async () => {
      const id = await perfil();
      serv.responderCon({
        tipo: 'ok',
        cuerpo: pagina([viaje(1, id), viaje(2, id, { driverId: undefined, state: 'CANCELLED_BY_CLIENT' })], 42),
      });
      const { pedir } = crear();

      const respuesta = await pedir(id);

      expect(respuesta.statusCode).toBe(200);
      expect(respuesta.headers['content-type']).toMatch(/^application\/json/);
      expect(respuesta.headers['x-request-id']).toBeTypeOf('string');
      expect(respuesta.json()).toEqual({
        page: 0,
        size: 20,
        totalElementos: 42,
        totalPaginas: 3,
        items: [
          { viajeId: viaje(1, id).id, estado: 'COMPLETED', conductorId: CONDUCTOR, calificado: false },
          { viajeId: viaje(2, id).id, estado: 'CANCELLED_BY_CLIENT', calificado: false },
        ],
      });
      expect(consultaDeM6()).toEqual({ clientId: id, page: '1', pageSize: '20' });
    });

    it('page y size de la URL llegan a M6 como page + 1 y pageSize', async () => {
      const id = await perfil();
      serv.responderCon({ tipo: 'ok', cuerpo: pagina([], 45) });
      const { pedir } = crear();

      const respuesta = await pedir(id, '?page=2&size=15');

      expect(respuesta.json()).toEqual({ page: 2, size: 15, totalElementos: 45, totalPaginas: 3, items: [] });
      expect(consultaDeM6()).toEqual({ clientId: id, page: '3', pageSize: '15' });
    });

    // 007/V: el contrato no le pone máximo a page, y una página que no se puede pedir a M6 como entero no tiene viajes.
    it('una página inalcanzable (page=1e21): 200 con items vacío y los totales de M6, que recibe page=1', async () => {
      const id = await perfil();
      serv.responderCon({ tipo: 'ok', cuerpo: pagina([viaje(1, id)], 45) });

      const respuesta = await crear().pedir(id, '?page=1e21&size=15');

      expect(respuesta.statusCode).toBe(200);
      expect(respuesta.json()).toEqual({ page: 1e21, size: 15, totalElementos: 45, totalPaginas: 3, items: [] });
      expect(consultaDeM6()).toEqual({ clientId: id, page: '1', pageSize: '15' });
    });

    it('un cliente sin viajes: 200 con items vacío, nunca 404', async () => {
      const id = await perfil();
      serv.responderCon({ tipo: 'ok', cuerpo: pagina([], 0) });

      const respuesta = await crear().pedir(id);

      expect([respuesta.statusCode, respuesta.json()]).toEqual([
        200,
        { page: 0, size: 20, totalElementos: 0, totalPaginas: 0, items: [] },
      ]);
    });

    it.each([[['OPERADOR']], [['CLIENTE', 'OPERADOR']]] as Rol[][][])('%j ve el historial de otro cliente', async (roles) => {
      const id = await perfil();
      serv.responderCon({ tipo: 'ok', cuerpo: pagina([viaje(1, id)], 1) });

      const respuesta = await crear().pedir(id, '', roles, randomUUID());

      expect(respuesta.statusCode).toBe(200);
      expect(respuesta.json().items).toHaveLength(1);
    });
  });

  describe('400, 401 y 403 salen antes de la base y de M6 (RF-2.4.5, RNF-03)', () => {
    it.each(['?page=-1', '?page=abc', '?size=0', '?size=101', '?size=1.5'])('400 con %s, sin llamar a M6', async (consulta) => {
      const id = await perfil();
      serv.responderCon({ tipo: 'ok', cuerpo: pagina([], 0) });

      const respuesta = await crear().pedir(id, consulta);

      expect(respuesta.statusCode).toBe(400);
      expect(respuesta.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(serv.llamadas).toBe(0);
    });

    it('400 con un clienteId que no es un UUID, sin llamar a M6', async () => {
      serv.responderCon({ tipo: 'ok', cuerpo: pagina([], 0) });

      const respuesta = await crear().pedir('no-es-un-uuid');

      expect(respuesta.statusCode).toBe(400);
      expect(serv.llamadas).toBe(0);
    });

    it.each([
      ['sin token', {}],
      ['con un token mal firmado', { authorization: `Bearer ${armarToken({ clave: 'otra-clave-de-32-caracteres-xxxxx!' })}` }],
    ])('401 %s, sin llamar a M6', async (_caso, headers) => {
      const id = await perfil();
      serv.responderCon({ tipo: 'ok', cuerpo: pagina([], 0) });

      const respuesta = await crear().app.inject({ method: 'GET', url: url(id), headers });

      expect(respuesta.statusCode).toBe(401);
      expect(respuesta.headers['www-authenticate']).toBe('Bearer');
      expect(serv.llamadas).toBe(0);
    });

    it('403 si un CLIENTE pide el historial de otro, sin tocar la base ni M6', async () => {
      const id = await perfil();
      serv.responderCon({ tipo: 'ok', cuerpo: pagina([viaje(1, id)], 1) });

      const respuesta = await crear({}, POOL_FALSO).pedir(id, '', ['CLIENTE'], randomUUID());

      expect(respuesta.statusCode).toBe(403);
      expect(respuesta.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(serv.llamadas).toBe(0);
    });

    it.each([['CONDUCTOR'], ['SERVICIO']] as Rol[][])('403 para el rol %s, que la operación no admite', async (rol) => {
      const id = await perfil();

      const respuesta = await crear({}, POOL_FALSO).pedir(id, '', [rol]);

      expect(respuesta.statusCode).toBe(403);
      expect(serv.llamadas).toBe(0);
    });
  });

  it('404 si el perfil no existe, sin llamar a M6', async () => {
    serv.responderCon({ tipo: 'ok', cuerpo: pagina([], 0) });
    const id = randomUUID();

    const respuesta = await crear().pedir(id);

    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(serv.llamadas).toBe(0);
  });

  describe('M6 falla (RF-2.4.6, RF-2.4.7, RF-2.4.10)', () => {
    it.each([
      ['un 5xx', { tipo: '5xx', estado: 502 }, 2],
      ['un cuerpo que no es JSON', { tipo: 'no-json' }, 2],
      ['un corte de la conexión', { tipo: 'corta' }, 2],
      ['una demora mayor al tiempo', { tipo: 'demora-cuerpo', retardoMs: 1200 }, 2],
      ['un 200 que no tiene la forma esperada', { tipo: 'ok', cuerpo: { viajes: [] } }, 1],
    ] as const)('%s: 503 problem+json con Retry-After', async (_caso, falla, llamadas) => {
      const id = await perfil();
      serv.responderCon(falla);

      const respuesta = await crear({ reintentarDespuesS: 7 }).pedir(id);

      expect(respuesta.statusCode).toBe(503);
      expect(respuesta.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(respuesta.headers['retry-after']).toBe('7');
      expect(respuesta.json()).toMatchObject({ status: 503, detail: 'M6 no está disponible' });
      expect(serv.llamadas).toBe(llamadas);
    });

    it.each([400, 401, 403, 404])('un %i de M6 no se reintenta y da 500 genérico', async (estado) => {
      const id = await perfil();
      serv.responderCon({ tipo: '4xx', estado, cuerpo: errorDeM6('X', 'dato-de-m6') });

      const respuesta = await crear().pedir(id);

      expect(respuesta.statusCode).toBe(500);
      expect(respuesta.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(respuesta.headers['retry-after']).toBeUndefined();
      expect(respuesta.body).not.toContain('dato-de-m6');
      expect(serv.llamadas).toBe(1);
    });

    // RF-2.4.7 y RNF-14: el 500 deja en el log la causa (el código de M6) con el id de correlación de la solicitud, que también
    // llegó a M6.
    it('el 500 por un 4xx de M6 se registra con su causa y el id de correlación, que también llegó a M6', async () => {
      const id = await perfil();
      serv.responderCon({ tipo: '4xx', estado: 401 });
      const { app, logs } = crear();

      const respuesta = await app.inject({
        method: 'GET',
        url: url(id),
        headers: { authorization: `Bearer ${armarToken({ claims: { sub: id, roles: ['CLIENTE'] } })}`, 'x-request-id': 'historial-500' },
      });

      expect(respuesta.statusCode).toBe(500);
      expect(respuesta.headers['x-request-id']).toBe('historial-500');
      expect(serv.encabezadosRecibidos.get('x-request-id')).toBe('historial-500');
      expect(logs.lineas().filter(({ level }) => level === 50)).toEqual([
        expect.objectContaining({
          idCorrelacion: 'historial-500',
          err: expect.objectContaining({ causa: expect.objectContaining({ mensaje: 'M6 respondió 401' }) }),
        }),
      ]);
    });

    it('el 503 de la base no lleva Retry-After y no llama a M6', async () => {
      const caida: BaseDeDatos = { ...POOL_FALSO, consultar: async () => Promise.reject(new BaseNoDisponible()) };
      const id = randomUUID();

      const respuesta = await crear({}, caida).pedir(id);

      expect(respuesta.statusCode).toBe(503);
      expect(respuesta.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(respuesta.headers['retry-after']).toBeUndefined();
      expect(serv.llamadas).toBe(0);
    });
  });

  // RNF-19: el log de la solicitud no trae el token del usuario, el token de servicio que va a M6 ni identificadores de
  // viajes ni de conductores, ni en el éxito, ni en el aviso de descarte, ni en los errores.
  describe('lo que no puede llegar a los logs (RNF-14, RNF-19)', () => {
    it('ni el token, ni la credencial de M6, ni identificadores de viajes o conductores', async () => {
      const id = await perfil();
      const ajeno = randomUUID();
      const { pedir, logs, tokens } = crear();
      const tokensDeServicio: string[] = [];
      const viajes = [viaje(1, id), viaje(2, ajeno, { driverId: OTRO_CONDUCTOR })];

      serv.responderCon({ tipo: 'ok', cuerpo: pagina(viajes, 2) });
      expect((await pedir(id)).statusCode).toBe(200);
      tokensDeServicio.push(serv.autorizaciones[0] ?? '');

      for (const falla of [{ tipo: '5xx', estado: 500, cuerpo: { error: CONDUCTOR } }, { tipo: '4xx', estado: 401 }] as const) {
        serv.responderCon(falla);
        expect((await pedir(id)).statusCode).toBeGreaterThanOrEqual(500);
        tokensDeServicio.push(...serv.autorizaciones.filter((a): a is string => a !== undefined));
      }

      // El aviso del descarte dice cuántos y nada más; la solicitud queda correlacionada por su identificador.
      const aviso = logs.lineas().find(({ msg }) => msg === 'M6 devolvió viajes de otro cliente');
      expect(aviso).toMatchObject({ descartados: 1 });
      expect(aviso?.idCorrelacion).toBeTypeOf('string');

      const texto = logs.texto();
      const credenciales = tokensDeServicio.map((autorizacion) => autorizacion.replace('Bearer ', ''));
      expect(credenciales.every((credencial) => credencial !== '' && !tokens.includes(credencial))).toBe(true);
      for (const secreto of [...tokens, ...credenciales, 'Bearer ey']) expect(texto).not.toContain(secreto);
      for (const viajeId of viajes.map(({ id: v }) => v)) expect(texto).not.toContain(viajeId);
      for (const persona of [CONDUCTOR, OTRO_CONDUCTOR, ajeno]) expect(texto).not.toContain(persona);
    });
  });

  // 008/T9, RF-2.5.14: `calificado` es un dato de M2, que el contrato ya declara en cada viaje.
  describe('calificado (RF-2.5.14)', () => {
    it('cada viaje trae calificado: true si el cliente lo calificó y false si no; M6 se llama una sola vez', async () => {
      const id = await perfil();
      await crearCalificacion((sql, parametros) => pool.consultar(sql, parametros), id, randomUUID(), {
        viajeId: viaje(1, id).id,
        conductorId: CONDUCTOR,
        puntaje: 4,
      });
      serv.responderCon({ tipo: 'ok', cuerpo: pagina([viaje(1, id), viaje(2, id)], 2) });

      const respuesta = await crear().pedir(id);

      expect(respuesta.statusCode).toBe(200);
      expect(respuesta.json().items.map(({ viajeId, calificado }: { viajeId: string; calificado: boolean }) => [viajeId, calificado])).toEqual([
        [viaje(1, id).id, true],
        [viaje(2, id).id, false],
      ]);
      expect(serv.llamadas).toBe(1);
    });

    it('el historial vacío no trae calificado y responde 200', async () => {
      const id = await perfil();

      const respuesta = await crear().pedir(id);

      expect([respuesta.statusCode, respuesta.json().items]).toEqual([200, []]);
    });

    it('si la base falla al consultar los calificados: 503 genérico, sin Retry-After y sin el historial', async () => {
      const id = await perfil();
      serv.responderCon({ tipo: 'ok', cuerpo: pagina([viaje(1, id)], 1) });
      const falla: BaseDeDatos = {
        tiempoBdMs: pool.tiempoBdMs,
        connect: () => pool.connect(),
        consultar: (sql, parametros) =>
          /FROM calificaciones/i.test(sql) && !/FROM clientes/i.test(sql)
            ? Promise.reject(new BaseNoDisponible())
            : pool.consultar(sql, parametros),
      };

      const respuesta = await crear({}, falla).pedir(id);

      expect(respuesta.statusCode).toBe(503);
      expect(respuesta.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(respuesta.headers['retry-after']).toBeUndefined();
      expect(respuesta.json()).not.toHaveProperty('items');
    });
  });
});
