import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../../src/bd/migraciones.js';
import { crearPool, type PoolBd } from '../../src/bd/pool.js';
import type { Consultar } from '../../src/bd/transaccion.js';
import {
  crearCalificacion,
  existeCalificacion,
  listarCalificaciones,
  obtenerCalificacion,
  viajesCalificados,
} from '../../src/calificaciones/repositorio.js';
import { CalificacionDuplicada, NoEncontrado } from '../../src/errores.js';
import { type BaseDePrueba, crearBaseDePrueba } from '../ayudas/bd.js';

// La migración de la spec 008: se crea con `--migrations-dir migraciones`, que le pone la marca de tiempo (plan, Datos).
const DIR_MIGRACIONES = fileURLToPath(new URL('../../migraciones', import.meta.url));
const MIGRACION = readdirSync(DIR_MIGRACIONES)
  .filter((archivo) => /^\d+_calificaciones\.sql$/.test(archivo))
  .map((archivo) => archivo.slice(0, -'.sql'.length));

// El valor por defecto de M2_TIEMPO_BD_MS: de sobra para la base del contenedor.
const TIEMPO_BD_MS = 2000;

// Los códigos de PostgreSQL que esperan las pruebas.
const CHECK = '23514';
const CLAVE_FORANEA = '23503';
const NO_NULO = '23502';
const UNICA = '23505';

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

const hayTabla = async (urlBd: string) =>
  (await filas(urlBd, `SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'calificaciones'`)).length === 1;

// Las restricciones de la tabla, por nombre: su tipo (p, f, u, c) y su definición como la escribe PostgreSQL. Sin los NOT NULL,
// que PostgreSQL 18 también guarda en pg_constraint (tipo n): esos los mira `columnasConNulo`.
const restricciones = async (urlBd: string) =>
  Object.fromEntries(
    (
      await filas(
        urlBd,
        `SELECT conname, contype, pg_get_constraintdef(oid) AS definicion FROM pg_constraint
         WHERE conrelid = 'calificaciones'::regclass AND contype <> 'n'`,
      )
    ).map((fila) => [fila.conname, { tipo: fila.contype, definicion: fila.definicion }]),
  );

