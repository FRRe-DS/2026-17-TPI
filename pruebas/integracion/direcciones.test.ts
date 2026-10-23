import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../../src/bd/migraciones.js';
import { crearPool, type PoolBd } from '../../src/bd/pool.js';
import type { Consultar } from '../../src/bd/transaccion.js';
import { crearDireccion, listarDirecciones, obtenerDireccion } from '../../src/direcciones/repositorio.js';
import { Conflicto, NoEncontrado } from '../../src/errores.js';
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

describe('el repositorio de direcciones: alta y consulta por cliente (RF-2.2, RF-2.2.2, RF-2.2.2.1)', () => {
  let base: BaseDePrueba;
  let pool: PoolBd;

  const consultar: Consultar = (sql, parametros) => pool.consultar(sql, parametros);

  const perfil = (clienteId: string) =>
    consultar(`INSERT INTO clientes (cliente_id, nombre, apellido, telefono) VALUES ($1, 'Ana', 'Gómez', '+5493624000000')`, [
      clienteId,
    ]);

  const cliente = async () => {
    const clienteId = nuevoId();
    await perfil(clienteId);
    return clienteId;
  };

  beforeAll(async () => {
    base = await crearBaseDePrueba();
    await migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });
    pool = crearPool({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });
  });

  afterAll(async () => {
    await pool?.end();
    await base?.borrar();
  });

  describe('crearDireccion()', () => {
    it('con todos los datos, devuelve la dirección del contrato y la guarda con el id y el cliente dados', async () => {
      const clienteId = await cliente();
      const direccionId = nuevoId();

      const creada = await crearDireccion(consultar, clienteId, direccionId, {
        tipo: 'FAVORITA',
        alias: 'Casa',
        texto: 'Calle Falsa 123',
        coordenadas: { latitud: -27.4511, longitud: -58.9867 },
      });

      expect(creada).toEqual({
        direccionId,
        tipo: 'FAVORITA',
        alias: 'Casa',
        texto: 'Calle Falsa 123',
        coordenadas: { latitud: -27.4511, longitud: -58.9867 },
        creadoEn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      });
      const guardada = await pool.consultar(
        'SELECT cliente_id, tipo, alias, texto, latitud::float8 AS latitud, longitud::float8 AS longitud FROM direcciones_cliente WHERE direccion_id = $1',
        [direccionId],
      );
      expect(guardada.rows).toEqual([
        { cliente_id: clienteId, tipo: 'FAVORITA', alias: 'Casa', texto: 'Calle Falsa 123', latitud: -27.4511, longitud: -58.9867 },
      ]);
    });

    it('solo con lo obligatorio, no trae alias ni coordenadas y la base guarda nulos', async () => {
      const clienteId = await cliente();
      const direccionId = nuevoId();

      const creada = await crearDireccion(consultar, clienteId, direccionId, {
        tipo: 'RECIENTE',
        texto: 'Av. Sarmiento 1234',
      });

      expect(creada).toEqual({
        direccionId,
        tipo: 'RECIENTE',
        texto: 'Av. Sarmiento 1234',
        creadoEn: expect.any(String),
      });
      const guardada = await pool.consultar('SELECT alias, latitud, longitud FROM direcciones_cliente WHERE direccion_id = $1', [
        direccionId,
      ]);
      expect(guardada.rows).toEqual([{ alias: null, latitud: null, longitud: null }]);
    });

    it('un alias vacío se guarda vacío y vuelve vacío, no ausente', async () => {
      const clienteId = await cliente();

      const creada = await crearDireccion(consultar, clienteId, nuevoId(), {
        tipo: 'FAVORITA',
        alias: '',
        texto: 'Calle Falsa 123',
      });

      expect(creada.alias).toBe('');
    });

    it('guarda las coordenadas en los extremos y en el cero, sin perder el valor', async () => {
      const clienteId = await cliente();

      const extremos = await crearDireccion(consultar, clienteId, nuevoId(), {
        tipo: 'FAVORITA',
        texto: 'Polo',
        coordenadas: { latitud: -90, longitud: 180 },
      });
      const cero = await crearDireccion(consultar, clienteId, nuevoId(), {
        tipo: 'FAVORITA',
        texto: 'Origen',
        coordenadas: { latitud: 0, longitud: 0 },
      });
      const chica = await crearDireccion(consultar, clienteId, nuevoId(), {
        tipo: 'FAVORITA',
        texto: 'Casi origen',
        coordenadas: { latitud: 1e-7, longitud: -1.5e-7 },
      });

      expect(extremos.coordenadas).toEqual({ latitud: -90, longitud: 180 });
      expect(cero.coordenadas).toEqual({ latitud: 0, longitud: 0 });
      expect(chica.coordenadas).toEqual({ latitud: 1e-7, longitud: -1.5e-7 });
    });

    it('la fecha de creación la pone la base y la respuesta coincide con la que se lee después', async () => {
      const clienteId = await cliente();
      const direccionId = nuevoId();

      const antes = Date.now();
      const creada = await crearDireccion(consultar, clienteId, direccionId, { tipo: 'FAVORITA', texto: 'X' });
      const despues = Date.now();

      expect(Date.parse(creada.creadoEn)).toBeGreaterThanOrEqual(antes - 5000);
      expect(Date.parse(creada.creadoEn)).toBeLessThanOrEqual(despues + 5000);
      expect(await obtenerDireccion(consultar, clienteId, direccionId)).toEqual(creada);
    });

    it('el texto y el alias van como parámetros: comillas y punto y coma se guardan tal cual', async () => {
      const clienteId = await cliente();
      const texto = `Calle O'Higgins 1; DROP TABLE direcciones_cliente; --`;

      const creada = await crearDireccion(consultar, clienteId, nuevoId(), {
        tipo: 'FAVORITA',
        alias: `Mi "casa"`,
        texto,
      });

      expect(creada.texto).toBe(texto);
      expect(creada.alias).toBe('Mi "casa"');
    });

    it('el mismo contenido dos veces con ids distintos da dos direcciones: la spec no define igualdad semántica', async () => {
      const clienteId = await cliente();
      const datos = { tipo: 'FAVORITA' as const, texto: 'Calle Falsa 123' };

      const una = await crearDireccion(consultar, clienteId, nuevoId(), datos);
      const otra = await crearDireccion(consultar, clienteId, nuevoId(), datos);

      expect(una.direccionId).not.toBe(otra.direccionId);
    });

    it('un id repetido da la restricción única de la base, que clasifica consultar() como Conflicto', async () => {
      const clienteId = await cliente();
      const direccionId = nuevoId();
      await crearDireccion(consultar, clienteId, direccionId, { tipo: 'FAVORITA', texto: 'A' });

      const error = await crearDireccion(consultar, clienteId, direccionId, { tipo: 'FAVORITA', texto: 'B' }).then(
        () => undefined,
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(Conflicto);
    });
  });

  describe('obtenerDireccion()', () => {
    it('devuelve la dirección del cliente con las mismas formas que el alta, con y sin opcionales', async () => {
      const clienteId = await cliente();
      const completa = await crearDireccion(consultar, clienteId, nuevoId(), {
        tipo: 'FAVORITA',
        alias: 'Casa',
        texto: 'Calle Falsa 123',
        coordenadas: { latitud: -27.4511, longitud: -58.9867 },
      });
      const minima = await crearDireccion(consultar, clienteId, nuevoId(), { tipo: 'RECIENTE', texto: 'Plaza 25' });

      expect(await obtenerDireccion(consultar, clienteId, completa.direccionId)).toEqual(completa);
      expect(await obtenerDireccion(consultar, clienteId, minima.direccionId)).toEqual(minima);
    });

    it('una dirección que existe bajo otro cliente es NoEncontrado, igual que una que no existe', async () => {
      const propietario = await cliente();
      const otro = await cliente();
      const ajena = await crearDireccion(consultar, propietario, nuevoId(), { tipo: 'FAVORITA', texto: 'Privada' });

      const deOtro = await obtenerDireccion(consultar, otro, ajena.direccionId).then(
        () => undefined,
        (e: unknown) => e,
      );
      const inexistente = await obtenerDireccion(consultar, otro, nuevoId()).then(
        () => undefined,
        (e: unknown) => e,
      );

      expect(deOtro).toBeInstanceOf(NoEncontrado);
      expect(inexistente).toBeInstanceOf(NoEncontrado);
      expect((deOtro as NoEncontrado).detail).toBe((inexistente as NoEncontrado).detail);
    });

    it('un cliente sin perfil tampoco encuentra nada', async () => {
      const error = await obtenerDireccion(consultar, nuevoId(), nuevoId()).then(
        () => undefined,
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(NoEncontrado);
    });

    it('el mismo id pedido con el cliente propietario sigue encontrándose después de buscarlo bajo otro', async () => {
      const propietario = await cliente();
      const otro = await cliente();
      const propia = await crearDireccion(consultar, propietario, nuevoId(), { tipo: 'FAVORITA', texto: 'Mía' });
      await obtenerDireccion(consultar, otro, propia.direccionId).catch(() => undefined);

      expect(await obtenerDireccion(consultar, propietario, propia.direccionId)).toEqual(propia);
    });
  });

  describe('listarDirecciones() (RF-2.2.1)', () => {
    // Un cliente con cinco direcciones de creación conocida: tres favoritas y dos recientes, y dos de la misma creación para
    // el desempate por direccionId. `creadoEn` es un intervalo desde el 1 de enero de 2026.
    const conDirecciones = async () => {
      const clienteId = await cliente();
      const poner = (texto: string, tipo: string, creadoEn: string, direccionId = nuevoId()) =>
        consultar(
          `INSERT INTO direcciones_cliente (direccion_id, cliente_id, tipo, texto, creado_en)
           VALUES ($1, $2, $3, $4, '2026-01-01T00:00:00Z'::timestamptz + $5::interval)`,
          [direccionId, clienteId, tipo, texto, creadoEn],
        );
      // Los dos de la misma creación: el de direccionId mayor va primero.
      const [menor, mayor] = [nuevoId(), nuevoId()].sort();
      await poner('Primera', 'FAVORITA', '1 hour');
      await poner('Segunda', 'RECIENTE', '2 hours');
      await poner('Tercera', 'FAVORITA', '3 hours');
      await poner('Empate menor', 'RECIENTE', '4 hours', menor);
      await poner('Empate mayor', 'FAVORITA', '4 hours', mayor);
      return clienteId;
    };
    const textos = (pagina: Awaited<ReturnType<typeof listarDirecciones>>) => pagina.items.map((d) => d.texto);

    it('la lista completa, de la más nueva a la más antigua, con desempate estable por direccionId', async () => {
      const clienteId = await conDirecciones();

      const pagina = await listarDirecciones(consultar, clienteId, { page: 0, size: 20 });

      expect(textos(pagina)).toEqual(['Empate mayor', 'Empate menor', 'Tercera', 'Segunda', 'Primera']);
      expect(pagina).toMatchObject({ page: 0, size: 20, totalElementos: 5, totalPaginas: 1 });
    });

    it('tipo=FAVORITA deja solo las favoritas, y tipo=RECIENTE solo las recientes, con sus totales', async () => {
      const clienteId = await conDirecciones();

      const favoritas = await listarDirecciones(consultar, clienteId, { tipo: 'FAVORITA', page: 0, size: 20 });
      const recientes = await listarDirecciones(consultar, clienteId, { tipo: 'RECIENTE', page: 0, size: 20 });

      expect([textos(favoritas), favoritas.totalElementos]).toEqual([['Empate mayor', 'Tercera', 'Primera'], 3]);
      expect([textos(recientes), recientes.totalElementos]).toEqual([['Empate menor', 'Segunda'], 2]);
      expect(favoritas.items.every((d) => d.tipo === 'FAVORITA')).toBe(true);
      expect(recientes.items.every((d) => d.tipo === 'RECIENTE')).toBe(true);
    });

    it('las páginas recorren la lista sin repetir ni saltear, y la última puede quedar corta', async () => {
      const clienteId = await conDirecciones();

      const paginas = await Promise.all([0, 1, 2].map((page) => listarDirecciones(consultar, clienteId, { page, size: 2 })));

      expect(paginas.map(textos)).toEqual([['Empate mayor', 'Empate menor'], ['Tercera', 'Segunda'], ['Primera']]);
      expect(paginas.map((p) => [p.page, p.size, p.totalElementos, p.totalPaginas])).toEqual([
        [0, 2, 5, 3],
        [1, 2, 5, 3],
        [2, 2, 5, 3],
      ]);
    });

    it('la paginación respeta el filtro: el total y las páginas son los de las favoritas', async () => {
      const clienteId = await conDirecciones();

      const primera = await listarDirecciones(consultar, clienteId, { tipo: 'FAVORITA', page: 0, size: 2 });
      const segunda = await listarDirecciones(consultar, clienteId, { tipo: 'FAVORITA', page: 1, size: 2 });

      expect([textos(primera), textos(segunda)]).toEqual([['Empate mayor', 'Tercera'], ['Primera']]);
      expect([primera.totalElementos, primera.totalPaginas]).toEqual([3, 2]);
    });

    it('con size=1 devuelve una por página, y con size=100 (el máximo del contrato) las trae todas', async () => {
      const clienteId = await conDirecciones();

      const una = await listarDirecciones(consultar, clienteId, { page: 4, size: 1 });
      const todas = await listarDirecciones(consultar, clienteId, { page: 0, size: 100 });

      expect([textos(una), una.totalPaginas]).toEqual([['Primera'], 5]);
      expect([todas.items.length, todas.totalPaginas]).toEqual([5, 1]);
    });

    it('una página fuera del total es una página vacía con los totales correctos', async () => {
      const clienteId = await conDirecciones();

      const pagina = await listarDirecciones(consultar, clienteId, { page: 7, size: 2 });
      const filtrada = await listarDirecciones(consultar, clienteId, { tipo: 'RECIENTE', page: 3, size: 2 });

      expect(pagina).toEqual({ page: 7, size: 2, totalElementos: 5, totalPaginas: 3, items: [] });
      expect(filtrada).toEqual({ page: 3, size: 2, totalElementos: 2, totalPaginas: 1, items: [] });
    });

    it('una página enorme no desborda el OFFSET de la base: da una página vacía', async () => {
      const clienteId = await conDirecciones();

      const pagina = await listarDirecciones(consultar, clienteId, { page: Number.MAX_SAFE_INTEGER, size: 100 });

      expect(pagina).toMatchObject({ totalElementos: 5, items: [] });
    });

    it('un cliente con perfil y sin direcciones: página vacía, cero elementos y cero páginas', async () => {
      const clienteId = await cliente();

      expect(await listarDirecciones(consultar, clienteId, { page: 0, size: 20 })).toEqual({
        page: 0,
        size: 20,
        totalElementos: 0,
        totalPaginas: 0,
        items: [],
      });
    });

    it('nunca trae direcciones de otro cliente, ni en los items ni en los totales', async () => {
      const clienteId = await conDirecciones();
      const otro = await cliente();
      await crearDireccion(consultar, otro, nuevoId(), { tipo: 'FAVORITA', texto: 'De otro' });

      const suyas = await listarDirecciones(consultar, otro, { page: 0, size: 20 });
      const mias = await listarDirecciones(consultar, clienteId, { page: 0, size: 20 });

      expect(textos(suyas)).toEqual(['De otro']);
      expect(suyas.totalElementos).toBe(1);
      expect(textos(mias)).not.toContain('De otro');
      expect(mias.totalElementos).toBe(5);
    });

    it('un cliente sin perfil es NoEncontrado, con o sin filtro', async () => {
      const sinFiltro = await listarDirecciones(consultar, nuevoId(), { page: 0, size: 20 }).then(
        () => undefined,
        (e: unknown) => e,
      );
      const conFiltro = await listarDirecciones(consultar, nuevoId(), { tipo: 'FAVORITA', page: 0, size: 20 }).then(
        () => undefined,
        (e: unknown) => e,
      );

      expect(sinFiltro).toBeInstanceOf(NoEncontrado);
      expect(conFiltro).toBeInstanceOf(NoEncontrado);
    });

    it('el texto y el alias de lo listado salen con la misma forma que la consulta individual', async () => {
      const clienteId = await cliente();
      const creada = await crearDireccion(consultar, clienteId, nuevoId(), {
        tipo: 'FAVORITA',
        alias: 'Casa',
        texto: 'Calle Falsa 123',
        coordenadas: { latitud: -27.4511, longitud: -58.9867 },
      });
      const sin = await crearDireccion(consultar, clienteId, nuevoId(), { tipo: 'RECIENTE', texto: 'Plaza 25' });

      const pagina = await listarDirecciones(consultar, clienteId, { page: 0, size: 20 });

      expect(pagina.items).toEqual([sin, creada]);
    });
  });
});
