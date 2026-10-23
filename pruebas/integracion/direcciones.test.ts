import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../../src/bd/migraciones.js';
import { type BaseDePrueba, crearBaseDePrueba } from '../ayudas/bd.js';

// La migración de la spec 005: se crea con `--migrations-dir migraciones`, que le pone la marca de tiempo (plan, Datos).
const DIR_MIGRACIONES = fileURLToPath(new URL('../../migraciones', import.meta.url));
const MIGRACION = readdirSync(DIR_MIGRACIONES)
  .filter((archivo) => /^\d+_direcciones\.sql$/.test(archivo))
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
  (await filas(urlBd, `SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'direcciones_cliente'`)).length === 1;

// Las restricciones de la tabla, por nombre: su tipo (p, f, c) y su definición como la escribe PostgreSQL. Sin los NOT NULL,
// que PostgreSQL 18 también guarda en pg_constraint (tipo n): esos los mira `columnasConNulo`.
const restricciones = async (urlBd: string) =>
  Object.fromEntries(
    (
      await filas(
        urlBd,
        `SELECT conname, contype, pg_get_constraintdef(oid) AS definicion FROM pg_constraint
         WHERE conrelid = 'direcciones_cliente'::regclass AND contype <> 'n'`,
      )
    ).map((fila) => [fila.conname, { tipo: fila.contype, definicion: fila.definicion }]),
  );

