import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrar } from '../../src/bd/migraciones.js';
import { crearPool, type PoolBd, TiempoAgotado } from '../../src/bd/pool.js';
import { conIdempotencia, type RespuestaIdempotente, type SolicitudIdempotente } from '../../src/bd/idempotencia.js';
import { type Consultar, transaccion } from '../../src/bd/transaccion.js';
import {
  actualizarPerfil,
  crearBloqueo,
  crearPerfil,
  levantarBloqueo,
  listarBloqueos,
  obtenerBloqueo,
  obtenerEstadoCuenta,
  obtenerPerfil,
} from '../../src/clientes/repositorio.js';
import {
  BaseNoDisponible,
  BloqueoNoVigente,
  BloqueoVencido,
  BloqueoYaLevantado,
  Conflicto,
  IdempotenciaReutilizada,
  NoEncontrado,
  PerfilYaExiste,
} from '../../src/errores.js';
import { puertoLibre } from '../ayudas/arranque.js';
import { type BaseDePrueba, crearBaseDePrueba } from '../ayudas/bd.js';

// La migración de la spec 004: se crea con `--migrations-dir migraciones`, que le pone la marca de tiempo (plan, Datos).
const DIR_MIGRACIONES = fileURLToPath(new URL('../../migraciones', import.meta.url));
const MIGRACION = readdirSync(DIR_MIGRACIONES)
  .filter((archivo) => /^\d+_perfil-bloqueos\.sql$/.test(archivo))
  .map((archivo) => archivo.slice(0, -'.sql'.length));

// El valor por defecto de M2_TIEMPO_BD_MS: de sobra para la base del contenedor.
const TIEMPO_BD_MS = 2000;

const TABLAS = ['bloqueos_cliente', 'clientes', 'idempotencias'];

// Los códigos de PostgreSQL que esperan las pruebas: los que clasifica `consultar()` (RNF-08.1).
const UNICA = '23505';
const CHECK = '23514';
const CLAVE_FORANEA = '23503';

// UUID distintos para cada prueba: comparten la base y no se pisan.
const nuevoId = () => randomUUID();

// El código de PostgreSQL con el que falla una sentencia, o 'sin error'.
const codigoDe = (consulta: Promise<unknown>) =>
  consulta.then(
    () => 'sin error',
    (error: { code?: string }) => error.code,
  );

// Una consulta con su propia conexión, que cierra al terminar.
async function filas(urlBd: string, sql: string, valores: unknown[] = []): Promise<Record<string, unknown>[]> {
  const cliente = new Client({ connectionString: urlBd });
  await cliente.connect();
  try {
    return (await cliente.query(sql, valores)).rows;
  } finally {
    await cliente.end();
  }
}

const tablas = async (urlBd: string) =>
  (await filas(urlBd, `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`)).map(
    (fila) => fila.tablename,
  );

// Las restricciones de una tabla, por nombre: su tipo (p, f, u, c) y su definición como la escribe PostgreSQL. Sin los
// NOT NULL, que PostgreSQL 18 también guarda en pg_constraint (tipo n): esos los mira `columnasConNulo`.
const restricciones = async (urlBd: string, tabla: string) =>
  Object.fromEntries(
    (
      await filas(
        urlBd,
        `SELECT conname, contype, pg_get_constraintdef(oid) AS definicion FROM pg_constraint
         WHERE conrelid = $1::regclass AND contype <> 'n'`,
        [tabla],
      )
    ).map((fila) => [fila.conname, { tipo: fila.contype, definicion: fila.definicion }]),
  );

