import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { Client, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Identidad } from '../../src/auth/tokens.js';
import { migrar } from '../../src/bd/migraciones.js';
import { type BaseDeDatos, crearPool, type PoolBd } from '../../src/bd/pool.js';
import type { Consultar } from '../../src/bd/transaccion.js';
import {
  crearCalificacion,
  existeCalificacion,
  listarCalificaciones,
  obtenerCalificacion,
  viajesCalificados,
} from '../../src/calificaciones/repositorio.js';
import { calificarConductor } from '../../src/calificaciones/servicio.js';
import type { CalificacionNueva } from '../../src/calificaciones/modelo.js';
import {
  BaseNoDisponible,
  CalificacionDuplicada,
  ErrorDeIntegracion,
  IdempotenciaReutilizada,
  ModuloNoDisponible,
  NoEncontrado,
  SinPermiso,
  ViajeNoCompletado,
} from '../../src/errores.js';
import { crearM6 } from '../../src/historial/m6.js';
import { serializarError } from '../../src/logs.js';
import { CONFIG, POOL_FALSO } from '../ayudas/app.js';
import { type BaseDePrueba, crearBaseDePrueba } from '../ayudas/bd.js';
import { type Comportamiento, crearServidorModulo } from '../ayudas/servidor-modulo.js';

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

