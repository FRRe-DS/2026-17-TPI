import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, inject, it, vi } from 'vitest';
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

    const aplicadas = await migrar({ urlBd: base.urlBd });

    expect(aplicadas).toEqual(delRepositorio);
    const anotadas = await filas(base.urlBd, 'SELECT name FROM migraciones_aplicadas ORDER BY id');
    expect(anotadas.map((fila) => fila.name)).toEqual(delRepositorio);
  });

  it('la migración inicial cambia el comentario del esquema', async () => {
    expect(await comentarioDelEsquema(base.urlBd)).not.toBe(COMENTARIO_INICIAL);

    await migrar({ urlBd: base.urlBd });

    expect(await comentarioDelEsquema(base.urlBd)).toBe(COMENTARIO_INICIAL);
  });

  it('una segunda corrida no aplica nada y deja lo anotado como estaba', async () => {
    await migrar({ urlBd: base.urlBd });
    const antes = await filas(base.urlBd, 'SELECT * FROM migraciones_aplicadas ORDER BY id');

    expect(await migrar({ urlBd: base.urlBd })).toEqual([]);

    expect(await filas(base.urlBd, 'SELECT * FROM migraciones_aplicadas ORDER BY id')).toEqual(antes);
  });

  // La conexión de migrar() se cierra sola, y con ella se libera el bloqueo de la migración (plan, Datos). El servidor
  // tarda unos milisegundos en dar de baja la sesión después de que el cliente se va, así que se espera un poco.
  it('cierra su conexión al terminar', async () => {
    await migrar({ urlBd: base.urlBd });

    const sesionesAjenas = `SELECT count(*)::int AS abiertas FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()`;
    await vi.waitFor(async () => expect((await filas(base.urlBd, sesionesAjenas))[0]?.abiertas).toBe(0), 2000);
  });

  it('manda lo que hace al log que recibe', async () => {
    const mensajes: string[] = [];

    await migrar({ urlBd: base.urlBd, log: (mensaje) => mensajes.push(mensaje) });

    for (const nombre of delRepositorio) expect(mensajes.join('\n')).toContain(nombre);
  });

  // La salida estándar solo lleva logs en JSON (RNF-14.5): node-pg-migrate escribiría en la consola si no le dan un log.
  it('sin log, no escribe nada en la consola', async () => {
    const espias = (['debug', 'error', 'info', 'log', 'warn'] as const).map((metodo) => vi.spyOn(console, metodo));

    await migrar({ urlBd: base.urlBd });

    for (const espia of espias) expect(espia).not.toHaveBeenCalled();
  });
});
