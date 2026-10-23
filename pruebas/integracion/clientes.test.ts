import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrar } from '../../src/bd/migraciones.js';
import { crearPool, type PoolBd, TiempoAgotado } from '../../src/bd/pool.js';
import { type Consultar, transaccion } from '../../src/bd/transaccion.js';
import { BaseNoDisponible, Conflicto } from '../../src/errores.js';
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

    it('bloqueos_cliente: clave primaria, clave foránea a clientes, motivo no vacío y levantamiento completo', async () => {
      expect(await restricciones(base.urlBd, 'bloqueos_cliente')).toEqual({
        bloqueos_cliente_pkey: { tipo: 'p', definicion: 'PRIMARY KEY (bloqueo_id)' },
        bloqueos_cliente_cliente_id_fkey: {
          tipo: 'f',
          definicion: 'FOREIGN KEY (cliente_id) REFERENCES clientes(cliente_id)',
        },
        bloqueos_cliente_motivo_no_vacio: { tipo: 'c', definicion: expect.stringContaining('motivo') },
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

    it('rechaza un levantamiento incompleto y acepta uno con los tres datos (RF-2.6.3)', async () => {
      const clienteId = nuevoId();
      await alta(clienteId);
      await bloqueo(clienteId);

      const incompleto = bd.query(`UPDATE bloqueos_cliente SET levantado_en = now() WHERE cliente_id = $1`, [clienteId]);
      expect(await codigoDe(incompleto)).toBe(CHECK);

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

    // Si la conexión volviera al pool, la consulta cortada la seguiría ocupando: la siguiente esperaría detrás, y su
    // transacción, abierta, seguiría con los bloqueos de sus filas.
    it('descarta la conexión de la sentencia cortada, sin esperar a la base, y lo hecho queda deshecho', async () => {
      const clienteId = nuevoId();

      await fallaCon(
        transaccion(pool, async (consultar) => {
          await alta(consultar, clienteId);
          await consultar('SELECT pg_sleep(10)');
        }),
      );

      expect(pool.totalCount).toBe(0);
      expect(await existe(clienteId)).toBe(false);
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