// Las columnas de una tabla que aceptan nulo, en orden alfabético.
const columnasConNulo = async (urlBd: string, tabla: string) =>
  (
    await filas(
      urlBd,
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND is_nullable = 'YES' ORDER BY column_name`,
      [tabla],
    )
  ).map((fila) => fila.column_name);

const indices = async (urlBd: string, tabla: string) =>
  (await filas(urlBd, `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1`, [tabla])).map(
    (fila) => String(fila.indexdef),
  );

describe('la migración perfil-bloqueos (RF-2.1.3, RF-2.6.1, RNF-05.1, RNF-08.1)', () => {
  let base: BaseDePrueba;
  let bd: Client;

  const alta = (clienteId: string) =>
    bd.query(`INSERT INTO clientes (cliente_id, nombre, apellido, telefono) VALUES ($1, 'Ana', 'Gómez', '+5493624000000')`, [
      clienteId,
    ]);

  const bloqueo = (clienteId: string, motivo = 'Deuda pendiente') =>
    bd.query(`INSERT INTO bloqueos_cliente (bloqueo_id, cliente_id, motivo, creado_por) VALUES ($1, $2, $3, 'operador-1')`, [
      nuevoId(),
      clienteId,
      motivo,
    ]);

  const idempotencia = (operacion: string, sujeto: string, clienteId: string | null, clave: string) =>
    bd.query(
      `INSERT INTO idempotencias (operacion, sujeto, cliente_id, clave, hash_solicitud) VALUES ($1, $2, $3, $4, 'hash')`,
      [operacion, sujeto, clienteId, clave],
    );

  beforeAll(async () => {
    base = await crearBaseDePrueba();
    await migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });
    bd = new Client({ connectionString: base.urlBd });
    await bd.connect();
  });

  afterAll(async () => {
    await bd?.end();
    await base?.borrar();
  });

  it('está en migraciones/, una sola vez, y no en migrations/ (creada con --migrations-dir migraciones)', () => {
    expect(MIGRACION).toHaveLength(1);
    expect(existsSync(fileURLToPath(new URL('../../migrations', import.meta.url)))).toBe(false);
  });

  it('crea las tablas clientes, bloqueos_cliente e idempotencias', async () => {
    expect(await tablas(base.urlBd)).toEqual(expect.arrayContaining(TABLAS));
  });

  describe('claves y restricciones', () => {
    it('clientes: cliente_id es la clave primaria, y el teléfono tiene el formato E.164 del contrato', async () => {
      expect(await restricciones(base.urlBd, 'clientes')).toEqual({
        clientes_pkey: { tipo: 'p', definicion: 'PRIMARY KEY (cliente_id)' },
        clientes_telefono_e164: { tipo: 'c', definicion: expect.stringContaining("'^\\+[1-9][0-9]{6,14}$'") },
      });
    });

    it('bloqueos_cliente: clave primaria, clave foránea a clientes, motivos no vacíos y levantamiento completo', async () => {
      expect(await restricciones(base.urlBd, 'bloqueos_cliente')).toEqual({
        bloqueos_cliente_pkey: { tipo: 'p', definicion: 'PRIMARY KEY (bloqueo_id)' },
        bloqueos_cliente_cliente_id_fkey: {
          tipo: 'f',
          definicion: 'FOREIGN KEY (cliente_id) REFERENCES clientes(cliente_id)',
        },
        bloqueos_cliente_motivo_no_vacio: { tipo: 'c', definicion: expect.stringContaining('motivo') },
        bloqueos_cliente_motivo_levantamiento_no_vacio: {
          tipo: 'c',
          definicion: expect.stringContaining('motivo_levantamiento'),
        },
        bloqueos_cliente_levantamiento_completo: { tipo: 'c', definicion: expect.stringContaining('levantado_en') },
      });
    });

    it('idempotencias: única con NULLS NOT DISTINCT y crearBloqueo siempre con cliente', async () => {
      expect(await restricciones(base.urlBd, 'idempotencias')).toEqual({
        idempotencias_unica: {
          tipo: 'u',
          definicion: 'UNIQUE NULLS NOT DISTINCT (operacion, sujeto, cliente_id, clave)',
        },
        idempotencias_crear_bloqueo_con_cliente: { tipo: 'c', definicion: expect.stringContaining('crearBloqueo') },
      });
    });

    // Opcionales: la fecha de nacimiento, el fin del bloqueo y su levantamiento (RF-2.6.3); en idempotencias, el cliente de
    // la ruta (nulo en crearCliente) y la respuesta, que se guarda al terminar el alta (plan, Datos).
    it('acepta nulo solo en las columnas opcionales del plan', async () => {
      expect(await columnasConNulo(base.urlBd, 'clientes')).toEqual(['fecha_nacimiento']);
      expect(await columnasConNulo(base.urlBd, 'bloqueos_cliente')).toEqual([
        'hasta',
        'levantado_en',
        'levantado_por',
        'motivo_levantamiento',
      ]);
      expect(await columnasConNulo(base.urlBd, 'idempotencias')).toEqual(['cliente_id', 'estado', 'respuesta', 'ubicacion']);
    });

    it('bloqueos_cliente tiene el índice del historial y el parcial de los bloqueos sin levantar', async () => {
      const definiciones = await indices(base.urlBd, 'bloqueos_cliente');

      expect(definiciones).toContainEqual(expect.stringContaining('(cliente_id, creado_en DESC, bloqueo_id DESC)'));
      expect(definiciones).toContainEqual(expect.stringMatching(/\(cliente_id\) WHERE \(levantado_en IS NULL\)$/));
    });
  });

  describe('lo que la base rechaza o acepta', () => {
    it('rechaza un segundo perfil con el mismo cliente_id (RF-2.1.3)', async () => {
      const clienteId = nuevoId();
      await alta(clienteId);

      expect(await codigoDe(alta(clienteId))).toBe(UNICA);
    });

    it('rechaza un teléfono que no es E.164', async () => {
      const sentencia = bd.query(
        `INSERT INTO clientes (cliente_id, nombre, apellido, telefono) VALUES ($1, 'Ana', 'Gómez', '3624000000')`,
        [nuevoId()],
      );

      expect(await codigoDe(sentencia)).toBe(CHECK);
    });

    it('rechaza un bloqueo de un cliente que no existe y uno con motivo vacío', async () => {
      const clienteId = nuevoId();
      await alta(clienteId);

      expect(await codigoDe(bloqueo(nuevoId()))).toBe(CLAVE_FORANEA);
      expect(await codigoDe(bloqueo(clienteId, ''))).toBe(CHECK);
    });

    it('rechaza un levantamiento incompleto o con motivo vacío, y acepta uno con los tres datos (RF-2.6.3)', async () => {
      const clienteId = nuevoId();
      await alta(clienteId);
      await bloqueo(clienteId);

      const incompleto = bd.query(`UPDATE bloqueos_cliente SET levantado_en = now() WHERE cliente_id = $1`, [clienteId]);
      expect(await codigoDe(incompleto)).toBe(CHECK);

      const sinMotivo = bd.query(
        `UPDATE bloqueos_cliente SET levantado_en = now(), levantado_por = 'operador-2', motivo_levantamiento = ''
         WHERE cliente_id = $1`,
        [clienteId],
      );
      expect(await codigoDe(sinMotivo)).toBe(CHECK);

      const completo = await bd.query(
        `UPDATE bloqueos_cliente SET levantado_en = now(), levantado_por = 'operador-2', motivo_levantamiento = 'Pagó'
         WHERE cliente_id = $1`,
        [clienteId],
      );
      expect(completo.rowCount).toBe(1);
    });

    it('rechaza una idempotencia de crearBloqueo sin el cliente de la ruta', async () => {
      expect(await codigoDe(idempotencia('crearBloqueo', 'operador-1', null, 'clave-sin-cliente'))).toBe(CHECK);
    });

    it('rechaza una segunda idempotencia de crearCliente con el mismo sujeto y clave, aunque cliente_id sea nulo', async () => {
      const sujeto = nuevoId();
      await idempotencia('crearCliente', sujeto, null, 'clave-1');

      expect(await codigoDe(idempotencia('crearCliente', sujeto, null, 'clave-1'))).toBe(UNICA);
    });

    it('acepta la misma clave de crearBloqueo para dos clientes distintos', async () => {
      const [uno, otro] = [nuevoId(), nuevoId()];
      await idempotencia('crearBloqueo', 'operador-1', uno, 'clave-compartida');
      await idempotencia('crearBloqueo', 'operador-1', otro, 'clave-compartida');

      const guardadas = await bd.query(`SELECT cliente_id FROM idempotencias WHERE clave = 'clave-compartida'`);
      expect(guardadas.rows.map((fila) => fila.cliente_id).sort()).toEqual([uno, otro].sort());
    });
  });
});

describe('la migración perfil-bloqueos se revierte (RNF-05.1)', () => {
  let base: BaseDePrueba;

  beforeAll(async () => {
    base = await crearBaseDePrueba();
    await migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });
  });

  afterAll(async () => {
    await base?.borrar();
  });

  it('su Down Migration borra las tres tablas, y se puede volver a aplicar', async () => {
    const cliente = new Client({ connectionString: base.urlBd });
    await cliente.connect();
    try {
      await runner({
        dbClient: cliente,
        dir: DIR_MIGRACIONES,
        migrationsTable: 'migraciones_aplicadas',
        direction: 'down',
        file: MIGRACION[0],
        checkOrder: false,
        log: () => {},
      });
    } finally {
      await cliente.end();
    }

    expect((await tablas(base.urlBd)).filter((tabla) => TABLAS.includes(String(tabla)))).toEqual([]);
    expect(await migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS })).toEqual(MIGRACION);
    expect(await tablas(base.urlBd)).toEqual(expect.arrayContaining(TABLAS));
  });
});

describe('transaccion() sobre la base de la migración (RNF-08.1, RNF-14.2)', () => {
  // Lo que se acepta por encima del tiempo de base: la máquina de CI puede ir lenta.
  const MARGEN_MS = 1000;
  // Node puede disparar un temporizador unos milisegundos antes de lo que mide performance.now().
  const TOLERANCIA_MS = 20;

  let base: BaseDePrueba;
  let pool: PoolBd;

  const alta = (consultar: Consultar, clienteId: string) =>
    consultar(`INSERT INTO clientes (cliente_id, nombre, apellido, telefono) VALUES ($1, 'Ana', 'Gómez', '+5493624000000')`, [
      clienteId,
    ]);

  // Si el perfil quedó guardado, mirado desde otra conexión del pool.
  const existe = async (clienteId: string) =>
    (await pool.consultar('SELECT 1 FROM clientes WHERE cliente_id = $1', [clienteId])).rowCount === 1;

  const fallaCon = (promesa: Promise<unknown>) =>
    promesa.then(
      () => expect.unreachable('la transacción no falló'),
      (error: unknown) => error,
    );

  beforeAll(async () => {
    base = await crearBaseDePrueba();
    await migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });
  });

  afterAll(async () => {
    await base?.borrar();
  });

  // Un pool por prueba, para que las que miran sus conexiones no vean las de otra.
  beforeEach(() => {
    pool = crearPool({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });
  });

  afterEach(async () => {
    await pool.end();
  });

  describe('COMMIT', () => {
    it('guarda lo que hizo la función, devuelve su resultado y suelta la conexión', async () => {
      const [uno, otro] = [nuevoId(), nuevoId()];

      const resultado = await transaccion(pool, async (consultar) => {
        await alta(consultar, uno);
        await alta(consultar, otro);
        return 'listo';
      });

      expect(resultado).toBe('listo');
      expect([await existe(uno), await existe(otro)]).toEqual([true, true]);
      expect(pool.idleCount).toBe(pool.totalCount);
    });

    it('hasta el COMMIT, otra conexión no ve lo que hizo la función', async () => {
      const clienteId = nuevoId();

      await transaccion(pool, async (consultar) => {
        await alta(consultar, clienteId);
        expect(await existe(clienteId)).toBe(false);
      });

      expect(await existe(clienteId)).toBe(true);
    });

    it('la función recibe las filas de sus consultas', async () => {
      const filasDeLaFuncion = await transaccion(pool, async (consultar) =>
        (await consultar<{ n: number }>('SELECT $1::int + 1 AS n', [41])).rows,
      );

      expect(filasDeLaFuncion).toEqual([{ n: 42 }]);
    });
  });

  describe('ROLLBACK', () => {
    it('si la función falla, deshace lo que hizo, relanza su error tal cual y suelta la conexión', async () => {
      const clienteId = nuevoId();
      const propio = new Error('la regla de negocio no se cumple');

      const error = await fallaCon(
        transaccion(pool, async (consultar) => {
          await alta(consultar, clienteId);
          throw propio;
        }),
      );

      expect(error).toBe(propio);
      expect(await existe(clienteId)).toBe(false);
      expect(pool.idleCount).toBe(pool.totalCount);
    });

    it('la conexión vuelve sana: la transacción siguiente sale bien', async () => {
      await fallaCon(
        transaccion(pool, async () => {
          throw new Error('falla');
        }),
      );
      const clienteId = nuevoId();

      await transaccion(pool, (consultar) => alta(consultar, clienteId));

      expect(await existe(clienteId)).toBe(true);
    });
  });

  describe('una restricción única da Conflicto, el 409 (RNF-08.1)', () => {
    it('deshace también lo anterior de la misma transacción', async () => {
      const [existente, nuevo] = [nuevoId(), nuevoId()];
      await transaccion(pool, (consultar) => alta(consultar, existente));

      const error = await fallaCon(
        transaccion(pool, async (consultar) => {
          await alta(consultar, nuevo);
          await alta(consultar, existente);
        }),
      );

      expect(error).toBeInstanceOf(Conflicto);
      expect(await existe(nuevo)).toBe(false);
      expect(pool.idleCount).toBe(pool.totalCount);
    });

    it('dos transacciones a la vez con el mismo cliente: una confirma, la otra da Conflicto (RNF-08)', async () => {
      const clienteId = nuevoId();

      const resultados = await Promise.allSettled([
        transaccion(pool, (consultar) => alta(consultar, clienteId)),
        transaccion(pool, (consultar) => alta(consultar, clienteId)),
      ]);

      expect(resultados.map((resultado) => resultado.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(resultados.find((resultado) => resultado.status === 'rejected')?.reason).toBeInstanceOf(Conflicto);
      const guardados = await pool.consultar('SELECT count(*)::int AS n FROM clientes WHERE cliente_id = $1', [clienteId]);
      expect(guardados.rows).toEqual([{ n: 1 }]);
    });
  });

  describe('otro error de la base sale tal cual, para el 500 (RNF-03.3)', () => {
    it('una tabla que no existe: el error de pg con su código, y la transacción deshecha', async () => {
      const clienteId = nuevoId();

      const error = await fallaCon(
        transaccion(pool, async (consultar) => {
          await alta(consultar, clienteId);
          await consultar('SELECT * FROM tabla_que_no_existe');
        }),
      );

      expect(error).toMatchObject({ code: '42P01' });
      expect(await existe(clienteId)).toBe(false);
      expect(pool.idleCount).toBe(pool.totalCount);
    });
  });

  describe('sin base da BaseNoDisponible, el 503 (RNF-14.2)', () => {
    it('una base que no acepta conexiones: la causa en `cause` y la función sin llamar', async () => {
      const sinBase = crearPool({ urlBd: `postgres://m2:clave@127.0.0.1:${await puertoLibre()}/m2`, tiempoBdMs: TIEMPO_BD_MS });
      const funcion = vi.fn();
      try {
        const error = await fallaCon(transaccion(sinBase, funcion));

        expect(error).toBeInstanceOf(BaseNoDisponible);
        expect((error as Error).cause).toMatchObject({ code: 'ECONNREFUSED' });
        expect(funcion).not.toHaveBeenCalled();
      } finally {
        await sinBase.end();
      }
    });

    // Corta, desde una sesión aparte, las sesiones de esta base que cumplen `donde`, como si la base se reiniciara. Devuelve
    // cuántas cortó.
    const cortarSesiones = async (donde: string) =>
      (
        await filas(
          base.urlBd,
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
           WHERE datname = current_database() AND pid <> pg_backend_pid() AND ${donde}`,
        )
      ).length;

    it('una sentencia en curso que la base corta: BaseNoDisponible con el 57P01, y la transacción deshecha', async () => {
      const clienteId = nuevoId();

      const error = await fallaCon(
        transaccion(pool, async (consultar) => {
          await alta(consultar, clienteId);
          const dormir = consultar('SELECT pg_sleep(10)');
          // El corte la rechaza mientras se espera a `cortarSesiones()`: sin esto, quedaría un rato sin atender.
          dormir.catch(() => {});
          await vi.waitFor(async () => expect(await cortarSesiones(`query LIKE '%pg_sleep%'`)).toBe(1));
          await dormir;
        }),
      );

      expect(error).toBeInstanceOf(BaseNoDisponible);
      expect((error as Error).cause).toMatchObject({ code: '57P01' });
      expect(pool.totalCount).toBe(0);
      expect(await existe(clienteId)).toBe(false);
    });

    // Sin un oyente de 'error' en la conexión prestada, esto tira el proceso: Vitest lo cuenta como error de la corrida.
    it('una transacción que la base corta entre dos sentencias: la siguiente da BaseNoDisponible, y el proceso sigue', async () => {
      const clienteId = nuevoId();

      const error = await fallaCon(
        transaccion(pool, async (consultar) => {
          await alta(consultar, clienteId);
          expect(await cortarSesiones(`state = 'idle in transaction'`)).toBe(1);
          await new Promise((listo) => setTimeout(listo, 100));
          await alta(consultar, nuevoId());
        }),
      );

      expect(error).toBeInstanceOf(BaseNoDisponible);
      expect((error as Error).cause).toMatchObject({ code: '57P01' });
      expect(pool.totalCount).toBe(0);
      expect(await existe(clienteId)).toBe(false);
    });
  });

  describe('cada sentencia tiene el tope del tiempo de base, 2 s por defecto (RNF-14.2)', () => {
    it('una sentencia más lenta da BaseNoDisponible en ese tiempo, con el corte como causa', async () => {
      const clienteId = nuevoId();
      const desde = performance.now();

      const error = await fallaCon(
        transaccion(pool, async (consultar) => {
          await alta(consultar, clienteId);
          await consultar('SELECT pg_sleep(10)');
        }),
      );
      const duracion = performance.now() - desde;

      expect(error).toBeInstanceOf(BaseNoDisponible);
      // Cortan a la vez `conTiempoMaximo` y el query_timeout de pg: la causa es el que llegó primero.
      expect(String((error as Error).cause)).toMatch(new RegExp(`${new TiempoAgotado(TIEMPO_BD_MS).message}|Query read timeout`));
      expect(duracion).toBeGreaterThanOrEqual(TIEMPO_BD_MS - TOLERANCIA_MS);
      expect(duracion).toBeLessThan(TIEMPO_BD_MS + MARGEN_MS);
    });

    // Si la conexión volviera al pool, la consulta cortada la seguiría ocupando: la siguiente esperaría detrás.
    it('descarta la conexión de la sentencia cortada, sin esperar a la base', async () => {
      await fallaCon(transaccion(pool, (consultar) => consultar('SELECT pg_sleep(10)')));

      expect(pool.totalCount).toBe(0);
    });

    // La base no lee el cierre de la conexión hasta terminar la sentencia: sin su propio corte (statement_timeout), la
    // sesión seguiría viva hasta el final de pg_sleep, con la transacción abierta y los bloqueos de sus filas.
    it('la base termina la sentencia cortada poco después, deshace la transacción y suelta sus bloqueos', async () => {
      const clienteId = nuevoId();

      await fallaCon(
        transaccion(pool, async (consultar) => {
          await alta(consultar, clienteId);
          await consultar('SELECT pg_sleep(10)');
        }),
      );

      await vi.waitFor(
        async () =>
          expect(
            await filas(base.urlBd, `SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND query LIKE '%pg_sleep(10)%' AND pid <> pg_backend_pid()`),
          ).toEqual([]),
        { timeout: MARGEN_MS, interval: 50 },
      );
      expect(await existe(clienteId)).toBe(false);
      // Con la fila del perfil todavía bloqueada, este alta esperaría hasta agotar el tiempo de base.
      await transaccion(pool, (consultar) => alta(consultar, clienteId));
      expect(await existe(clienteId)).toBe(true);
    });

    it('el tope es por sentencia, no por transacción: dos sentencias que juntas lo pasan salen bien', async () => {
      const segundos = (TIEMPO_BD_MS * 0.6) / 1000;
      const desde = performance.now();

      await transaccion(pool, async (consultar) => {
        await consultar('SELECT pg_sleep($1)', [segundos]);
        await consultar('SELECT pg_sleep($1)', [segundos]);
      });

      expect(performance.now() - desde).toBeGreaterThan(TIEMPO_BD_MS);
    });
  });
});

describe('conIdempotencia() sobre la base de la migración (RF-2.1, RF-2.6.1, RNF-08)', () => {
  let base: BaseDePrueba;
  let pool: PoolBd;

  beforeAll(async () => {
    base = await crearBaseDePrueba();
    await migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });
    pool = crearPool({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });
  });

  afterAll(async () => {
    await pool?.end();
    await base?.borrar();
  });

  type Perfil = { nombre: string; apellido: string; telefono: string };
  const ANA: Perfil = { nombre: 'Ana', apellido: 'Gómez', telefono: '+5493624000000' };

  // Un alta de perfil como la de crearCliente: el cliente es el sujeto, y la ruta no lleva clienteId.
  const solicitudDePerfil = (sujeto: string, clave: string, cuerpo: Perfil = ANA): SolicitudIdempotente => ({
    operacion: 'crearCliente',
    sujeto,
    clienteId: null,
    clave,
    huella: { cuerpo, parametros: {} },
  });

  const altaDePerfil = (clienteId: string, cuerpo: Perfil = ANA) =>
    vi.fn(async (consultar: Consultar): Promise<RespuestaIdempotente> => {
      const { rows } = await consultar<{ creado_en: Date }>(
        `INSERT INTO clientes (cliente_id, nombre, apellido, telefono) VALUES ($1, $2, $3, $4) RETURNING creado_en`,
        [clienteId, cuerpo.nombre, cuerpo.apellido, cuerpo.telefono],
      );
      return {
        estado: 201,
        ubicacion: `/api/v1/clientes/${clienteId}`,
        cuerpo: { clienteId, ...cuerpo, creadoEn: rows[0]?.creado_en.toISOString() },
      };
    });

  // Un alta de bloqueo como la de crearBloqueo: el sujeto es el operador, y la ruta lleva el cliente.
  const solicitudDeBloqueo = (clienteId: string, clave: string, motivo = 'Deuda pendiente'): SolicitudIdempotente => ({
    operacion: 'crearBloqueo',
    sujeto: 'operador-1',
    clienteId,
    clave,
    huella: { cuerpo: { motivo }, parametros: { clienteId } },
  });

  const altaDeBloqueo = (clienteId: string, motivo = 'Deuda pendiente') =>
    vi.fn(async (consultar: Consultar): Promise<RespuestaIdempotente> => {
      const bloqueoId = nuevoId();
      await consultar(
        `INSERT INTO bloqueos_cliente (bloqueo_id, cliente_id, motivo, creado_por) VALUES ($1, $2, $3, 'operador-1')`,
        [bloqueoId, clienteId, motivo],
      );
      return {
        estado: 201,
        ubicacion: `/api/v1/clientes/${clienteId}/bloqueos/${bloqueoId}`,
        cuerpo: { bloqueoId, motivo },
      };
    });

  const cuantos = async (tabla: 'clientes' | 'bloqueos_cliente', clienteId: string) =>
    (await pool.consultar<{ n: number }>(`SELECT count(*)::int AS n FROM ${tabla} WHERE cliente_id = $1`, [clienteId]))
      .rows[0]?.n;

  const fallaCon = (promesa: Promise<unknown>) =>
    promesa.then(
      () => expect.unreachable('el alta no falló'),
      (error: unknown) => error,
    );

  // Un perfil ya creado, sin idempotencia: el cliente de los bloqueos.
  async function clienteExistente(): Promise<string> {
    const clienteId = nuevoId();
    await altaDePerfil(clienteId)((sql, parametros) => pool.consultar(sql, parametros));
    return clienteId;
  }

  describe('la primera vez', () => {
    it('ejecuta el alta una vez, devuelve su respuesta y la guarda con la huella, en la misma transacción', async () => {
      const clienteId = nuevoId();
      const alta = altaDePerfil(clienteId);

      const respuesta = await conIdempotencia(pool, solicitudDePerfil(clienteId, 'clave-1'), alta);

      expect(alta).toHaveBeenCalledTimes(1);
      expect(respuesta).toEqual({
        estado: 201,
        ubicacion: `/api/v1/clientes/${clienteId}`,
        cuerpo: expect.objectContaining({ clienteId, nombre: 'Ana' }),
      });
      const guardadas = await pool.consultar(
        `SELECT operacion, sujeto, cliente_id, clave, hash_solicitud, estado, ubicacion, respuesta FROM idempotencias
         WHERE sujeto = $1`,
        [clienteId],
      );
      expect(guardadas.rows).toEqual([
        {
          operacion: 'crearCliente',
          sujeto: clienteId,
          cliente_id: null,
          clave: 'clave-1',
          hash_solicitud: expect.stringMatching(/^[0-9a-f]{64}$/),
          estado: 201,
          ubicacion: respuesta.ubicacion,
          respuesta: respuesta.cuerpo,
        },
      ]);
    });

    it('si el alta falla, no queda la reserva: la misma clave vuelve a ejecutarla', async () => {
      const clienteId = nuevoId();
      const propio = new Error('la regla de negocio no se cumple');
      const fallida = vi.fn(async (consultar: Consultar) => {
        await altaDePerfil(clienteId)(consultar);
        throw propio;
      });

      expect(await fallaCon(conIdempotencia(pool, solicitudDePerfil(clienteId, 'clave-1'), fallida))).toBe(propio);
      expect(await cuantos('clientes', clienteId)).toBe(0);

      const alta = altaDePerfil(clienteId);
      await conIdempotencia(pool, solicitudDePerfil(clienteId, 'clave-1'), alta);
      expect(alta).toHaveBeenCalledTimes(1);
      expect(await cuantos('clientes', clienteId)).toBe(1);
    });
  });

  describe('la misma solicitud repetida (RNF-08)', () => {
    it('devuelve la respuesta guardada sin repetir el alta', async () => {
      const clienteId = nuevoId();
      const primera = await conIdempotencia(pool, solicitudDePerfil(clienteId, 'clave-1'), altaDePerfil(clienteId));
      const alta = altaDePerfil(clienteId);

      const segunda = await conIdempotencia(pool, solicitudDePerfil(clienteId, 'clave-1'), alta);

      expect(alta).not.toHaveBeenCalled();
      expect(segunda).toEqual(primera);
      expect(await cuantos('clientes', clienteId)).toBe(1);
    });

    it('el mismo cuerpo con los campos en otro orden es la misma solicitud', async () => {
      const clienteId = nuevoId();
      const primera = await conIdempotencia(pool, solicitudDePerfil(clienteId, 'clave-1'), altaDePerfil(clienteId));
      const desordenado = { telefono: ANA.telefono, apellido: ANA.apellido, nombre: ANA.nombre };

      const segunda = await conIdempotencia(pool, solicitudDePerfil(clienteId, 'clave-1', desordenado), altaDePerfil(clienteId));

      expect(segunda).toEqual(primera);
    });

    it('cinco a la vez: un solo efecto, y las cinco reciben la misma respuesta', async () => {
      const clienteId = nuevoId();
      const altas = Array.from({ length: 5 }, () => altaDePerfil(clienteId));

      const respuestas = await Promise.all(
        altas.map((alta) => conIdempotencia(pool, solicitudDePerfil(clienteId, 'clave-1'), alta)),
      );

      expect(altas.reduce((veces, alta) => veces + alta.mock.calls.length, 0)).toBe(1);
      expect(new Set(respuestas.map((respuesta) => JSON.stringify(respuesta))).size).toBe(1);
      expect(respuestas[0]?.estado).toBe(201);
      expect(await cuantos('clientes', clienteId)).toBe(1);
    });
  });

  describe('la misma clave con otra solicitud da IdempotenciaReutilizada, el 422', () => {
    it('otro cuerpo: 422 con su tipo, sin ejecutar el alta ni tocar la respuesta guardada', async () => {
      const clienteId = nuevoId();
      const primera = await conIdempotencia(pool, solicitudDePerfil(clienteId, 'clave-1'), altaDePerfil(clienteId));
      const otro = { ...ANA, nombre: 'Beatriz' };
      const alta = altaDePerfil(clienteId, otro);

      const error = await fallaCon(conIdempotencia(pool, solicitudDePerfil(clienteId, 'clave-1', otro), alta));

      expect(error).toBeInstanceOf(IdempotenciaReutilizada);
      expect(error).toMatchObject({ codigo: 422, type: '/errores/idempotencia-reutilizada' });
      expect(alta).not.toHaveBeenCalled();
      expect(await conIdempotencia(pool, solicitudDePerfil(clienteId, 'clave-1'), altaDePerfil(clienteId))).toEqual(primera);
    });

    it('dos cuerpos distintos a la vez con la misma clave: uno sale, el otro da 422, y hay un solo efecto', async () => {
      const clienteId = nuevoId();
      const otro = { ...ANA, nombre: 'Beatriz' };

      const resultados = await Promise.allSettled([
        conIdempotencia(pool, solicitudDePerfil(clienteId, 'clave-1'), altaDePerfil(clienteId)),
        conIdempotencia(pool, solicitudDePerfil(clienteId, 'clave-1', otro), altaDePerfil(clienteId, otro)),
      ]);

      expect(resultados.map((resultado) => resultado.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(resultados.find((resultado) => resultado.status === 'rejected')?.reason).toBeInstanceOf(IdempotenciaReutilizada);
      expect(await cuantos('clientes', clienteId)).toBe(1);
    });
  });

  describe('lo que no es la misma solicitud', () => {
    it('la misma clave para otro clienteId crea el segundo bloqueo, con su propia respuesta (RF-2.6.1)', async () => {
      const [uno, otro] = [await clienteExistente(), await clienteExistente()];

      const primera = await conIdempotencia(pool, solicitudDeBloqueo(uno, 'clave-compartida'), altaDeBloqueo(uno));
      const segunda = await conIdempotencia(pool, solicitudDeBloqueo(otro, 'clave-compartida'), altaDeBloqueo(otro));

      expect(segunda.ubicacion).not.toBe(primera.ubicacion);
      expect(segunda.ubicacion).toContain(otro);
      expect([await cuantos('bloqueos_cliente', uno), await cuantos('bloqueos_cliente', otro)]).toEqual([1, 1]);
    });

    it('la misma clave de otro sujeto es otra solicitud', async () => {
      const clienteId = await clienteExistente();
      const deOtroOperador = { ...solicitudDeBloqueo(clienteId, 'clave-1'), sujeto: 'operador-2' };

      await conIdempotencia(pool, solicitudDeBloqueo(clienteId, 'clave-1'), altaDeBloqueo(clienteId));
      const alta = altaDeBloqueo(clienteId);
      await conIdempotencia(pool, deOtroOperador, alta);

      expect(alta).toHaveBeenCalledTimes(1);
      expect(await cuantos('bloqueos_cliente', clienteId)).toBe(2);
    });

    it('dos claves distintas para el mismo perfil a la vez: la restricción única deja uno, y el otro da Conflicto', async () => {
      const clienteId = nuevoId();

      const resultados = await Promise.allSettled([
        conIdempotencia(pool, solicitudDePerfil(clienteId, 'clave-1'), altaDePerfil(clienteId)),
        conIdempotencia(pool, solicitudDePerfil(clienteId, 'clave-2'), altaDePerfil(clienteId)),
      ]);

      expect(resultados.map((resultado) => resultado.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(resultados.find((resultado) => resultado.status === 'rejected')?.reason).toBeInstanceOf(Conflicto);
      expect(await cuantos('clientes', clienteId)).toBe(1);
      const reservas = await pool.consultar('SELECT clave FROM idempotencias WHERE sujeto = $1', [clienteId]);
      expect(reservas.rowCount).toBe(1);
    });
  });
});

describe('el repositorio de perfiles (RF-2.1, RF-2.1.1, RF-2.1.2, RF-2.1.3, RF-2.1.3.1, RNF-08)', () => {
  let base: BaseDePrueba;
  let pool: PoolBd;

  const consultar: Consultar = (sql, parametros) => pool.consultar(sql, parametros);

  const SIN_FECHA = { nombre: 'Ana', apellido: 'Gómez', telefono: '+5493624000000' };
  const ANA = { ...SIN_FECHA, fechaNacimiento: '1990-05-17' };

  const fallaCon = (promesa: Promise<unknown>) =>
    promesa.then(
      () => expect.unreachable('no falló'),
      (error: unknown) => error,
    );

  const bloquear = (clienteId: string, columnas: string, valores: string) =>
    pool.consultar(
      `INSERT INTO bloqueos_cliente (bloqueo_id, cliente_id, motivo, creado_por, ${columnas})
       VALUES ($1, $2, 'Deuda pendiente', 'operador-1', ${valores})`,
      [nuevoId(), clienteId],
    );

  beforeAll(async () => {
    base = await crearBaseDePrueba();
    await migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });
    pool = crearPool({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });
  });

  afterAll(async () => {
    await pool?.end();
    await base?.borrar();
  });

  describe('crearPerfil', () => {
    it('guarda el perfil con el clienteId dado y lo devuelve en la forma del contrato, ACTIVO', async () => {
      const clienteId = nuevoId();

      const perfil = await crearPerfil(consultar, clienteId, ANA);

      expect(perfil).toEqual({
        clienteId,
        ...ANA,
        estado: 'ACTIVO',
        creadoEn: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z$/),
        actualizadoEn: perfil.creadoEn,
      });
      expect(await obtenerPerfil(consultar, clienteId)).toEqual(perfil);
    });

    it('la fecha de nacimiento es opcional: sin ella, el perfil no tiene el campo', async () => {
      const perfil = await crearPerfil(consultar, nuevoId(), SIN_FECHA);

      expect(perfil).not.toHaveProperty('fechaNacimiento');
    });

    it('la fecha de nacimiento vuelve igual a la que se guardó, sea cual sea la zona horaria del proceso', async () => {
      const clienteId = nuevoId();
      const zona = process.env.TZ;
      process.env.TZ = 'America/Argentina/Buenos_Aires';
      try {
        await crearPerfil(consultar, clienteId, { ...ANA, fechaNacimiento: '2000-01-01' });
        expect((await obtenerPerfil(consultar, clienteId)).fechaNacimiento).toBe('2000-01-01');
      } finally {
        if (zona === undefined) delete process.env.TZ;
        else process.env.TZ = zona;
      }
    });

    it('un segundo perfil para el mismo clienteId da PerfilYaExiste y deja el primero intacto (RF-2.1.3)', async () => {
      const clienteId = nuevoId();
      const primero = await crearPerfil(consultar, clienteId, ANA);

      const error = await fallaCon(crearPerfil(consultar, clienteId, { ...ANA, nombre: 'Beatriz' }));

      expect(error).toBeInstanceOf(PerfilYaExiste);
      expect(await obtenerPerfil(consultar, clienteId)).toEqual(primero);
    });

    it('dos altas a la vez para el mismo clienteId: una crea, la otra da PerfilYaExiste, y queda una sola fila (RNF-08)', async () => {
      const clienteId = nuevoId();

      const resultados = await Promise.allSettled([
        crearPerfil(consultar, clienteId, ANA),
        crearPerfil(consultar, clienteId, { ...ANA, nombre: 'Beatriz' }),
      ]);

      expect(resultados.map((resultado) => resultado.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(resultados.find((resultado) => resultado.status === 'rejected')?.reason).toBeInstanceOf(PerfilYaExiste);
      const guardados = await pool.consultar('SELECT count(*)::int AS n FROM clientes WHERE cliente_id = $1', [clienteId]);
      expect(guardados.rows).toEqual([{ n: 1 }]);
    });

    it('dentro de una transacción, un perfil repetido no la aborta: la función puede seguir consultando', async () => {
      const clienteId = nuevoId();
      await crearPerfil(consultar, clienteId, ANA);

      const perfil = await transaccion(pool, async (enTransaccion) => {
        await fallaCon(crearPerfil(enTransaccion, clienteId, ANA));
        return obtenerPerfil(enTransaccion, clienteId);
      });

      expect(perfil.clienteId).toBe(clienteId);
    });
  });

  describe('obtenerPerfil', () => {
    it('un clienteId sin perfil da NoEncontrado, el 404 (RF-2.1.3.1)', async () => {
      const error = await fallaCon(obtenerPerfil(consultar, nuevoId()));

      expect(error).toBeInstanceOf(NoEncontrado);
      expect(error).toMatchObject({ codigo: 404, detail: 'No existe el cliente pedido' });
    });
  });

  describe('el estado del perfil sale de sus bloqueos (plan, «Estado y vigencia»)', () => {
    it('BLOQUEADO con un bloqueo sin levantar y sin vencer; ACTIVO con uno levantado o uno vencido', async () => {
      const [vigente, levantado, vencido] = [nuevoId(), nuevoId(), nuevoId()];
      for (const clienteId of [vigente, levantado, vencido]) await crearPerfil(consultar, clienteId, ANA);
      await bloquear(vigente, 'hasta', `now() + interval '1 day'`);
      await bloquear(levantado, 'levantado_en, levantado_por, motivo_levantamiento', `now(), 'operador-2', 'Pagó'`);
      await bloquear(vencido, 'hasta', `now() - interval '1 second'`);

      const estados = await Promise.all([vigente, levantado, vencido].map((id) => obtenerPerfil(consultar, id)));

      expect(estados.map((perfil) => perfil.estado)).toEqual(['BLOQUEADO', 'ACTIVO', 'ACTIVO']);
    });
  });

  describe('obtenerEstadoCuenta (RF-2.6, RF-2.6.4)', () => {
    // Un bloqueo con las marcas que pide cada caso; `hasta` y `creado_en` son expresiones SQL.
    const poner = async (
      clienteId: string,
      motivo: string,
      { hasta = 'NULL', creadoEn = 'clock_timestamp()', levantado = false } = {},
    ) => {
      const bloqueoId = nuevoId();
      await pool.consultar(
        `INSERT INTO bloqueos_cliente (bloqueo_id, cliente_id, motivo, creado_por, hasta, creado_en,
           levantado_en, levantado_por, motivo_levantamiento)
         VALUES ($1, $2, $3, 'operador-1', ${hasta}, ${creadoEn}, ${levantado ? 'now()' : 'NULL'},
           ${levantado ? `'operador-2'` : 'NULL'}, ${levantado ? `'Pagó'` : 'NULL'})`,
        [bloqueoId, clienteId, motivo],
      );
      return bloqueoId;
    };
    const conPerfil = async () => {
      const clienteId = nuevoId();
      await crearPerfil(consultar, clienteId, ANA);
      return clienteId;
    };
    const motivos = (cuenta: Awaited<ReturnType<typeof obtenerEstadoCuenta>>) => cuenta.bloqueosVigentes.map((b) => b.motivo);

    it('sin bloqueos: ACTIVO y ninguno vigente', async () => {
      const clienteId = await conPerfil();

      expect(await obtenerEstadoCuenta(consultar, clienteId)).toEqual({ clienteId, estado: 'ACTIVO', bloqueosVigentes: [] });
    });

    it('un bloqueo indefinido (sin hasta) es vigente: BLOQUEADO, con sus campos del contrato', async () => {
      const clienteId = await conPerfil();
      const bloqueoId = await poner(clienteId, 'Indefinido');

      const cuenta = await obtenerEstadoCuenta(consultar, clienteId);

      expect(cuenta.estado).toBe('BLOQUEADO');
      expect(cuenta.bloqueosVigentes).toEqual([
        {
          bloqueoId,
          motivo: 'Indefinido',
          vigente: true,
          desde: expect.any(String),
          creadoEn: expect.any(String),
          creadoPor: 'operador-1',
        },
      ]);
      expect(cuenta.bloqueosVigentes[0]?.desde).toBe(cuenta.bloqueosVigentes[0]?.creadoEn);
    });

    it('uno con fin futuro es vigente y muestra su hasta', async () => {
      const clienteId = await conPerfil();
      await poner(clienteId, 'Futuro', { hasta: `now() + interval '1 day'` });

      const cuenta = await obtenerEstadoCuenta(consultar, clienteId);

      expect(cuenta.estado).toBe('BLOQUEADO');
      expect(cuenta.bloqueosVigentes[0]).toMatchObject({ motivo: 'Futuro', vigente: true, hasta: expect.any(String) });
    });

    it('uno vencido no es vigente: ACTIVO, aunque la fila siga en el historial', async () => {
      const clienteId = await conPerfil();
      await poner(clienteId, 'Vencido', { hasta: `now() - interval '1 second'` });

      expect(await obtenerEstadoCuenta(consultar, clienteId)).toEqual({ clienteId, estado: 'ACTIVO', bloqueosVigentes: [] });
      expect((await pool.consultar('SELECT 1 FROM bloqueos_cliente WHERE cliente_id = $1', [clienteId])).rowCount).toBe(1);
    });

    it('uno levantado no es vigente aunque su hasta sea futuro o no exista: ACTIVO', async () => {
      const clienteId = await conPerfil();
      await poner(clienteId, 'Levantado sin fin', { levantado: true });
      await poner(clienteId, 'Levantado con fin', { levantado: true, hasta: `now() + interval '1 day'` });

      expect((await obtenerEstadoCuenta(consultar, clienteId)).estado).toBe('ACTIVO');
    });

    it('varios vigentes a la vez: BLOQUEADO con todos, del más nuevo al más antiguo, y sin los que no lo son', async () => {
      const clienteId = await conPerfil();
      await poner(clienteId, 'Viejo indefinido', { creadoEn: `now() - interval '3 hours'` });
      await poner(clienteId, 'Medio futuro', { creadoEn: `now() - interval '2 hours'`, hasta: `now() + interval '1 day'` });
      await poner(clienteId, 'Vencido', { creadoEn: `now() - interval '90 minutes'`, hasta: `now() - interval '1 hour'` });
      await poner(clienteId, 'Levantado', { creadoEn: `now() - interval '80 minutes'`, levantado: true });
      await poner(clienteId, 'Nuevo indefinido', { creadoEn: `now() - interval '1 hour'` });

      const cuenta = await obtenerEstadoCuenta(consultar, clienteId);

      expect(cuenta.estado).toBe('BLOQUEADO');
      expect(motivos(cuenta)).toEqual(['Nuevo indefinido', 'Medio futuro', 'Viejo indefinido']);
    });

    it('levantar uno de dos no activa la cuenta; levantar el último sí', async () => {
      const clienteId = await conPerfil();
      const primero = await poner(clienteId, 'Primero');
      const segundo = await poner(clienteId, 'Segundo');
      const levantar = (bloqueoId: string) =>
        pool.consultar(
          `UPDATE bloqueos_cliente SET levantado_en = now(), levantado_por = 'operador-2', motivo_levantamiento = 'Pagó'
           WHERE bloqueo_id = $1`,
          [bloqueoId],
        );

      await levantar(primero);
      const conUno = await obtenerEstadoCuenta(consultar, clienteId);
      await levantar(segundo);
      const sinNinguno = await obtenerEstadoCuenta(consultar, clienteId);

      expect([conUno.estado, motivos(conUno)]).toEqual(['BLOQUEADO', ['Segundo']]);
      expect([sinNinguno.estado, sinNinguno.bloqueosVigentes]).toEqual(['ACTIVO', []]);
    });

    it('un bloqueo que vence solo deja de contar, sin que nadie lo levante (RF-2.6.4)', async () => {
      const clienteId = await conPerfil();
      await poner(clienteId, 'Corto', { hasta: `now() + interval '700 milliseconds'` });

      const antes = await obtenerEstadoCuenta(consultar, clienteId);
      await new Promise((resolver) => setTimeout(resolver, 1000));
      const despues = await obtenerEstadoCuenta(consultar, clienteId);

      expect([antes.estado, despues.estado]).toEqual(['BLOQUEADO', 'ACTIVO']);
      const [fila] = (await pool.consultar('SELECT levantado_en FROM bloqueos_cliente WHERE cliente_id = $1', [clienteId])).rows;
      expect(fila).toEqual({ levantado_en: null });
    });

    it('los bloqueos de otro cliente no cuentan', async () => {
      const [uno, otro] = [await conPerfil(), await conPerfil()];
      await poner(otro, 'Del otro');

      expect((await obtenerEstadoCuenta(consultar, uno)).estado).toBe('ACTIVO');
      expect(motivos(await obtenerEstadoCuenta(consultar, otro))).toEqual(['Del otro']);
    });

    it('estado y bloqueosVigentes coinciden entre sí y con el estado del perfil, en cada caso', async () => {
      const casos: [string, (clienteId: string) => Promise<unknown>][] = [
        ['sin bloqueos', async () => {}],
        ['indefinido', (id) => poner(id, 'a')],
        ['futuro', (id) => poner(id, 'a', { hasta: `now() + interval '1 day'` })],
        ['vencido', (id) => poner(id, 'a', { hasta: `now() - interval '1 second'` })],
        ['levantado', (id) => poner(id, 'a', { levantado: true })],
        ['dos vigentes', async (id) => (await poner(id, 'a'), await poner(id, 'b'))],
      ];
      for (const [, preparar] of casos) {
        const clienteId = await conPerfil();
        await preparar(clienteId);

        const cuenta = await obtenerEstadoCuenta(consultar, clienteId);

        expect(cuenta.estado === 'BLOQUEADO').toBe(cuenta.bloqueosVigentes.length > 0);
        expect(cuenta.estado).toBe((await obtenerPerfil(consultar, clienteId)).estado);
      }
    });

    it('con bloqueos que entran y vencen mientras se lee, ninguna lectura se contradice', async () => {
      const clienteId = await conPerfil();

      const lecturas = await Promise.all(
        Array.from({ length: 40 }, async (_, i) => {
          if (i % 2 === 0) await poner(clienteId, `b${i}`, { hasta: `now() + interval '${i * 20} milliseconds'` });
          return obtenerEstadoCuenta(consultar, clienteId);
        }),
      );

      for (const cuenta of lecturas) {
        expect(cuenta.estado === 'BLOQUEADO').toBe(cuenta.bloqueosVigentes.length > 0);
        expect(cuenta.bloqueosVigentes.every((bloqueo) => bloqueo.vigente)).toBe(true);
      }
    });

    it('un cliente sin perfil da NoEncontrado, el 404, aunque tenga filas de otros', async () => {
      const error = await fallaCon(obtenerEstadoCuenta(consultar, nuevoId()));

      expect(error).toBeInstanceOf(NoEncontrado);
      expect(error).toMatchObject({ codigo: 404, detail: 'No existe el cliente pedido' });
    });
  });

  describe('crearBloqueo (RF-2.6.1)', () => {
    const conPerfil = async () => {
      const clienteId = nuevoId();
      await crearPerfil(consultar, clienteId, ANA);
      return clienteId;
    };

    it('crea el bloqueo vigente del contrato, con el autor y desde igual a creadoEn', async () => {
      const [clienteId, bloqueoId] = [await conPerfil(), nuevoId()];

      const bloqueo = await crearBloqueo(consultar, clienteId, bloqueoId, { motivo: 'Deuda pendiente' }, 'operador-7');

      expect(bloqueo).toEqual({
        bloqueoId,
        motivo: 'Deuda pendiente',
        vigente: true,
        desde: expect.any(String),
        creadoEn: expect.any(String),
        creadoPor: 'operador-7',
      });
      expect(bloqueo.desde).toBe(bloqueo.creadoEn);
      expect(await obtenerBloqueo(consultar, clienteId, bloqueoId)).toEqual(bloqueo);
      expect((await obtenerEstadoCuenta(consultar, clienteId)).estado).toBe('BLOQUEADO');
    });

    it('con hasta futura la guarda, en cualquier zona horaria que llegue', async () => {
      const clienteId = await conPerfil();

      const bloqueo = await crearBloqueo(
        consultar,
        clienteId,
        nuevoId(),
        { motivo: 'Temporal', hasta: '2099-01-01T05:30:00+05:30' },
        'operador-1',
      );

      expect(bloqueo).toMatchObject({ vigente: true, hasta: '2099-01-01T00:00:00.000Z' });
    });

    it('con hasta igual o anterior a la creación: BloqueoVencido (422) y no crea nada (spec 004, Casos límite)', async () => {
      const clienteId = await conPerfil();

      for (const hasta of ['2020-01-01T00:00:00Z', new Date().toISOString()]) {
        const error = await fallaCon(crearBloqueo(consultar, clienteId, nuevoId(), { motivo: 'x', hasta }, 'operador-1'));

        expect(error).toBeInstanceOf(BloqueoVencido);
      }
      expect((await pool.consultar('SELECT 1 FROM bloqueos_cliente WHERE cliente_id = $1', [clienteId])).rowCount).toBe(0);
    });

    it('para un cliente sin perfil: NoEncontrado (404), antes de mirar la fecha', async () => {
      const error = await fallaCon(
        crearBloqueo(consultar, nuevoId(), nuevoId(), { motivo: 'x', hasta: '2020-01-01T00:00:00Z' }, 'operador-1'),
      );

      expect(error).toBeInstanceOf(NoEncontrado);
      expect(error).toMatchObject({ detail: 'No existe el cliente pedido' });
    });

    it('dentro de una transacción, un rechazo no la deja abortada', async () => {
      const clienteId = await conPerfil();

      const despues = await transaccion(pool, async (enTransaccion) => {
        await fallaCon(crearBloqueo(enTransaccion, clienteId, nuevoId(), { motivo: 'x', hasta: '2020-01-01T00:00:00Z' }, 'o'));
        return crearBloqueo(enTransaccion, clienteId, nuevoId(), { motivo: 'Sigue' }, 'o');
      });

      expect(despues.motivo).toBe('Sigue');
    });
  });

  describe('obtenerBloqueo (RF-2.6.2)', () => {
    it('un bloqueo de otro cliente, o uno que no existe, es NoEncontrado (spec 004, Casos límite)', async () => {
      const [uno, otro, bloqueoId] = [nuevoId(), nuevoId(), nuevoId()];
      await crearPerfil(consultar, uno, ANA);
      await crearPerfil(consultar, otro, ANA);
      await crearBloqueo(consultar, otro, bloqueoId, { motivo: 'Del otro' }, 'operador-1');

      for (const [clienteId, id] of [[uno, bloqueoId], [otro, nuevoId()], [nuevoId(), bloqueoId]]) {
        const error = await fallaCon(obtenerBloqueo(consultar, clienteId as string, id as string));

        expect(error).toBeInstanceOf(NoEncontrado);
        expect(error).toMatchObject({ detail: 'No existe el bloqueo pedido' });
      }
    });

    it('un bloqueo vencido o levantado se sigue pudiendo consultar, con vigente en false', async () => {
      const clienteId = nuevoId();
      await crearPerfil(consultar, clienteId, ANA);
      const [vencido, levantado] = [nuevoId(), nuevoId()];
      await pool.consultar(
        `INSERT INTO bloqueos_cliente (bloqueo_id, cliente_id, motivo, creado_por, hasta, creado_en)
         VALUES ($1, $2, 'Vencido', 'o', now() - interval '1 hour', now() - interval '2 hours')`,
        [vencido, clienteId],
      );
      await pool.consultar(
        `INSERT INTO bloqueos_cliente (bloqueo_id, cliente_id, motivo, creado_por, levantado_en, levantado_por, motivo_levantamiento)
         VALUES ($1, $2, 'Levantado', 'o', now(), 'operador-2', 'Pagó')`,
        [levantado, clienteId],
      );

      expect(await obtenerBloqueo(consultar, clienteId, vencido)).toMatchObject({ vigente: false, hasta: expect.any(String) });
      expect(await obtenerBloqueo(consultar, clienteId, levantado)).toMatchObject({
        vigente: false,
        levantadoPor: 'operador-2',
        motivoLevantamiento: 'Pagó',
      });
    });
  });

  describe('listarBloqueos (RF-2.6.2)', () => {
    // Un cliente con cinco bloqueos de creación conocida: dos vigentes, uno vencido, uno levantado y uno vigente con la misma
    // creación que otro, para el desempate por bloqueoId.
    const conHistorial = async () => {
      const clienteId = nuevoId();
      await crearPerfil(consultar, clienteId, ANA);
      // `creadoEn` es un intervalo desde el 1 de enero de 2026; `hasta`, una expresión SQL.
      const poner = async (motivo: string, creadoEn: string, { hasta = 'NULL', levantado = false, bloqueoId = nuevoId() } = {}) =>
        pool.consultar(
          `INSERT INTO bloqueos_cliente (bloqueo_id, cliente_id, motivo, creado_por, creado_en, hasta,
             levantado_en, levantado_por, motivo_levantamiento)
           VALUES ($1, $2, $3, 'o', '2026-01-01T00:00:00Z'::timestamptz + $4::interval, ${hasta},
             ${levantado ? `now(), 'operador-2', 'Pagó'` : 'NULL, NULL, NULL'})`,
          [bloqueoId, clienteId, motivo, creadoEn],
        );
      // Los dos de la misma creación: el de bloqueoId mayor va primero.
      const [menor, mayor] = [nuevoId(), nuevoId()].sort();
      await poner('Primero', '1 hour');
      await poner('Vencido', '2 hours', { hasta: `now() - interval '1 second'` });
      await poner('Levantado', '3 hours', { levantado: true });
      await poner('Empate menor', '4 hours', { bloqueoId: menor });
      await poner('Empate mayor', '4 hours', { bloqueoId: mayor });
      return clienteId;
    };
    const motivos = (pagina: Awaited<ReturnType<typeof listarBloqueos>>) => pagina.items.map((b) => b.motivo);

    it('todo el historial, del más nuevo al más antiguo, con desempate estable por bloqueoId', async () => {
      const clienteId = await conHistorial();

      const pagina = await listarBloqueos(consultar, clienteId, { page: 0, size: 20 });

      expect(motivos(pagina)).toEqual(['Empate mayor', 'Empate menor', 'Levantado', 'Vencido', 'Primero']);
      expect(pagina).toMatchObject({ page: 0, size: 20, totalElementos: 5, totalPaginas: 1 });
      expect(pagina.items.map((b) => b.vigente)).toEqual([true, true, false, false, true]);
    });

    it('vigente=true deja solo los vigentes, y vigente=false los vencidos y levantados, con sus totales', async () => {
      const clienteId = await conHistorial();

      const vigentes = await listarBloqueos(consultar, clienteId, { vigente: true, page: 0, size: 20 });
      const noVigentes = await listarBloqueos(consultar, clienteId, { vigente: false, page: 0, size: 20 });

      expect([motivos(vigentes), vigentes.totalElementos]).toEqual([['Empate mayor', 'Empate menor', 'Primero'], 3]);
      expect([motivos(noVigentes), noVigentes.totalElementos]).toEqual([['Levantado', 'Vencido'], 2]);
    });

    it('las páginas recorren el historial sin repetir ni saltear, y la última puede quedar corta', async () => {
      const clienteId = await conHistorial();

      const paginas = await Promise.all([0, 1, 2].map((page) => listarBloqueos(consultar, clienteId, { page, size: 2 })));

      expect(paginas.map(motivos)).toEqual([['Empate mayor', 'Empate menor'], ['Levantado', 'Vencido'], ['Primero']]);
      expect(paginas.map((p) => [p.totalElementos, p.totalPaginas])).toEqual([[5, 3], [5, 3], [5, 3]]);
    });

    it('una página fuera del total: items vacío y los totales correctos (spec 004, Casos límite)', async () => {
      const clienteId = await conHistorial();

      expect(await listarBloqueos(consultar, clienteId, { page: 9, size: 2 })).toEqual({
        page: 9,
        size: 2,
        totalElementos: 5,
        totalPaginas: 3,
        items: [],
      });
    });

    it('una página enorme no rompe la consulta: items vacío', async () => {
      const clienteId = await conHistorial();

      const pagina = await listarBloqueos(consultar, clienteId, { page: 1e23, size: 100 });

      expect([pagina.items, pagina.totalElementos]).toEqual([[], 5]);
    });

    it('un cliente con perfil y sin bloqueos: página vacía con totales en 0', async () => {
      const clienteId = nuevoId();
      await crearPerfil(consultar, clienteId, ANA);

      expect(await listarBloqueos(consultar, clienteId, { page: 0, size: 20 })).toEqual({
        page: 0,
        size: 20,
        totalElementos: 0,
        totalPaginas: 0,
        items: [],
      });
    });

    it('un cliente sin perfil: NoEncontrado (404)', async () => {
      const error = await fallaCon(listarBloqueos(consultar, nuevoId(), { page: 0, size: 20 }));

      expect(error).toBeInstanceOf(NoEncontrado);
      expect(error).toMatchObject({ detail: 'No existe el cliente pedido' });
    });

    it('no trae bloqueos de otro cliente', async () => {
      const [uno, otro] = [await conHistorial(), await conHistorial()];

      const pagina = await listarBloqueos(consultar, uno, { page: 0, size: 100 });

      expect(pagina.totalElementos).toBe(5);
      const deOtro = await listarBloqueos(consultar, otro, { page: 0, size: 100 });
      const ids = new Set(deOtro.items.map((b) => b.bloqueoId));
      expect(pagina.items.some((b) => ids.has(b.bloqueoId))).toBe(false);
    });
  });

  describe('levantarBloqueo (RF-2.6.3, RF-2.6.3.1, RF-2.6.4)', () => {
    const conPerfil = async () => {
      const clienteId = nuevoId();
      await crearPerfil(consultar, clienteId, ANA);
      return clienteId;
    };
    // Un bloqueo vigente recién creado por 'operador-1'.
    const conBloqueo = async (clienteId: string, datos: { motivo: string; hasta?: string } = { motivo: 'Deuda pendiente' }) =>
      (await crearBloqueo(consultar, clienteId, nuevoId(), datos, 'operador-1')).bloqueoId;
    // La fila tal como está guardada, para ver que un rechazo no la tocó.
    const fila = async (bloqueoId: string) =>
      (await pool.consultar('SELECT * FROM bloqueos_cliente WHERE bloqueo_id = $1', [bloqueoId])).rows[0];

    it('guarda juntos autor, instante y motivo, y devuelve el bloqueo ya no vigente con el resto intacto', async () => {
      const clienteId = await conPerfil();
      const bloqueoId = await conBloqueo(clienteId, { motivo: 'Deuda pendiente', hasta: '2099-01-01T00:00:00Z' });
      const antes = await obtenerBloqueo(consultar, clienteId, bloqueoId);

      const levantado = await levantarBloqueo(consultar, clienteId, bloqueoId, 'Pagó la deuda', 'operador-9');

      expect(levantado).toEqual({
        ...antes,
        vigente: false,
        levantadoEn: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z$/),
        levantadoPor: 'operador-9',
        motivoLevantamiento: 'Pagó la deuda',
      });
      expect(Date.parse(levantado.levantadoEn as string)).toBeGreaterThanOrEqual(Date.parse(antes.creadoEn));
      expect(await obtenerBloqueo(consultar, clienteId, bloqueoId)).toEqual(levantado);
    });

    it('el historial conserva el bloqueo levantado, entre los no vigentes, y la cuenta vuelve a ACTIVO', async () => {
      const clienteId = await conPerfil();
      const bloqueoId = await conBloqueo(clienteId);

      const levantado = await levantarBloqueo(consultar, clienteId, bloqueoId, 'Pagó', 'operador-2');

      expect((await listarBloqueos(consultar, clienteId, { page: 0, size: 20 })).items).toEqual([levantado]);
      expect((await listarBloqueos(consultar, clienteId, { vigente: false, page: 0, size: 20 })).items).toEqual([levantado]);
      expect(await obtenerEstadoCuenta(consultar, clienteId)).toEqual({ clienteId, estado: 'ACTIVO', bloqueosVigentes: [] });
    });

    it('levantar uno de dos deja la cuenta BLOQUEADA con el otro (spec 004, Casos límite)', async () => {
      const clienteId = await conPerfil();
      const [primero, segundo] = [await conBloqueo(clienteId), await conBloqueo(clienteId)];

      await levantarBloqueo(consultar, clienteId, primero, 'Pagó', 'operador-2');

      const cuenta = await obtenerEstadoCuenta(consultar, clienteId);
      expect([cuenta.estado, cuenta.bloqueosVigentes.map((b) => b.bloqueoId)]).toEqual(['BLOQUEADO', [segundo]]);
    });

    it('uno ya levantado: BloqueoYaLevantado (409) y la fila queda como estaba (RF-2.6.3.1)', async () => {
      const clienteId = await conPerfil();
      const bloqueoId = await conBloqueo(clienteId);
      await levantarBloqueo(consultar, clienteId, bloqueoId, 'Pagó', 'operador-2');
      const guardada = await fila(bloqueoId);

      const error = await fallaCon(levantarBloqueo(consultar, clienteId, bloqueoId, 'Otra vez', 'operador-3'));

      expect(error).toBeInstanceOf(BloqueoYaLevantado);
      expect(error).toMatchObject({ codigo: 409, type: '/errores/bloqueo-ya-levantado' });
      expect(await fila(bloqueoId)).toEqual(guardada);
    });

    it('uno vencido: BloqueoNoVigente (409) y sigue sin datos de levantamiento (spec 004, Casos límite)', async () => {
      const clienteId = await conPerfil();
      const bloqueoId = await conBloqueo(clienteId);
      await pool.consultar(`UPDATE bloqueos_cliente SET hasta = now() - interval '1 second' WHERE bloqueo_id = $1`, [bloqueoId]);
      const guardada = await fila(bloqueoId);

      const error = await fallaCon(levantarBloqueo(consultar, clienteId, bloqueoId, 'Pagó', 'operador-2'));

      expect(error).toBeInstanceOf(BloqueoNoVigente);
      expect(error).toMatchObject({ codigo: 409, type: '/errores/bloqueo-no-vigente' });
      expect(await fila(bloqueoId)).toEqual(guardada);
      expect(guardada).toMatchObject({ levantado_en: null, levantado_por: null, motivo_levantamiento: null });
    });

    it('uno de otro cliente, o uno que no existe, es NoEncontrado y no se toca (spec 004, Casos límite)', async () => {
      const [uno, otro] = [await conPerfil(), await conPerfil()];
      const bloqueoId = await conBloqueo(otro);

      for (const [clienteId, id] of [[uno, bloqueoId], [otro, nuevoId()], [nuevoId(), bloqueoId]]) {
        const error = await fallaCon(levantarBloqueo(consultar, clienteId as string, id as string, 'Pagó', 'operador-2'));

        expect(error).toBeInstanceOf(NoEncontrado);
        expect(error).toMatchObject({ detail: 'No existe el bloqueo pedido' });
      }
      expect((await fila(bloqueoId))?.levantado_en).toBeNull();
    });

    it('mientras otro levantamiento tiene la fila, el segundo lo espera y da BloqueoYaLevantado; queda el primero (RNF-08)', async () => {
      const clienteId = await conPerfil();
      const bloqueoId = await conBloqueo(clienteId);
      const esperandoLaFila = `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%UPDATE bloqueos_cliente%'`;
      let segundo: Promise<unknown> = Promise.resolve();

      const primero = await transaccion(pool, async (enTransaccion) => {
        const levantado = await levantarBloqueo(enTransaccion, clienteId, bloqueoId, 'Primero', 'operador-a');
        segundo = fallaCon(levantarBloqueo(consultar, clienteId, bloqueoId, 'Segundo', 'operador-b'));
        await vi.waitFor(async () => expect((await pool.consultar(esperandoLaFila)).rows).toEqual([{ n: 1 }]), {
          timeout: 1500,
          interval: 20,
        });
        return levantado;
      });

      expect(await segundo).toBeInstanceOf(BloqueoYaLevantado);
      expect(await obtenerBloqueo(consultar, clienteId, bloqueoId)).toEqual(primero);
    });

    it('dos levantamientos a la vez: uno sale, el otro da BloqueoYaLevantado, y la fila es la del que salió (RNF-08)', async () => {
      const clienteId = await conPerfil();
      const bloqueoIds = await Promise.all(Array.from({ length: 10 }, () => conBloqueo(clienteId)));

      for (const bloqueoId of bloqueoIds) {
        const resultados = await Promise.allSettled([
          levantarBloqueo(consultar, clienteId, bloqueoId, 'Uno', 'operador-a'),
          levantarBloqueo(consultar, clienteId, bloqueoId, 'Otro', 'operador-b'),
        ]);

        expect(resultados.map((resultado) => resultado.status).sort()).toEqual(['fulfilled', 'rejected']);
        const ganador = resultados.find((resultado) => resultado.status === 'fulfilled');
        const perdedor = resultados.find((resultado) => resultado.status === 'rejected');
        expect(perdedor?.reason).toBeInstanceOf(BloqueoYaLevantado);
        expect(await obtenerBloqueo(consultar, clienteId, bloqueoId)).toEqual(ganador?.value);
      }
    });

    it('dentro de una transacción, un rechazo no la deja abortada', async () => {
      const clienteId = await conPerfil();
      const [vencido, vigente] = [await conBloqueo(clienteId), await conBloqueo(clienteId)];
      await pool.consultar(`UPDATE bloqueos_cliente SET hasta = now() - interval '1 second' WHERE bloqueo_id = $1`, [vencido]);

      const despues = await transaccion(pool, async (enTransaccion) => {
        await fallaCon(levantarBloqueo(enTransaccion, clienteId, vencido, 'x', 'o'));
        return levantarBloqueo(enTransaccion, clienteId, vigente, 'Sigue', 'o');
      });

      expect(despues.motivoLevantamiento).toBe('Sigue');
    });
  });

  describe('actualizarPerfil', () => {
    it('cambia solo los campos enviados, conserva los demás y mueve actualizadoEn (RF-2.1.2)', async () => {
      const clienteId = nuevoId();
      const antes = await crearPerfil(consultar, clienteId, ANA);

      const despues = await actualizarPerfil(consultar, clienteId, { telefono: '+5493624111111' });

      expect(despues).toEqual({ ...antes, telefono: '+5493624111111', actualizadoEn: expect.any(String) });
      expect(Date.parse(despues.actualizadoEn)).toBeGreaterThan(Date.parse(antes.actualizadoEn));
      expect(despues.creadoEn).toBe(antes.creadoEn);
      expect(await obtenerPerfil(consultar, clienteId)).toEqual(despues);
    });

    it('cambia todos los campos a la vez, la fecha de nacimiento incluida', async () => {
      const clienteId = nuevoId();
      await crearPerfil(consultar, clienteId, ANA);
      const cambios = { nombre: 'Beatriz', apellido: 'Paz', telefono: '+5493624222222', fechaNacimiento: '1985-12-31' };

      expect(await actualizarPerfil(consultar, clienteId, cambios)).toMatchObject(cambios);
    });

    it('agrega la fecha de nacimiento a un perfil que no la tenía', async () => {
      const clienteId = nuevoId();
      await crearPerfil(consultar, clienteId, SIN_FECHA);

      const perfil = await actualizarPerfil(consultar, clienteId, { fechaNacimiento: '1990-05-17' });

      expect(perfil.fechaNacimiento).toBe('1990-05-17');
    });

    it('conserva el estado: un perfil bloqueado sigue BLOQUEADO después de actualizarlo', async () => {
      const clienteId = nuevoId();
      await crearPerfil(consultar, clienteId, ANA);
      await bloquear(clienteId, 'hasta', `now() + interval '1 day'`);

      expect((await actualizarPerfil(consultar, clienteId, { nombre: 'Beatriz' })).estado).toBe('BLOQUEADO');
    });

    it('sin cambios devuelve el perfil como está, sin tocar actualizadoEn', async () => {
      const clienteId = nuevoId();
      const antes = await crearPerfil(consultar, clienteId, ANA);

      expect(await actualizarPerfil(consultar, clienteId, {})).toEqual(antes);
    });

    it('un perfil que no existe da NoEncontrado (RF-2.1.3.1), también sin cambios', async () => {
      expect(await fallaCon(actualizarPerfil(consultar, nuevoId(), { nombre: 'Beatriz' }))).toBeInstanceOf(NoEncontrado);
      expect(await fallaCon(actualizarPerfil(consultar, nuevoId(), {}))).toBeInstanceOf(NoEncontrado);
    });

    it('dos actualizaciones a la vez de campos distintos: quedan las dos, ninguna pisa a la otra (RNF-08)', async () => {
      const clienteId = nuevoId();
      await crearPerfil(consultar, clienteId, ANA);

      await Promise.all([
        actualizarPerfil(consultar, clienteId, { nombre: 'Beatriz' }),
        actualizarPerfil(consultar, clienteId, { apellido: 'Paz' }),
        actualizarPerfil(consultar, clienteId, { telefono: '+5493624333333' }),
      ]);

      expect(await obtenerPerfil(consultar, clienteId)).toMatchObject({
        nombre: 'Beatriz',
        apellido: 'Paz',
        telefono: '+5493624333333',
        fechaNacimiento: '1990-05-17',
      });
    });
  });
});
