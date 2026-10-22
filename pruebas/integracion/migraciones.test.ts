import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import net, { type AddressInfo, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PG_MIGRATE_LOCK_ID } from 'node-pg-migrate';
import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, inject, it, onTestFinished, vi } from 'vitest';
import { migrar } from '../../src/bd/migraciones.js';
import { type BaseDePrueba, crearBaseDePrueba } from '../ayudas/bd.js';
import { IMAGEN_POSTGRES } from '../ayudas/global.js';

// Lo que dice el repositorio: los archivos de migraciones/, en el orden en que se aplican. Con marcas de tiempo del mismo
// largo, ordenar el texto es ordenar por fecha.
const DIR_MIGRACIONES = fileURLToPath(new URL('../../migraciones', import.meta.url));
const delRepositorio = readdirSync(DIR_MIGRACIONES)
  .filter((archivo) => archivo.endsWith('.sql'))
  .map((archivo) => archivo.slice(0, -'.sql'.length))
  .sort();

const COMENTARIO_INICIAL = 'M2 Clientes: el esquema cambia solo con migraciones';

// El valor por defecto de M2_TIEMPO_BD_MS: de sobra para la base del contenedor, que contesta enseguida.
const TIEMPO_BD_MS = 2000;

// Lo que se acepta por encima de un tiempo esperado: la máquina de CI puede ir lenta.
const MARGEN_MS = 1000;

// Node puede disparar un temporizador unos milisegundos antes de lo que mide performance.now().
const TOLERANCIA_MS = 20;

// Una consulta con su propia conexión, que cierra al terminar.
async function filas(urlBd: string, sql: string): Promise<Record<string, unknown>[]> {
  const cliente = new Client({ connectionString: urlBd });
  await cliente.connect();
  try {
    return (await cliente.query(sql)).rows;
  } finally {
    await cliente.end();
  }
}

const comentarioDelEsquema = async (urlBd: string) =>
  (await filas(urlBd, `SELECT obj_description('public'::regnamespace, 'pg_namespace') AS comentario`))[0]?.comentario;

const tablas = async (urlBd: string) =>
  (await filas(urlBd, `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`)).map(
    (fila) => fila.tablename,
  );

const anotadas = async (urlBd: string) =>
  (await filas(urlBd, 'SELECT name FROM migraciones_aplicadas ORDER BY id')).map((fila) => fila.name);

// Las sesiones abiertas en la base, sin contar la de esta consulta.
const sesionesAjenas = async (urlBd: string) =>
  (
    await filas(
      urlBd,
      `SELECT count(*)::int AS abiertas FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`,
    )
  )[0]?.abiertas;

