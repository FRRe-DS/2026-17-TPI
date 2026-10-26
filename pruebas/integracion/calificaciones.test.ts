import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../../src/bd/migraciones.js';
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