// Las columnas que aceptan nulo, en orden alfabético.
const columnasConNulo = async (urlBd: string) =>
  (
    await filas(
      urlBd,
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'direcciones_cliente' AND is_nullable = 'YES' ORDER BY column_name`,
    )
  ).map((fila) => fila.column_name);

const indices = async (urlBd: string) =>
  (await filas(urlBd, `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'direcciones_cliente'`)).map(
    (fila) => String(fila.indexdef),
  );

describe('la migración direcciones (RF-2.2, RNF-05.1)', () => {
  let base: BaseDePrueba;
  let bd: Client;

  const perfil = (clienteId: string) =>
    bd.query(`INSERT INTO clientes (cliente_id, nombre, apellido, telefono) VALUES ($1, 'Ana', 'Gómez', '+5493624000000')`, [
      clienteId,
    ]);

  // Una dirección ficticia; cada prueba cambia solo lo que quiere probar.
  type Fila = {
    direccionId?: string;
    clienteId: string;
    tipo?: string;
    alias?: string | null;
    texto?: string | null;
    latitud?: number | null;
    longitud?: number | null;
  };
  const direccion = ({
    direccionId = nuevoId(),
    clienteId,
    tipo = 'FAVORITA',
    alias = null,
    texto = 'Calle Falsa 123',
    latitud = null,
    longitud = null,
  }: Fila) =>
    bd.query(
      `INSERT INTO direcciones_cliente (direccion_id, cliente_id, tipo, alias, texto, latitud, longitud)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [direccionId, clienteId, tipo, alias, texto, latitud, longitud],
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

  it('crea la tabla direcciones_cliente', async () => {
    expect(await hayTabla(base.urlBd)).toBe(true);
  });

  describe('claves, restricciones e índices', () => {
    it('clave primaria, clave foránea a clientes con borrado en cascada y checks con nombre propio', async () => {
      expect(await restricciones(base.urlBd)).toEqual({
        direcciones_cliente_pkey: { tipo: 'p', definicion: 'PRIMARY KEY (direccion_id)' },
        direcciones_cliente_cliente_id_fkey: {
          tipo: 'f',
          definicion: 'FOREIGN KEY (cliente_id) REFERENCES clientes(cliente_id) ON DELETE CASCADE',
        },
        direcciones_cliente_tipo_valido: { tipo: 'c', definicion: expect.stringContaining('tipo') },
        direcciones_cliente_texto_no_vacio: { tipo: 'c', definicion: expect.stringContaining('texto') },
        direcciones_cliente_coordenadas_validas: { tipo: 'c', definicion: expect.stringContaining('latitud') },
      });
    });

    // Opcionales: el alias y las coordenadas (RF-2.2). No hay actualizado_en: el contrato no lo expone (plan, Datos).
    it('acepta nulo solo en el alias y las coordenadas', async () => {
      expect(await columnasConNulo(base.urlBd)).toEqual(['alias', 'latitud', 'longitud']);
    });

    it('tiene los dos índices del listado: por cliente y por cliente y tipo, del más nuevo al más viejo', async () => {
      const definiciones = await indices(base.urlBd);

      expect(definiciones).toContainEqual(expect.stringContaining('(cliente_id, creado_en DESC, direccion_id DESC)'));
      expect(definiciones).toContainEqual(expect.stringContaining('(cliente_id, tipo, creado_en DESC, direccion_id DESC)'));
    });
  });

  describe('lo que la base acepta', () => {
    it('guarda una dirección solo con lo obligatorio y le pone la fecha de creación', async () => {
      const clienteId = nuevoId();
      await perfil(clienteId);
      const direccionId = nuevoId();
      await direccion({ direccionId, clienteId, tipo: 'RECIENTE' });

      const [fila] = (await bd.query(`SELECT * FROM direcciones_cliente WHERE direccion_id = $1`, [direccionId])).rows;
      expect(fila).toMatchObject({
        direccion_id: direccionId,
        cliente_id: clienteId,
        tipo: 'RECIENTE',
        alias: null,
        texto: 'Calle Falsa 123',
        latitud: null,
        longitud: null,
      });
      expect(fila.creado_en).toBeInstanceOf(Date);
    });

    it('guarda alias, coordenadas en los extremos del rango, un alias vacío y los límites de longitud', async () => {
      const clienteId = nuevoId();
      await perfil(clienteId);

      await direccion({ clienteId, alias: '', latitud: -90, longitud: -180 });
      await direccion({ clienteId, alias: 'a'.repeat(50), texto: 't'.repeat(255), latitud: 90, longitud: 180 });
      await direccion({ clienteId, latitud: 0, longitud: 0 });

      const guardadas = await bd.query(`SELECT 1 FROM direcciones_cliente WHERE cliente_id = $1`, [clienteId]);
      expect(guardadas.rowCount).toBe(3);
    });

    it('guarda dos veces el mismo texto del mismo cliente: no hay igualdad semántica (spec, casos límite)', async () => {
      const clienteId = nuevoId();
      await perfil(clienteId);

      await direccion({ clienteId });
      await direccion({ clienteId });

      const guardadas = await bd.query(`SELECT 1 FROM direcciones_cliente WHERE cliente_id = $1`, [clienteId]);
      expect(guardadas.rowCount).toBe(2);
    });
  });

  describe('lo que la base rechaza', () => {
    it('rechaza una dirección de un cliente que no existe', async () => {
      expect(await codigoDe(direccion({ clienteId: nuevoId() }))).toBe(CLAVE_FORANEA);
    });

    it('rechaza repetir el direccion_id', async () => {
      const clienteId = nuevoId();
      await perfil(clienteId);
      const direccionId = nuevoId();
      await direccion({ direccionId, clienteId });

      expect(await codigoDe(direccion({ direccionId, clienteId }))).toBe(UNICA);
    });

    it('rechaza un tipo que no es FAVORITA ni RECIENTE, ni en minúsculas', async () => {
      const clienteId = nuevoId();
      await perfil(clienteId);

      expect(await codigoDe(direccion({ clienteId, tipo: 'TRABAJO' }))).toBe(CHECK);
      expect(await codigoDe(direccion({ clienteId, tipo: 'favorita' }))).toBe(CHECK);
      expect(await codigoDe(direccion({ clienteId, tipo: '' }))).toBe(CHECK);
    });

    it('rechaza el texto vacío o ausente, y el de más de 255 caracteres', async () => {
      const clienteId = nuevoId();
      await perfil(clienteId);

      expect(await codigoDe(direccion({ clienteId, texto: '' }))).toBe(CHECK);
      expect(await codigoDe(direccion({ clienteId, texto: null }))).toBe(NO_NULO);
      expect(await codigoDe(direccion({ clienteId, texto: 't'.repeat(256) }))).toBe('22001');
    });

    it('rechaza un alias de más de 50 caracteres', async () => {
      const clienteId = nuevoId();
      await perfil(clienteId);

      expect(await codigoDe(direccion({ clienteId, alias: 'a'.repeat(51) }))).toBe('22001');
    });

    it('rechaza coordenadas incompletas: latitud sin longitud y longitud sin latitud', async () => {
      const clienteId = nuevoId();
      await perfil(clienteId);

      expect(await codigoDe(direccion({ clienteId, latitud: -27.45 }))).toBe(CHECK);
      expect(await codigoDe(direccion({ clienteId, longitud: -58.98 }))).toBe(CHECK);
    });

    it('rechaza una latitud fuera de [-90, 90] y una longitud fuera de [-180, 180]', async () => {
      const clienteId = nuevoId();
      await perfil(clienteId);

      expect(await codigoDe(direccion({ clienteId, latitud: 90.0001, longitud: 0 }))).toBe(CHECK);
      expect(await codigoDe(direccion({ clienteId, latitud: -90.0001, longitud: 0 }))).toBe(CHECK);
      expect(await codigoDe(direccion({ clienteId, latitud: 0, longitud: 180.0001 }))).toBe(CHECK);
      expect(await codigoDe(direccion({ clienteId, latitud: 0, longitud: -180.0001 }))).toBe(CHECK);
    });

    it('rechaza que un UPDATE deje las coordenadas incompletas o fuera de rango', async () => {
      const clienteId = nuevoId();
      await perfil(clienteId);
      const direccionId = nuevoId();
      await direccion({ direccionId, clienteId, latitud: 10, longitud: 20 });

      const incompleta = bd.query(`UPDATE direcciones_cliente SET latitud = NULL WHERE direccion_id = $1`, [direccionId]);
      expect(await codigoDe(incompleta)).toBe(CHECK);

      const fuera = bd.query(`UPDATE direcciones_cliente SET latitud = 91 WHERE direccion_id = $1`, [direccionId]);
      expect(await codigoDe(fuera)).toBe(CHECK);

      const vacio = bd.query(`UPDATE direcciones_cliente SET texto = '' WHERE direccion_id = $1`, [direccionId]);
      expect(await codigoDe(vacio)).toBe(CHECK);
    });

    it('borra en cascada las direcciones de un perfil que se borra, y no las de otro', async () => {
      const [uno, otro] = [nuevoId(), nuevoId()];
      await perfil(uno);
      await perfil(otro);
      await direccion({ clienteId: uno });
      await direccion({ clienteId: otro });

      await bd.query(`DELETE FROM clientes WHERE cliente_id = $1`, [uno]);

      const quedan = await bd.query(`SELECT cliente_id FROM direcciones_cliente WHERE cliente_id = ANY($1)`, [[uno, otro]]);
      expect(quedan.rows).toEqual([{ cliente_id: otro }]);
    });
  });
});

describe('la migración direcciones se revierte (RNF-05.1)', () => {
  let base: BaseDePrueba;

  beforeAll(async () => {
    base = await crearBaseDePrueba();
    await migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });
  });

  afterAll(async () => {
    await base?.borrar();
  });

  it('su Down Migration borra la tabla y deja las de perfiles, y se puede volver a aplicar', async () => {
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