// Corta, desde una sesión aparte, las sesiones de la base que cumplen `donde`, como si la base se reiniciara. Devuelve
// cuántas cortó.
const cortarSesiones = async (urlBd: string, donde: string) =>
  (
    await filas(
      urlBd,
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> pg_backend_pid() AND ${donde}`,
    )
  ).length;

// Escribe una migración con el formato de las de migraciones/. El nombre va sin .sql y empieza con su marca de tiempo.
function sumarMigracion(carpeta: string, nombre: string, sql: string): void {
  writeFileSync(join(carpeta, `${nombre}.sql`), `-- Up Migration\n${sql}\n`);
}

// Una carpeta de migraciones armada por la prueba, que se borra cuando la prueba termina.
function carpetaDeMigraciones(migraciones: Record<string, string>): string {
  const carpeta = mkdtempSync(join(tmpdir(), 'm2-migraciones-'));
  onTestFinished(() => rmSync(carpeta, { recursive: true, force: true }));
  for (const [nombre, sql] of Object.entries(migraciones)) sumarMigracion(carpeta, nombre, sql);
  return carpeta;
}

// Un servidor que acepta la conexión y nunca contesta, como una base colgada. Se cierra cuando la prueba termina.
async function baseQueNoResponde(): Promise<{ urlBd: string; conexiones: () => number }> {
  const sockets = new Set<Socket>();
  const servidor = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
  });
  await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
  onTestFinished(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((listo) => servidor.close(listo));
  });
  const { port } = servidor.address() as AddressInfo;
  return { urlBd: `postgres://m2:clave@127.0.0.1:${port}/m2`, conexiones: () => sockets.size };
}

// La versión que fija el plan (Versiones a fijar), la misma de docker compose. Subirla es una decisión: se cambia acá,
// en IMAGEN_POSTGRES y en el compose.
const VERSION_DE_POSTGRES = '18.6';

describe('la base de las pruebas de integración (RNF-04.1, RNF-07.1)', () => {
  it('es PostgreSQL 18.6, de la imagen postgres:18.6', async () => {
    expect(IMAGEN_POSTGRES).toBe(`postgres:${VERSION_DE_POSTGRES}`);
    const [fila] = await filas(inject('urlBd'), 'SHOW server_version');
    // PostgreSQL informa "18.6 (Debian …)": la versión es lo que va antes del primer espacio.
    expect(String(fila?.server_version).split(' ')[0]).toBe(VERSION_DE_POSTGRES);
  });
});

describe('migrar (RNF-05.1)', () => {
  let base: BaseDePrueba;

  beforeEach(async () => {
    base = await crearBaseDePrueba();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await base.borrar();
  });

  it('el repositorio trae una migración inicial', () => {
    expect(delRepositorio.filter((nombre) => nombre.endsWith('_inicial'))).toHaveLength(1);
  });

  it('aplica las migraciones de migraciones/ y las anota en migraciones_aplicadas', async () => {
    await expect(filas(base.urlBd, 'SELECT name FROM migraciones_aplicadas')).rejects.toThrow(/migraciones_aplicadas/);

    const aplicadas = await migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });

    expect(aplicadas).toEqual(delRepositorio);
    expect(await anotadas(base.urlBd)).toEqual(delRepositorio);
  });

  it('la migración inicial cambia el comentario del esquema', async () => {
    expect(await comentarioDelEsquema(base.urlBd)).not.toBe(COMENTARIO_INICIAL);

    await migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });

    expect(await comentarioDelEsquema(base.urlBd)).toBe(COMENTARIO_INICIAL);
  });

  it('una segunda corrida no aplica nada y deja lo anotado como estaba', async () => {
    await migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });
    const antes = await filas(base.urlBd, 'SELECT * FROM migraciones_aplicadas ORDER BY id');

    expect(await migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS })).toEqual([]);

    expect(await filas(base.urlBd, 'SELECT * FROM migraciones_aplicadas ORDER BY id')).toEqual(antes);
  });

  // La conexión de migrar() se cierra sola, y con ella se libera el bloqueo de la migración (plan, Datos). El servidor
  // tarda unos milisegundos en dar de baja la sesión después de que el cliente se va, así que se espera un poco.
  it('cierra su conexión al terminar', async () => {
    await migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });

    await vi.waitFor(async () => expect(await sesionesAjenas(base.urlBd)).toBe(0), 2000);
  });

  it('manda lo que hace al log que recibe', async () => {
    const mensajes: string[] = [];

    await migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS, log: (mensaje) => mensajes.push(mensaje) });

    for (const nombre of delRepositorio) expect(mensajes.join('\n')).toContain(nombre);
  });

  // La salida estándar solo lleva logs en JSON (RNF-14.5): node-pg-migrate escribiría en la consola si no le dan un log.
  it('sin log, no escribe nada en la consola', async () => {
    const espias = (['debug', 'error', 'info', 'log', 'warn'] as const).map((metodo) => vi.spyOn(console, metodo));

    await migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });

    for (const espia of espias) expect(espia).not.toHaveBeenCalled();
  });
});