// Las columnas que aceptan nulo, en orden alfabético.
const columnasConNulo = async (urlBd: string) =>
  (
    await filas(
      urlBd,
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'calificaciones' AND is_nullable = 'YES' ORDER BY column_name`,
    )
  ).map((fila) => fila.column_name);

const indices = async (urlBd: string) =>
  (await filas(urlBd, `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'calificaciones'`)).map(
    (fila) => String(fila.indexdef),
  );

describe('la migración calificaciones (RF-2.5.3, RNF-05, RNF-08)', () => {
  let base: BaseDePrueba;
  let bd: Client;

  const perfil = (clienteId: string) =>
    bd.query(`INSERT INTO clientes (cliente_id, nombre, apellido, telefono) VALUES ($1, 'Ana', 'Gómez', '+5493624000000')`, [
      clienteId,
    ]);

  // Una calificación ficticia; cada prueba cambia solo lo que quiere probar.
  type Fila = {
    calificacionId?: string;
    clienteId: string;
    viajeId?: string;
    conductorId?: string;
    puntaje?: number | null;
    comentario?: string | null;
  };
  const calificacion = ({
    calificacionId = nuevoId(),
    clienteId,
    viajeId = nuevoId(),
    conductorId = nuevoId(),
    puntaje = 5,
    comentario = null,
  }: Fila) =>
    bd.query(
      `INSERT INTO calificaciones (calificacion_id, cliente_id, viaje_id, conductor_id, puntaje, comentario)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [calificacionId, clienteId, viajeId, conductorId, puntaje, comentario],
    );

  const cuantas = async (clienteId: string) =>
    Number((await bd.query(`SELECT count(*) AS total FROM calificaciones WHERE cliente_id = $1`, [clienteId])).rows[0]?.total);

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

  it('crea la tabla calificaciones', async () => {
    expect(await hayTabla(base.urlBd)).toBe(true);
  });

  describe('claves, restricciones e índices', () => {
    it('clave primaria, clave foránea a clientes con borrado en cascada, restricción única por cliente y viaje, y check del puntaje', async () => {
      expect(await restricciones(base.urlBd)).toEqual({
        calificaciones_pkey: { tipo: 'p', definicion: 'PRIMARY KEY (calificacion_id)' },
        calificaciones_cliente_id_fkey: {
          tipo: 'f',
          definicion: 'FOREIGN KEY (cliente_id) REFERENCES clientes(cliente_id) ON DELETE CASCADE',
        },
        calificaciones_cliente_viaje_unica: { tipo: 'u', definicion: 'UNIQUE (cliente_id, viaje_id)' },
        calificaciones_puntaje_valido: { tipo: 'c', definicion: expect.stringContaining('puntaje') },
      });
    });

    it('no tiene clave foránea del viaje ni del conductor: son identificadores de M6 (RNF-05)', async () => {
      const definiciones = Object.values(await restricciones(base.urlBd)).map(({ definicion }) => String(definicion));

      expect(definiciones.filter((definicion) => definicion.startsWith('FOREIGN KEY'))).toHaveLength(1);
    });

    // Opcional: solo el comentario (RF-2.5). El conductor sale de M6 y siempre se guarda (contrato: conductorId obligatorio).
    it('acepta nulo solo en el comentario', async () => {
      expect(await columnasConNulo(base.urlBd)).toEqual(['comentario']);
    });

    it('tiene el índice del listado, del más nuevo al más viejo con el id de desempate (RF-2.5.8)', async () => {
      expect(await indices(base.urlBd)).toContainEqual(
        expect.stringContaining('(cliente_id, creado_en DESC, calificacion_id DESC)'),
      );
    });
  });

  describe('lo que la base acepta', () => {
    it('guarda una calificación solo con lo obligatorio y le pone la fecha de creación', async () => {
      const clienteId = nuevoId();
      await perfil(clienteId);
      const calificacionId = nuevoId();
      const viajeId = nuevoId();
      const conductorId = nuevoId();
      await calificacion({ calificacionId, clienteId, viajeId, conductorId, puntaje: 4 });

      const [fila] = (await bd.query(`SELECT * FROM calificaciones WHERE calificacion_id = $1`, [calificacionId])).rows;
      expect(fila).toMatchObject({
        calificacion_id: calificacionId,
        cliente_id: clienteId,
        viaje_id: viajeId,
        conductor_id: conductorId,
        puntaje: 4,
        comentario: null,
      });
      expect(fila.creado_en).toBeInstanceOf(Date);
    });

    it('guarda los puntajes de 1 a 5, un comentario vacío y uno de 500 caracteres', async () => {
      const clienteId = nuevoId();
      await perfil(clienteId);

      for (const puntaje of [1, 2, 3, 4, 5]) await calificacion({ clienteId, puntaje });
      await calificacion({ clienteId, comentario: '' });
      await calificacion({ clienteId, comentario: 'ñ'.repeat(500) });

      expect(await cuantas(clienteId)).toBe(7);
    });

    it('guarda el mismo viaje de otro cliente y dos viajes distintos del mismo conductor', async () => {
      const [uno, otro] = [nuevoId(), nuevoId()];
      await perfil(uno);
      await perfil(otro);
      const viajeId = nuevoId();
      const conductorId = nuevoId();

      await calificacion({ clienteId: uno, viajeId, conductorId });
      await calificacion({ clienteId: otro, viajeId, conductorId });
      await calificacion({ clienteId: uno, conductorId });

      expect(await cuantas(uno)).toBe(2);
      expect(await cuantas(otro)).toBe(1);
    });
  });

  describe('lo que la base rechaza', () => {
    it('rechaza una calificación de un cliente que no existe', async () => {
      expect(await codigoDe(calificacion({ clienteId: nuevoId() }))).toBe(CLAVE_FORANEA);
    });

    it('rechaza repetir el calificacion_id', async () => {
      const clienteId = nuevoId();
      await perfil(clienteId);
      const calificacionId = nuevoId();
      await calificacion({ calificacionId, clienteId });

      expect(await codigoDe(calificacion({ calificacionId, clienteId }))).toBe(UNICA);
    });

    it('rechaza una segunda calificación del mismo cliente para el mismo viaje, aunque cambie el puntaje, el comentario o el conductor (RNF-08)', async () => {
      const clienteId = nuevoId();
      await perfil(clienteId);
      const viajeId = nuevoId();
      await calificacion({ clienteId, viajeId, puntaje: 5 });

      expect(await codigoDe(calificacion({ clienteId, viajeId, puntaje: 5 }))).toBe(UNICA);
      expect(await codigoDe(calificacion({ clienteId, viajeId, puntaje: 1, comentario: 'otra' }))).toBe(UNICA);
      expect(await codigoDe(calificacion({ clienteId, viajeId, conductorId: nuevoId() }))).toBe(UNICA);
      expect(await cuantas(clienteId)).toBe(1);
    });

    it('con diez altas a la vez del mismo cliente y viaje, guarda una y rechaza nueve (RNF-08)', async () => {
      const clienteId = nuevoId();
      await perfil(clienteId);
      const viajeId = nuevoId();
      const conexiones = await Promise.all(
        Array.from({ length: 10 }, async () => {
          const cliente = new Client({ connectionString: base.urlBd });
          await cliente.connect();
          return cliente;
        }),
      );
      try {
        const resultados = await Promise.all(
          conexiones.map((cliente) =>
            codigoDe(
              cliente.query(
                `INSERT INTO calificaciones (calificacion_id, cliente_id, viaje_id, conductor_id, puntaje)
                 VALUES ($1, $2, $3, $4, 5)`,
                [nuevoId(), clienteId, viajeId, nuevoId()],
              ),
            ),
          ),
        );

        expect(resultados.filter((codigo) => codigo === 'sin error')).toHaveLength(1);
        expect(resultados.filter((codigo) => codigo === UNICA)).toHaveLength(9);
        expect(await cuantas(clienteId)).toBe(1);
      } finally {
        await Promise.all(conexiones.map((cliente) => cliente.end()));
      }
    });

    it('rechaza un puntaje fuera de 1 a 5', async () => {
      const clienteId = nuevoId();
      await perfil(clienteId);

      for (const puntaje of [0, 6, -1, 100]) {
        expect(await codigoDe(calificacion({ clienteId, puntaje }))).toBe(CHECK);
      }
      expect(await cuantas(clienteId)).toBe(0);
    });

    it('rechaza un comentario de más de 500 caracteres', async () => {
      const clienteId = nuevoId();
      await perfil(clienteId);

      expect(await codigoDe(calificacion({ clienteId, comentario: 'a'.repeat(501) }))).toBe('22001');
    });

    it('rechaza nulo en el puntaje, el viaje, el conductor y el cliente', async () => {
      const clienteId = nuevoId();
      await perfil(clienteId);

      expect(await codigoDe(calificacion({ clienteId, puntaje: null }))).toBe(NO_NULO);
      expect(await codigoDe(bd.query(`INSERT INTO calificaciones (calificacion_id, cliente_id, conductor_id, puntaje) VALUES ($1, $2, $3, 5)`, [nuevoId(), clienteId, nuevoId()]))).toBe(NO_NULO);
      expect(await codigoDe(bd.query(`INSERT INTO calificaciones (calificacion_id, cliente_id, viaje_id, puntaje) VALUES ($1, $2, $3, 5)`, [nuevoId(), clienteId, nuevoId()]))).toBe(NO_NULO);
      expect(await codigoDe(bd.query(`INSERT INTO calificaciones (calificacion_id, viaje_id, conductor_id, puntaje) VALUES ($1, $2, $3, 5)`, [nuevoId(), nuevoId(), nuevoId()]))).toBe(NO_NULO);
    });
  });

  describe('lo que pasa con el perfil', () => {
    it('al borrar el perfil se van sus calificaciones y no las de otro cliente', async () => {
      const [uno, otro] = [nuevoId(), nuevoId()];
      await perfil(uno);
      await perfil(otro);
      await calificacion({ clienteId: uno });
      await calificacion({ clienteId: otro });

      await bd.query(`DELETE FROM clientes WHERE cliente_id = $1`, [uno]);

      expect(await cuantas(uno)).toBe(0);
      expect(await cuantas(otro)).toBe(1);
    });
  });
});

