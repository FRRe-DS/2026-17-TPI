import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Manejador } from '../../src/contrato/operaciones.js';
import { crearPool, type PoolBd } from '../../src/bd/pool.js';
import { crearApp } from '../ayudas/app.js';
import { type BaseDePrueba, crearBaseDePrueba } from '../ayudas/bd.js';
import { capturarLogs } from '../ayudas/logs.js';

// El tiempo de base de estas pruebas: más corto que el 2000 por defecto para que las que lo agotan no tarden.
const TIEMPO_BD_MS = 500;

// Lo que se acepta por encima del tiempo de base: la máquina de CI puede ir lenta.
const MARGEN_MS = 1000;

// Node puede disparar un temporizador unos milisegundos antes de lo que mide performance.now().
const TOLERANCIA_MS = 20;

// Una consulta que dura mucho más que el tiempo de base: la prueba la corta antes.
const CONSULTA_LENTA_S = 10;

const RESTRICCION = 'codigos_de_prueba_codigo_unico';

const COMO_JSON = { 'content-type': 'application/json' };

type Registro = { error: unknown; mensaje: string };

describe('consultar() sobre una base real (RNF-08.1, RNF-14.2)', () => {
  let base: BaseDePrueba;
  let pool: PoolBd;
  let registros: Registro[];

  beforeEach(async () => {
    base = await crearBaseDePrueba();
    registros = [];
    pool = crearPool({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS }, (error, mensaje) => registros.push({ error, mensaje }));
    await pool.consultar(`CREATE TABLE codigos_de_prueba (codigo text CONSTRAINT ${RESTRICCION} UNIQUE)`);
  });

  afterEach(async () => {
    await pool.end();
    await base.borrar();
  });

  // Las tres operaciones de prueba del contrato, con manejadores que consultan la base como lo harán los de negocio.
  const alta: Manejador = async (request, reply) => {
    const { codigo } = request.body as { codigo: string };
    await pool.consultar('INSERT INTO codigos_de_prueba (codigo) VALUES ($1)', [codigo]);
    return reply.code(201).send({ codigo });
  };
  const tarda: Manejador = async () => {
    await pool.consultar('SELECT pg_sleep($1)', [CONSULTA_LENTA_S]);
    return { ok: true };
  };
  const falla: Manejador = async () => {
    await pool.consultar('SELECT * FROM tabla_que_no_existe');
    return { ok: true };
  };

  function crear() {
    const logs = capturarLogs();
    const app = crearApp(
      { probarAltaDuplicada: alta, probarTarda: tarda, probarFalla: falla },
      { config: { tiempoBdMs: TIEMPO_BD_MS }, flujoLog: logs.flujo },
    );
    const darDeAlta = (codigo: string) =>
      app.inject({ method: 'POST', url: '/pruebas/duplicados', headers: COMO_JSON, payload: { codigo } });
    return { app, logs, darDeAlta };
  }

  const cuantos = async () => (await pool.consultar('SELECT count(*)::int AS n FROM codigos_de_prueba')).rows[0]?.n;

  // Corta, desde una sesión aparte, las sesiones de esta base que cumplen `donde`, como si la base se reiniciara. Devuelve
  // cuántas cortó.
  async function cortarSesiones(donde: string): Promise<number> {
    const cliente = new Client({ connectionString: base.urlBd });
    await cliente.connect();
    try {
      const cortadas = await cliente.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname = current_database() AND pid <> pg_backend_pid() AND ${donde}`,
      );
      return cortadas.rowCount ?? 0;
    } finally {
      await cliente.end();
    }
  }

  describe('consultas que salen bien', () => {
    it('devuelve las filas de una consulta con parámetros', async () => {
      const resultado = await pool.consultar<{ n: number }>('SELECT $1::int + 1 AS n', [41]);

      expect(resultado.rows).toEqual([{ n: 42 }]);
    });

    it('una consulta sin parámetros también sale bien', async () => {
      expect((await pool.consultar('SELECT 1 AS uno')).rows).toEqual([{ uno: 1 }]);
    });

    it('no registra nada', async () => {
      await pool.consultar('SELECT 1');

      expect(registros).toEqual([]);
    });
  });

  describe('un alta que choca con la restricción única da 409 (RNF-08.1)', () => {
    it('el segundo alta con el mismo código da 409 en problem+json, sin la restricción ni la consulta', async () => {
      const { darDeAlta } = crear();

      const primera = await darDeAlta('ABC-1');
      const segunda = await darDeAlta('ABC-1');

      expect(primera.statusCode).toBe(201);
      expect(segunda.statusCode).toBe(409);
      expect(segunda.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(segunda.json()).toEqual({
        type: 'about:blank',
        title: 'Conflicto',
        status: 409,
        detail: 'Ya existe un registro con esos datos',
        instance: '/pruebas/duplicados',
      });
      expect(segunda.body).not.toMatch(new RegExp(`${RESTRICCION}|codigos_de_prueba|INSERT|ABC-1`));
      expect(await cuantos()).toBe(1);
    });

    it('no queda como error en el log ni con el nombre de la restricción, ni cuenta como fallo de la base', async () => {
      const { logs, darDeAlta } = crear();

      await darDeAlta('ABC-1');
      await darDeAlta('ABC-1');

      expect(logs.lineas().filter((linea) => linea.level >= 50)).toEqual([]);
      expect(logs.texto()).not.toMatch(new RegExp(`${RESTRICCION}|INSERT`));
      expect(registros).toEqual([]);
    });

    it('dos altas a la vez con el mismo código: una da 201, la otra 409, y queda una sola fila (RNF-08)', async () => {
      const { darDeAlta } = crear();

      const respuestas = await Promise.all([darDeAlta('ABC-2'), darDeAlta('ABC-2')]);

      expect(respuestas.map((respuesta) => respuesta.statusCode).sort()).toEqual([201, 409]);
      expect(await cuantos()).toBe(1);
    });

    it('un código distinto no choca', async () => {
      const { darDeAlta } = crear();

      const respuestas = [await darDeAlta('ABC-1'), await darDeAlta('ABC-2')];

      expect(respuestas.map((respuesta) => respuesta.statusCode)).toEqual([201, 201]);
      expect(await cuantos()).toBe(2);
    });
  });

  describe('una consulta más lenta que el tiempo de base da 503 en ese tiempo (RNF-14.2)', () => {
    it('da 503 en problem+json entre el tiempo de base y ese tiempo más un margen', async () => {
      const { app } = crear();
      const desde = performance.now();

      const respuesta = await app.inject({ method: 'GET', url: '/pruebas/tarda' });
      const duracion = performance.now() - desde;

      expect(respuesta.statusCode).toBe(503);
      expect(respuesta.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(respuesta.json()).toEqual({
        type: 'about:blank',
        title: 'Servicio no disponible',
        status: 503,
        detail: 'La base de datos no está disponible',
        instance: '/pruebas/tarda',
      });
      expect(duracion).toBeGreaterThanOrEqual(TIEMPO_BD_MS - TOLERANCIA_MS);
      expect(duracion).toBeLessThan(TIEMPO_BD_MS + MARGEN_MS);
    });

    it('registra la causa, una sola vez, y no como un error interno', async () => {
      const { app, logs } = crear();

      await app.inject({ method: 'GET', url: '/pruebas/tarda' });

      expect(registros).toHaveLength(1);
      expect(registros[0]?.error).toBeInstanceOf(Error);
      expect(registros[0]?.mensaje).toEqual(expect.any(String));
      expect(logs.lineas().filter((linea) => linea.level >= 50)).toEqual([]);
    });

    it('el pool sigue sirviendo: la consulta siguiente sale bien', async () => {
      const { app } = crear();
      await app.inject({ method: 'GET', url: '/pruebas/tarda' });

      expect((await pool.consultar('SELECT 1 AS uno')).rows).toEqual([{ uno: 1 }]);
    });

    // Si el pool no cortara por su cuenta (query_timeout), la conexión seguiría ocupada hasta que pg_sleep termine y, con
    // consultas lentas repetidas, el pool se quedaría sin conexiones.
    it('suelta la conexión de la consulta que cortó, sin esperar a que la base termine', async () => {
      const { app } = crear();

      await app.inject({ method: 'GET', url: '/pruebas/tarda' });

      await vi.waitFor(() => expect(pool.totalCount).toBe(0));
    });
  });

  describe('la base que corta la conexión (RNF-14.2)', () => {
    it('una consulta en curso que la base corta da 503 y registra la causa', async () => {
      const { app } = crear();
      const respuesta = app.inject({ method: 'GET', url: '/pruebas/tarda' });

      // El pool abre su conexión y manda la consulta: hasta entonces no hay sesión que cortar.
      await vi.waitFor(async () => expect(await cortarSesiones(`query LIKE '%pg_sleep%'`)).toBe(1));

      expect((await respuesta).statusCode).toBe(503);
      expect(registros).toHaveLength(1);
      expect(registros[0]?.error).toMatchObject({ code: '57P01' });
    });

    // Sin un oyente de 'error' en el pool, esto tira el proceso: Vitest lo cuenta como error de la corrida.
    it('una conexión inactiva que la base corta se registra, no tira el proceso, y el pool abre otra', async () => {
      await pool.consultar('SELECT 1');
      expect(pool.idleCount).toBe(1);

      expect(await cortarSesiones(`state = 'idle'`)).toBe(1);

      await vi.waitFor(() => expect(registros).toHaveLength(1));
      expect(registros[0]?.error).toMatchObject({ code: '57P01' });
      expect((await pool.consultar('SELECT 1 AS uno')).rows).toEqual([{ uno: 1 }]);
    });
  });

  describe('otro error de la base da 500 (RNF-03.3)', () => {
    it('una tabla que no existe da 500 en problem+json, sin la consulta ni el nombre de la tabla', async () => {
      const { app } = crear();

      const respuesta = await app.inject({ method: 'GET', url: '/pruebas/falla' });

      expect(respuesta.statusCode).toBe(500);
      expect(respuesta.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(respuesta.json()).toEqual({
        type: 'about:blank',
        title: 'Error interno',
        status: 500,
        detail: 'Ocurrió un error interno',
        instance: '/pruebas/falla',
      });
      expect(respuesta.body).not.toMatch(/tabla_que_no_existe|SELECT|relation/);
    });

    it('lo deja en el log como error, con su código, y no lo cuenta como falta de base', async () => {
      const { app, logs } = crear();

      await app.inject({ method: 'GET', url: '/pruebas/falla' });

      const errores = logs.lineas().filter((linea) => linea.level >= 50);
      expect(errores).toHaveLength(1);
      expect(errores[0]?.err).toMatchObject({ codigo: '42P01' });
      expect(registros).toEqual([]);
    });
  });
});