describe('migrar con otra corrida a la vez, errores y plazos (RNF-05.2, RNF-05.3)', () => {
  let base: BaseDePrueba;

  beforeEach(async () => {
    base = await crearBaseDePrueba();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await base.borrar();
  });

  // La primera migración tarda medio segundo con el bloqueo tomado: la otra corrida llega a pedirlo mientras tanto.
  it('con dos corridas a la vez, cada migración se aplica una sola vez', async () => {
    const dir = carpetaDeMigraciones({
      '1700000000000_lenta': 'CREATE TABLE corridas (n int); INSERT INTO corridas VALUES (1); SELECT pg_sleep(0.5);',
      '1700000000001_otra': 'INSERT INTO corridas VALUES (2);',
    });
    const opciones = { urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS, dir };

    const resultados = await Promise.all([migrar(opciones), migrar(opciones)]);

    // Una corrida aplica las dos; la otra espera a que termine y ya no encuentra nada pendiente.
    expect(resultados).toContainEqual([]);
    expect(resultados.flat()).toEqual(['1700000000000_lenta', '1700000000001_otra']);
    expect(await anotadas(base.urlBd)).toEqual(['1700000000000_lenta', '1700000000001_otra']);
    expect(await filas(base.urlBd, 'SELECT n FROM corridas ORDER BY n')).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('una migración que falla no deja cambios, y migrar devuelve su error', async () => {
    const dir = carpetaDeMigraciones({
      '1700000000000_anterior': 'CREATE TABLE anterior (id int);',
      '1700000000001_falla': 'CREATE TABLE a_medias (id int); INSERT INTO tabla_que_no_existe VALUES (1);',
      '1700000000002_siguiente': 'CREATE TABLE siguiente (id int);',
    });

    await expect(migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS, dir })).rejects.toThrow(/tabla_que_no_existe/);

    // Cada migración corre en su propia transacción: la anterior queda aplicada, de la que falla no queda nada (tampoco
    // a_medias) y la siguiente no se intenta.
    expect(await tablas(base.urlBd)).toEqual(['anterior', 'migraciones_aplicadas']);
    expect(await anotadas(base.urlBd)).toEqual(['1700000000000_anterior']);
  });

  it('una migración más vieja que otra ya aplicada se aplica igual', async () => {
    const dir = carpetaDeMigraciones({ '1800000000000_nueva': 'CREATE TABLE nueva (id int);' });
    await migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS, dir });
    // Como la de una spec que se mergea después de otra con una marca más nueva (plan, Decisiones).
    sumarMigracion(dir, '1700000000000_vieja', 'CREATE TABLE vieja (id int);');

    expect(await migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS, dir })).toEqual(['1700000000000_vieja']);

    expect(await tablas(base.urlBd)).toEqual(['migraciones_aplicadas', 'nueva', 'vieja']);
    expect(await anotadas(base.urlBd)).toEqual(['1800000000000_nueva', '1700000000000_vieja']);
  });

  it('una fase que no termina en el plazo falla sin dejar la migración aplicada ni a medias', async () => {
    const plazoMs = 1000;
    // Crea una tabla y después tarda más que el plazo.
    const dir = carpetaDeMigraciones({ '1700000000000_lenta': 'CREATE TABLE a_medias (id int); SELECT pg_sleep(2);' });
    const inicio = performance.now();

    await expect(migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS, plazoMs, dir })).rejects.toThrow(
      `Las migraciones no terminaron en ${plazoMs} ms`,
    );

    const demora = performance.now() - inicio;
    expect(demora).toBeGreaterThanOrEqual(plazoMs - TOLERANCIA_MS);
    expect(demora).toBeLessThan(plazoMs + MARGEN_MS);
    // La base termina la sentencia que estaba corriendo, ve que la conexión ya no está y deshace la migración. Lo que
    // quedó se mira cuando da de baja esa sesión.
    await vi.waitFor(async () => expect(await sesionesAjenas(base.urlBd)).toBe(0), 5000);
    expect(await tablas(base.urlBd)).toEqual(['migraciones_aplicadas']);
    expect(await anotadas(base.urlBd)).toEqual([]);
  }, 10_000);

  // El plazo se arma con un temporizador: si quedara armado, un proceso que solo migra tardaría 60 s en terminar.
  it('al terminar no deja temporizadores pendientes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    await migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });

    expect(vi.getTimerCount()).toBe(0);
  });
});