describe('la migración calificaciones se revierte (RNF-05.1)', () => {
  let base: BaseDePrueba;

  beforeAll(async () => {
    base = await crearBaseDePrueba();
    await migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });
  });

  afterAll(async () => {
    await base?.borrar();
  });

  it('su Down Migration borra la tabla y deja la de perfiles, y se puede volver a aplicar', async () => {
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

    expect(await hayTabla(base.urlBd)).toBe(false);
    expect((await filas(base.urlBd, `SELECT 1 FROM pg_tables WHERE tablename = 'clientes'`)).length).toBe(1);
    expect(await migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS })).toEqual(MIGRACION);
    expect(await hayTabla(base.urlBd)).toBe(true);
  });
});

describe('el repositorio de calificaciones (RF-2.5, RF-2.5.3, RF-2.5.8 a RF-2.5.10, RF-2.5.14, RNF-08)', () => {
  let base: BaseDePrueba;
  let pool: PoolBd;

  const consultar: Consultar = (sql, parametros) => pool.consultar(sql, parametros);

  const cliente = async () => {
    const clienteId = nuevoId();
    await consultar(`INSERT INTO clientes (cliente_id, nombre, apellido, telefono) VALUES ($1, 'Ana', 'Gómez', '+5493624000000')`, [
      clienteId,
    ]);
    return clienteId;
  };

  // Una calificación de prueba; cada prueba cambia solo lo que quiere probar.
  const calificar = (
    clienteId: string,
    { viajeId = nuevoId(), conductorId = nuevoId(), puntaje = 5, comentario }: { viajeId?: string; conductorId?: string; puntaje?: number; comentario?: string } = {},
    calificacionId = nuevoId(),
  ) => crearCalificacion(consultar, clienteId, calificacionId, { viajeId, conductorId, puntaje, ...(comentario === undefined ? {} : { comentario }) });

  // Cuántas sentencias lanza `fn` con el `consultar` que recibe.
  async function contando<T>(fn: (consultarContado: Consultar) => Promise<T>): Promise<{ resultado: T; sentencias: number }> {
    let sentencias = 0;
    const resultado = await fn((sql, parametros) => {
      sentencias += 1;
      return consultar(sql, parametros);
    });
    return { resultado, sentencias };
  }

  beforeAll(async () => {
    base = await crearBaseDePrueba();
    await migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });
    pool = crearPool({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });
  });

  afterAll(async () => {
    await pool?.end();
    await base?.borrar();
  });

  describe('crearCalificacion()', () => {
    it('con comentario, devuelve la calificación del contrato y la guarda con el id, el cliente, el viaje y el conductor dados', async () => {
      const clienteId = await cliente();
      const calificacionId = nuevoId();
      const viajeId = nuevoId();
      const conductorId = nuevoId();

      const creada = await calificar(clienteId, { viajeId, conductorId, puntaje: 4, comentario: 'Muy amable' }, calificacionId);

      expect(creada).toEqual({
        calificacionId,
        viajeId,
        conductorId,
        puntaje: 4,
        comentario: 'Muy amable',
        creadoEn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      });
      const guardada = await pool.consultar(`SELECT cliente_id, viaje_id, conductor_id, puntaje, comentario FROM calificaciones WHERE calificacion_id = $1`, [
        calificacionId,
      ]);
      expect(guardada.rows).toEqual([{ cliente_id: clienteId, viaje_id: viajeId, conductor_id: conductorId, puntaje: 4, comentario: 'Muy amable' }]);
    });

    it('sin comentario, el campo no está en la respuesta y la base guarda nulo; uno vacío se guarda vacío', async () => {
      const clienteId = await cliente();

      const sin = await calificar(clienteId);
      const vacio = await calificar(clienteId, { comentario: '' });

      expect(sin).not.toHaveProperty('comentario');
      expect(vacio).toHaveProperty('comentario', '');
      const guardados = await pool.consultar<{ comentario: string | null }>(
        `SELECT comentario FROM calificaciones WHERE calificacion_id = ANY($1::uuid[]) ORDER BY comentario NULLS FIRST`,
        [[sin.calificacionId, vacio.calificacionId]],
      );
      expect(guardados.rows.map((fila) => fila.comentario)).toEqual([null, '']);
    });

    it('el mismo viaje del mismo cliente da CalificacionDuplicada y conserva la primera calificación (RF-2.5.3)', async () => {
      const clienteId = await cliente();
      const viajeId = nuevoId();
      const primera = await calificar(clienteId, { viajeId, puntaje: 5, comentario: 'Primera' });

      await expect(calificar(clienteId, { viajeId, puntaje: 1, comentario: 'Segunda', conductorId: nuevoId() })).rejects.toBeInstanceOf(
        CalificacionDuplicada,
      );

      expect(await obtenerCalificacion(consultar, clienteId, primera.calificacionId)).toEqual(primera);
      const cuantas = await pool.consultar(`SELECT 1 FROM calificaciones WHERE cliente_id = $1`, [clienteId]);
      expect(cuantas.rowCount).toBe(1);
    });

    it('el mismo viaje de otro cliente, o otro viaje del mismo cliente, se guarda', async () => {
      const [uno, otro] = [await cliente(), await cliente()];
      const viajeId = nuevoId();

      await calificar(uno, { viajeId });
      await calificar(otro, { viajeId });
      await calificar(uno);

      const cuantas = await pool.consultar(`SELECT 1 FROM calificaciones WHERE cliente_id = $1`, [uno]);
      expect(cuantas.rowCount).toBe(2);
    });

    it('con diez altas a la vez del mismo cliente y viaje, una se guarda y nueve dan CalificacionDuplicada (RNF-08)', async () => {
      const clienteId = await cliente();
      const viajeId = nuevoId();

      const resultados = await Promise.allSettled(Array.from({ length: 10 }, () => calificar(clienteId, { viajeId })));

      expect(resultados.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      const rechazos = resultados.filter((resultado) => resultado.status === 'rejected');
      expect(rechazos).toHaveLength(9);
      for (const { reason } of rechazos) expect(reason).toBeInstanceOf(CalificacionDuplicada);
      const cuantas = await pool.consultar(`SELECT 1 FROM calificaciones WHERE cliente_id = $1`, [clienteId]);
      expect(cuantas.rowCount).toBe(1);
    });

    it('el CalificacionDuplicada no lleva el viaje, la calificación ni el comentario', async () => {
      const clienteId = await cliente();
      const viajeId = nuevoId();
      await calificar(clienteId, { viajeId, comentario: 'secreto-del-comentario' });

      const error = await calificar(clienteId, { viajeId, comentario: 'otro-secreto' }).catch((falla: unknown) => falla as Error);

      expect(JSON.stringify({ mensaje: (error as Error).message, ...(error as object) })).not.toMatch(
        new RegExp(`${viajeId}|secreto|calificaciones_cliente_viaje_unica`),
      );
    });
  });

  describe('existeCalificacion()', () => {
    it('es verdadero solo para el cliente y el viaje calificados', async () => {
      const [uno, otro] = [await cliente(), await cliente()];
      const { viajeId } = await calificar(uno);

      expect(await existeCalificacion(consultar, uno, viajeId)).toBe(true);
      expect(await existeCalificacion(consultar, otro, viajeId)).toBe(false);
      expect(await existeCalificacion(consultar, uno, nuevoId())).toBe(false);
    });

    it('no distingue mayúsculas en el id del viaje: es un UUID', async () => {
      const clienteId = await cliente();
      const { viajeId } = await calificar(clienteId);

      expect(await existeCalificacion(consultar, clienteId, viajeId.toUpperCase())).toBe(true);
    });
  });

  describe('obtenerCalificacion()', () => {
    it('devuelve la calificación del cliente', async () => {
      const clienteId = await cliente();
      const creada = await calificar(clienteId, { comentario: 'Bien' });

      expect(await obtenerCalificacion(consultar, clienteId, creada.calificacionId)).toEqual(creada);
    });

    it('la de otro cliente y la que no existe dan NoEncontrado, igual (RF-2.5.10)', async () => {
      const [uno, otro] = [await cliente(), await cliente()];
      const { calificacionId } = await calificar(uno);

      const ajena = await obtenerCalificacion(consultar, otro, calificacionId).catch((falla: unknown) => falla);
      const inexistente = await obtenerCalificacion(consultar, uno, nuevoId()).catch((falla: unknown) => falla);

      expect(ajena).toBeInstanceOf(NoEncontrado);
      expect(inexistente).toBeInstanceOf(NoEncontrado);
      expect((ajena as NoEncontrado).detail).toBe((inexistente as NoEncontrado).detail);
    });

    it('un cliente que no existe da NoEncontrado', async () => {
      await expect(obtenerCalificacion(consultar, nuevoId(), nuevoId())).rejects.toBeInstanceOf(NoEncontrado);
    });
  });

  describe('listarCalificaciones()', () => {
    it('devuelve las del cliente de la más nueva a la más antigua, con los totales, en una sola sentencia (RF-2.5.8)', async () => {
      const clienteId = await cliente();
      const otro = await cliente();
      const [a, b, c] = [await calificar(clienteId), await calificar(clienteId), await calificar(clienteId)];
      await calificar(otro);

      const { resultado, sentencias } = await contando((contado) => listarCalificaciones(contado, clienteId, { page: 0, size: 20 }));

      expect(resultado).toEqual({ page: 0, size: 20, totalElementos: 3, totalPaginas: 1, items: [c, b, a] });
      expect(sentencias).toBe(1);
    });

    it('pagina sin repetir ni saltear: cada página trae las que le tocan y el total es el del cliente', async () => {
      const clienteId = await cliente();
      const creadas = [];
      for (let i = 0; i < 5; i++) creadas.push(await calificar(clienteId, { puntaje: (i % 5) + 1 }));
      const esperadas = creadas.reverse();

      const paginas = await Promise.all([0, 1, 2].map((page) => listarCalificaciones(consultar, clienteId, { page, size: 2 })));

      expect(paginas.map(({ items }) => items)).toEqual([esperadas.slice(0, 2), esperadas.slice(2, 4), esperadas.slice(4)]);
      for (const pagina of paginas) expect(pagina).toMatchObject({ size: 2, totalElementos: 5, totalPaginas: 3 });
    });

    it('con la misma fecha de creación, desempata por id descendente y el orden es estable entre páginas', async () => {
      const clienteId = await cliente();
      const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002'];
      for (const id of ids) {
        await pool.consultar(
          `INSERT INTO calificaciones (calificacion_id, cliente_id, viaje_id, conductor_id, puntaje, creado_en)
           VALUES ($1, $2, $3, $4, 5, '2026-10-26T12:00:00Z')`,
          [id, clienteId, nuevoId(), nuevoId()],
        );
      }

      const paginas = [
        await listarCalificaciones(consultar, clienteId, { page: 0, size: 2 }),
        await listarCalificaciones(consultar, clienteId, { page: 1, size: 2 }),
      ];

      expect(paginas.flatMap(({ items }) => items.map(({ calificacionId }) => calificacionId))).toEqual([ids[1], ids[2], ids[0]]);
    });

    it('un cliente sin calificaciones da items vacío y totales en cero, no NoEncontrado (RF-2.5.9)', async () => {
      const clienteId = await cliente();

      expect(await listarCalificaciones(consultar, clienteId, { page: 0, size: 20 })).toEqual({
        page: 0,
        size: 20,
        totalElementos: 0,
        totalPaginas: 0,
        items: [],
      });
    });

    it('una página fuera del total da items vacío y conserva los totales, también con una página enorme (RF-2.5.9)', async () => {
      const clienteId = await cliente();
      await calificar(clienteId);
      await calificar(clienteId);

      const lejos = await listarCalificaciones(consultar, clienteId, { page: 9, size: 20 });
      const enorme = await listarCalificaciones(consultar, clienteId, { page: Number.MAX_SAFE_INTEGER, size: 100 });

      expect(lejos).toEqual({ page: 9, size: 20, totalElementos: 2, totalPaginas: 1, items: [] });
      expect(enorme).toEqual({ page: Number.MAX_SAFE_INTEGER, size: 100, totalElementos: 2, totalPaginas: 1, items: [] });
    });

    it('un cliente que no existe da NoEncontrado (RF-2.5.11)', async () => {
      await expect(listarCalificaciones(consultar, nuevoId(), { page: 0, size: 20 })).rejects.toBeInstanceOf(NoEncontrado);
    });
  });

  describe('viajesCalificados()', () => {
    it('devuelve solo los viajes de la lista que el cliente calificó, no los de otro cliente (RF-2.5.14)', async () => {
      const [uno, otro] = [await cliente(), await cliente()];
      const calificado = await calificar(uno);
      const delOtro = await calificar(otro);
      const sinCalificar = nuevoId();

      const resultado = await viajesCalificados(consultar, uno, [calificado.viajeId, delOtro.viajeId, sinCalificar]);

      expect([...resultado]).toEqual([calificado.viajeId]);
    });

    it('devuelve los ids en minúsculas aunque lleguen en mayúsculas, con una sola sentencia', async () => {
      const clienteId = await cliente();
      const { viajeId } = await calificar(clienteId);

      const { resultado, sentencias } = await contando((contado) => viajesCalificados(contado, clienteId, [viajeId.toUpperCase()]));

      expect(resultado.has(viajeId)).toBe(true);
      expect(sentencias).toBe(1);
    });

    it('con una lista vacía devuelve un conjunto vacío sin consultar la base', async () => {
      const clienteId = await cliente();

      const { resultado, sentencias } = await contando((contado) => viajesCalificados(contado, clienteId, []));

      expect(resultado.size).toBe(0);
      expect(sentencias).toBe(0);
    });
  });
});