describe('calificarConductor con PostgreSQL real y M6 simulado (RF-2.5 a RF-2.5.4, RF-2.5.11, RF-2.5.12, RNF-08, RNF-19)', () => {
  let base: BaseDePrueba;
  let pool: PoolBd;
  const serv = crearServidorModulo();

  const CONDUCTOR = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
  const ROLES = ['CLIENTE'] as const;

  beforeAll(async () => {
    base = await crearBaseDePrueba();
    await migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });
    pool = crearPool({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });
    await serv.levantar();
  });

  afterAll(async () => {
    await pool?.end();
    await base?.borrar();
    await serv.cerrar();
  });

  const perfil = async () => {
    const clienteId = nuevoId();
    await pool.consultar(`INSERT INTO clientes (cliente_id, nombre, apellido, telefono) VALUES ($1, 'Ana', 'Gómez', '+5493624000000')`, [
      clienteId,
    ]);
    return clienteId;
  };
  const deCliente = (clienteId: string): Identidad => ({ sub: clienteId, roles: ['CLIENTE'] });

  // El viaje como lo responde M6 (`Trip`): completado, del cliente y con conductor, salvo lo que cambie la prueba.
  const viajeDeM6 = (viajeId: string, clientId: string, extra: object = {}) => ({
    id: viajeId,
    state: 'COMPLETED',
    clientId,
    driverId: CONDUCTOR,
    createdAt: '2026-10-01T10:00:00Z',
    ...extra,
  });
  const responde = (viajeId: string, clientId: string, extra: object = {}): Comportamiento => ({
    tipo: 'ok',
    cuerpo: viajeDeM6(viajeId, clientId, extra),
  });
  const CAIDO: Comportamiento = { tipo: '5xx', estado: 503 };

  // Se crea en cada llamada: la URL del M6 simulado se conoce recién cuando levanta.
  const m6 = () => crearM6({ ...CONFIG, urlM6: serv.url, tiempoModulosMs: 500, reintentosModulos: 1 });
  const calificar = (identidad: Identidad, clienteId: string, clave: string, datos: CalificacionNueva, bd: BaseDeDatos = pool) =>
    calificarConductor(bd, m6(), identidad, ROLES, clienteId, clave, datos, 'id-de-correlacion');

  const fallaCon = (promesa: Promise<unknown>) =>
    promesa.then(
      () => expect.unreachable('la calificación no falló'),
      (error: unknown) => error,
    );

  const filasDe = async (clienteId: string) =>
    (await pool.consultar(`SELECT viaje_id, conductor_id, puntaje, comentario FROM calificaciones WHERE cliente_id = $1`, [clienteId])).rows;
  const reservasDe = async (clienteId: string) =>
    (await pool.consultar(`SELECT clave FROM idempotencias WHERE cliente_id = $1`, [clienteId])).rowCount;

  describe('el alta (RF-2.5)', () => {
    it('201 con Location y la calificación, guardada con el conductor que informó M6', async () => {
      const clienteId = await perfil();
      const viajeId = nuevoId();
      serv.responderCon(responde(viajeId, clienteId));

      const respuesta = await calificar(deCliente(clienteId), clienteId, 'clave-1', { viajeId, puntaje: 4, comentario: 'Muy amable' });

      const cuerpo = respuesta.cuerpo as { calificacionId: string };
      expect(respuesta).toEqual({
        estado: 201,
        ubicacion: `/api/v1/clientes/${clienteId}/calificaciones/${cuerpo.calificacionId}`,
        cuerpo: {
          calificacionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
          viajeId,
          conductorId: CONDUCTOR,
          puntaje: 4,
          comentario: 'Muy amable',
          creadoEn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        },
      });
      expect(await filasDe(clienteId)).toEqual([{ viaje_id: viajeId, conductor_id: CONDUCTOR, puntaje: 4, comentario: 'Muy amable' }]);
      expect(serv.rutaRecibida).toBe(`/trips/${viajeId}`);
      expect(serv.encabezadosRecibidos.get('x-request-id')).toBe('id-de-correlacion');
    });

    it('el clienteId y el viajeId en mayúsculas se guardan y van a M6 como los guarda la base; sin comentario, no hay', async () => {
      const clienteId = await perfil();
      const viajeId = nuevoId();
      serv.responderCon(responde(viajeId, clienteId));

      const respuesta = await calificar(deCliente(clienteId), clienteId.toUpperCase(), 'clave-1', { viajeId: viajeId.toUpperCase(), puntaje: 5 });

      expect(respuesta.ubicacion).toContain(`/api/v1/clientes/${clienteId}/calificaciones/`);
      expect(respuesta.cuerpo).toMatchObject({ viajeId });
      expect(respuesta.cuerpo).not.toHaveProperty('comentario');
      expect(serv.rutaRecibida).toBe(`/trips/${viajeId}`);
      expect(await filasDe(clienteId)).toEqual([{ viaje_id: viajeId, conductor_id: CONDUCTOR, puntaje: 5, comentario: null }]);
    });
  });

  describe('el orden: propiedad, respuesta guardada, perfil, duplicado, M6 y alta', () => {
    it('un CLIENTE, el perfil de otro: 403 sin tocar la base ni llamar a M6 (RF-2.5.12)', async () => {
      serv.responderCon(responde(nuevoId(), nuevoId()));

      for (const roles of [['CLIENTE'], ['CLIENTE', 'OPERADOR']] as const) {
        const error = await fallaCon(calificar({ sub: nuevoId(), roles: [...roles] }, nuevoId(), 'clave-1', { viajeId: nuevoId(), puntaje: 5 }, POOL_FALSO));
        expect(error).toBeInstanceOf(SinPermiso);
      }
      expect(serv.llamadas).toBe(0);
    });

    it('sin perfil: 404 sin llamar a M6, aunque M6 esté caído (RF-2.5.11)', async () => {
      const clienteId = nuevoId();
      serv.responderCon(CAIDO);

      expect(await fallaCon(calificar(deCliente(clienteId), clienteId, 'clave-1', { viajeId: nuevoId(), puntaje: 5 }))).toBeInstanceOf(NoEncontrado);
      expect(serv.llamadas).toBe(0);
    });

    it('con la base caída: el 503 de la base, sin llamar a M6', async () => {
      const clienteId = nuevoId();
      const caida: BaseDeDatos = { ...POOL_FALSO, consultar: async () => Promise.reject(new BaseNoDisponible()) };
      serv.responderCon(responde(nuevoId(), clienteId));

      expect(await fallaCon(calificar(deCliente(clienteId), clienteId, 'clave-1', { viajeId: nuevoId(), puntaje: 5 }, caida))).toBeInstanceOf(
        BaseNoDisponible,
      );
      expect(serv.llamadas).toBe(0);
    });

    it('un viaje ya calificado, con otra clave: 409 sin llamar a M6, aunque esté caído, y queda la primera (RF-2.5.3)', async () => {
      const clienteId = await perfil();
      const viajeId = nuevoId();
      serv.responderCon(responde(viajeId, clienteId));
      await calificar(deCliente(clienteId), clienteId, 'clave-1', { viajeId, puntaje: 5 });
      serv.responderCon(CAIDO);

      const error = await fallaCon(calificar(deCliente(clienteId), clienteId, 'clave-2', { viajeId: viajeId.toUpperCase(), puntaje: 1 }));

      expect(error).toBeInstanceOf(CalificacionDuplicada);
      expect(serv.llamadas).toBe(0);
      expect(await filasDe(clienteId)).toEqual([expect.objectContaining({ puntaje: 5 })]);
      expect(await reservasDe(clienteId)).toBe(1);
    });
  });

  describe('lo que informa M6 (RF-2.5.1, RF-2.5.2)', () => {
    it.each<[string, (viajeId: string) => Comportamiento]>([
      ['no existe (404)', () => ({ tipo: '4xx', estado: 404 })],
      ['es de otro cliente', (viajeId) => responde(viajeId, nuevoId())],
      ['es de otro cliente y no está completado', (viajeId) => responde(viajeId, nuevoId(), { state: 'IN_PROGRESS' })],
    ])('el viaje %s: 404, sin calificación ni reserva', async (_caso, comportamiento) => {
      const clienteId = await perfil();
      const viajeId = nuevoId();
      serv.responderCon(comportamiento(viajeId));

      const error = await fallaCon(calificar(deCliente(clienteId), clienteId, 'clave-1', { viajeId, puntaje: 5 }));

      expect(error).toBeInstanceOf(NoEncontrado);
      expect(await filasDe(clienteId)).toEqual([]);
      expect(await reservasDe(clienteId)).toBe(0);
    });

    it('el 404 de un viaje inexistente y el de uno ajeno son iguales', async () => {
      const clienteId = await perfil();
      serv.responderCon({ tipo: '4xx', estado: 404 });
      const inexistente = await fallaCon(calificar(deCliente(clienteId), clienteId, 'clave-1', { viajeId: nuevoId(), puntaje: 5 }));
      const viajeId = nuevoId();
      serv.responderCon(responde(viajeId, nuevoId()));
      const ajeno = await fallaCon(calificar(deCliente(clienteId), clienteId, 'clave-2', { viajeId, puntaje: 5 }));

      expect(ajeno).toEqual(inexistente);
    });

    it.each(['IN_PROGRESS', 'CANCELLED_BY_CLIENT', 'UN_ESTADO_NUEVO'])('un viaje del cliente en %s: 422, sin calificación ni reserva', async (estado) => {
      const clienteId = await perfil();
      const viajeId = nuevoId();
      serv.responderCon(responde(viajeId, clienteId, { state: estado, driverId: undefined }));

      const error = await fallaCon(calificar(deCliente(clienteId), clienteId, 'clave-1', { viajeId, puntaje: 5 }));

      expect(error).toBeInstanceOf(ViajeNoCompletado);
      expect(await filasDe(clienteId)).toEqual([]);
      expect(await reservasDe(clienteId)).toBe(0);
    });

    it('M6 caído: 503 tras el reintento, sin calificación ni reserva', async () => {
      const clienteId = await perfil();
      serv.responderCon(CAIDO);

      const error = await fallaCon(calificar(deCliente(clienteId), clienteId, 'clave-1', { viajeId: nuevoId(), puntaje: 5 }));

      expect(error).toBeInstanceOf(ModuloNoDisponible);
      expect(serv.llamadas).toBe(2);
      expect(await filasDe(clienteId)).toEqual([]);
      expect(await reservasDe(clienteId)).toBe(0);
    });

    it('un 403 de M6: el 500 de integración, sin calificación', async () => {
      const clienteId = await perfil();
      serv.responderCon({ tipo: '4xx', estado: 403 });

      expect(await fallaCon(calificar(deCliente(clienteId), clienteId, 'clave-1', { viajeId: nuevoId(), puntaje: 5 }))).toBeInstanceOf(
        ErrorDeIntegracion,
      );
      expect(await filasDe(clienteId)).toEqual([]);
    });
  });

  describe('la idempotencia (RF-2.5.4)', () => {
    it('la misma clave y el mismo cuerpo: el 201 original, sin volver a llamar a M6 aunque esté caído', async () => {
      const clienteId = await perfil();
      const viajeId = nuevoId();
      serv.responderCon(responde(viajeId, clienteId));
      const primera = await calificar(deCliente(clienteId), clienteId, 'clave-1', { viajeId, puntaje: 4, comentario: 'Bien' });
      serv.responderCon(CAIDO);

      const segunda = await calificar(deCliente(clienteId), clienteId, 'clave-1', { comentario: 'Bien', puntaje: 4, viajeId });

      expect(segunda).toEqual(primera);
      expect(serv.llamadas).toBe(0);
      expect(await filasDe(clienteId)).toHaveLength(1);
    });

    it('el viajeId en mayúsculas es el mismo cuerpo', async () => {
      const clienteId = await perfil();
      const viajeId = nuevoId();
      serv.responderCon(responde(viajeId, clienteId));
      const primera = await calificar(deCliente(clienteId), clienteId, 'clave-1', { viajeId, puntaje: 4 });

      expect(await calificar(deCliente(clienteId), clienteId.toUpperCase(), 'clave-1', { viajeId: viajeId.toUpperCase(), puntaje: 4 })).toEqual(primera);
    });

    it('la misma clave con otro cuerpo: 422 sin llamar a M6, y queda la primera', async () => {
      const clienteId = await perfil();
      const viajeId = nuevoId();
      serv.responderCon(responde(viajeId, clienteId));
      const primera = await calificar(deCliente(clienteId), clienteId, 'clave-1', { viajeId, puntaje: 4 });
      serv.responderCon(responde(viajeId, clienteId));

      const error = await fallaCon(calificar(deCliente(clienteId), clienteId, 'clave-1', { viajeId, puntaje: 2 }));

      expect(error).toBeInstanceOf(IdempotenciaReutilizada);
      expect(serv.llamadas).toBe(0);
      expect(await calificar(deCliente(clienteId), clienteId, 'clave-1', { viajeId, puntaje: 4 })).toEqual(primera);
      expect(await filasDe(clienteId)).toEqual([expect.objectContaining({ puntaje: 4 })]);
    });

    it('una clave cuyo intento terminó en error se evalúa de nuevo', async () => {
      const clienteId = await perfil();
      const viajeId = nuevoId();
      const datos = { viajeId, puntaje: 5 };
      serv.responderCon(responde(viajeId, clienteId, { state: 'IN_PROGRESS', driverId: undefined }));
      expect(await fallaCon(calificar(deCliente(clienteId), clienteId, 'clave-1', datos))).toBeInstanceOf(ViajeNoCompletado);
      serv.responderCon(CAIDO);
      expect(await fallaCon(calificar(deCliente(clienteId), clienteId, 'clave-1', datos))).toBeInstanceOf(ModuloNoDisponible);
      serv.responderCon(responde(viajeId, clienteId));

      const respuesta = await calificar(deCliente(clienteId), clienteId, 'clave-1', datos);

      expect(respuesta.estado).toBe(201);
      expect(await filasDe(clienteId)).toHaveLength(1);
    });
  });

  describe('a la vez (RNF-08)', () => {
    it('diez con claves distintas: un 201, nueve 409 y una calificación', async () => {
      const clienteId = await perfil();
      const viajeId = nuevoId();
      serv.responderCon(responde(viajeId, clienteId));

      const resultados = await Promise.allSettled(
        Array.from({ length: 10 }, (_, n) => calificar(deCliente(clienteId), clienteId, `clave-${n}`, { viajeId, puntaje: 5 })),
      );

      const exitos = resultados.filter((resultado) => resultado.status === 'fulfilled');
      const rechazos = resultados.flatMap((resultado) => (resultado.status === 'rejected' ? [resultado.reason] : []));
      expect(exitos).toHaveLength(1);
      expect(rechazos).toHaveLength(9);
      for (const rechazo of rechazos) expect(rechazo).toBeInstanceOf(CalificacionDuplicada);
      expect(await filasDe(clienteId)).toHaveLength(1);
      expect(await reservasDe(clienteId)).toBe(1);
    });

    it('diez con la misma clave: un solo efecto y la misma respuesta para las diez', async () => {
      const clienteId = await perfil();
      const viajeId = nuevoId();
      serv.responderCon(responde(viajeId, clienteId));

      const respuestas = await Promise.all(
        Array.from({ length: 10 }, () => calificar(deCliente(clienteId), clienteId, 'clave-1', { viajeId, puntaje: 5 })),
      );

      expect(new Set(respuestas.map((respuesta) => JSON.stringify(respuesta))).size).toBe(1);
      expect(respuestas[0]?.estado).toBe(201);
      expect(await filasDe(clienteId)).toHaveLength(1);
      expect(await reservasDe(clienteId)).toBe(1);
    });

    it('una igual que se confirma entre la lectura de la respuesta y la del duplicado: recibe la respuesta, no un 409', async () => {
      const clienteId = await perfil();
      const viajeId = nuevoId();
      const datos = { viajeId, puntaje: 5 };
      serv.responderCon(responde(viajeId, clienteId));
      // La segunda solicitud ya leyó que no hay respuesta guardada; antes de buscar el duplicado, la primera termina entera.
      let primera: Promise<unknown> | undefined;
      const conLaPrimeraEnElMedio: BaseDeDatos = {
        tiempoBdMs: pool.tiempoBdMs,
        connect: () => pool.connect(),
        consultar: async <Fila extends QueryResultRow>(sql: string, parametros?: unknown[]) => {
          if (primera === undefined && sql.includes('FROM calificaciones WHERE cliente_id')) {
            primera = calificar(deCliente(clienteId), clienteId, 'clave-1', datos);
            await primera;
          }
          return pool.consultar<Fila>(sql, parametros);
        },
      };

      const segunda = await calificar(deCliente(clienteId), clienteId, 'clave-1', datos, conLaPrimeraEnElMedio);

      expect(primera).toBeDefined();
      expect(segunda).toEqual(await primera);
      expect(await filasDe(clienteId)).toHaveLength(1);
    });
  });

  describe('lo que llega al log (RNF-19)', () => {
    it('los errores no llevan tokens, comentarios, claves ni identificadores de viajes, conductores o calificaciones', async () => {
      const clienteId = await perfil();
      const comentario = 'Comentario-privado-del-cliente';
      const clave = 'clave-secreta-de-idempotencia';
      const viajes = Array.from({ length: 8 }, () => nuevoId());
      const datos = (n: number, extra: object = {}) => ({ viajeId: viajes[n] as string, puntaje: 5, comentario, ...extra });
      const errores: unknown[] = [];
      const tokens: string[] = [];
      const anotar = async (comportamiento: Comportamiento | Comportamiento[], n: number, claveUsada = `${clave}-${n}`, extra: object = {}) => {
        serv.responderCon(comportamiento);
        errores.push(await fallaCon(calificar(deCliente(clienteId), clienteId, claveUsada, datos(n, extra))));
        tokens.push(...serv.autorizaciones.flatMap((autorizacion) => (autorizacion === undefined ? [] : [autorizacion.replace('Bearer ', '')])));
      };

      serv.responderCon(responde(viajes[0] as string, clienteId));
      const creada = await calificar(deCliente(clienteId), clienteId, clave, datos(0));
      await anotar(CAIDO, 1);
      await anotar({ tipo: 'corta' }, 2);
      await anotar({ tipo: 'demora-cuerpo', retardoMs: 1000 }, 3);
      await anotar({ tipo: '4xx', estado: 403, cuerpo: { detail: viajes[4] } }, 4);
      await anotar(responde(viajes[5] as string, clienteId, { driverId: 'no-es-uuid' }), 5);
      await anotar(responde(viajes[6] as string, clienteId, { state: 'IN_PROGRESS' }), 6);
      await anotar({ tipo: '4xx', estado: 404 }, 7);
      await anotar(CAIDO, 0, clave, { puntaje: 1 });
      await anotar(CAIDO, 0, `${clave}-otra`);

      const texto = JSON.stringify(errores.map((error) => serializarError(error, [])));
      const prohibidos = [comentario, clave, CONDUCTOR, (creada.cuerpo as { calificacionId: string }).calificacionId, ...viajes, ...tokens];
      expect(tokens.length).toBeGreaterThan(0);
      expect(errores.map((error) => (error as Error).constructor.name)).toEqual([
        'ModuloNoDisponible',
        'ModuloNoDisponible',
        'ModuloNoDisponible',
        'ErrorDeIntegracion',
        'ModuloNoDisponible',
        'ViajeNoCompletado',
        'NoEncontrado',
        'IdempotenciaReutilizada',
        'CalificacionDuplicada',
      ]);
      for (const prohibido of prohibidos) expect(texto).not.toContain(prohibido);
    });
  });
});