// Si la base corta la conexión, pg emite 'error' en el cliente de migrar: sin un oyente, eso tira el proceso, y Vitest lo
// cuenta como error de la corrida.
describe('migrar con la base que corta la conexión (RNF-05.3, RNF-14.5)', () => {
  let base: BaseDePrueba;

  beforeEach(async () => {
    base = await crearBaseDePrueba();
  });

  afterEach(async () => {
    await base.borrar();
  });

  it('en medio de una migración: falla con el corte y la migración no queda aplicada', async () => {
    const dir = carpetaDeMigraciones({ '1700000000000_lenta': 'CREATE TABLE a_medias (id int); SELECT pg_sleep(5);' });
    const corrida = migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS, dir });
    corrida.catch(() => {});

    // Hasta que migrar no manda la migración, no hay qué cortar.
    await vi.waitFor(async () => expect(await cortarSesiones(base.urlBd, `query LIKE '%pg_sleep%'`)).toBe(1), {
      timeout: 3000,
      interval: 20,
    });

    // 57P01 (admin_shutdown): la base terminó la sesión.
    await expect(corrida).rejects.toMatchObject({ code: '57P01' });
    expect(await tablas(base.urlBd)).toEqual(['migraciones_aplicadas']);
    expect(await anotadas(base.urlBd)).toEqual([]);
  });

  it('mientras espera el bloqueo que tiene otra sesión: falla con el corte y no aplica nada', async () => {
    const otraSesion = new Client({ connectionString: base.urlBd });
    // Si la prueba falla antes de cerrarla, la base la corta al borrarse: ese error no importa.
    otraSesion.on('error', () => {});
    await otraSesion.connect();
    try {
      await otraSesion.query(`SELECT pg_advisory_lock(${PG_MIGRATE_LOCK_ID})`);
      const corrida = migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });
      corrida.catch(() => {});

      const esperaUnBloqueo = `pid IN (SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND NOT granted)`;
      await vi.waitFor(async () => expect(await cortarSesiones(base.urlBd, esperaUnBloqueo)).toBe(1), {
        timeout: 3000,
        interval: 20,
      });

      await expect(corrida).rejects.toMatchObject({ code: '57P01' });
      expect(await tablas(base.urlBd)).toEqual([]);
    } finally {
      await otraSesion.end();
    }
  });
});

describe('migrar con una base que no contesta (RNF-05.3)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('falla en el tiempo de base más un margen', async () => {
    const colgada = await baseQueNoResponde();
    const tiempoBdMs = 500;
    const inicio = performance.now();

    await expect(migrar({ urlBd: colgada.urlBd, tiempoBdMs })).rejects.toThrow();

    const demora = performance.now() - inicio;
    expect(colgada.conexiones()).toBe(1);
    expect(demora).toBeGreaterThanOrEqual(tiempoBdMs - TOLERANCIA_MS);
    expect(demora).toBeLessThan(tiempoBdMs + MARGEN_MS);
  });

  // Con un tiempo de base más largo que el plazo, lo único que puede cortar la espera es el plazo.
  it('sin plazoMs, corta a los 60 s aunque el tiempo de base sea mayor', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const colgada = await baseQueNoResponde();
    let resultado: string | undefined;
    const fin = migrar({ urlBd: colgada.urlBd, tiempoBdMs: 120_000 }).then(
      () => (resultado = 'terminó'),
      (error: Error) => (resultado = error.message),
    );

    await vi.advanceTimersByTimeAsync(59_999);
    expect(resultado).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await fin;

    expect(resultado).toBe('Las migraciones no terminaron en 60000 ms');
  });
});
