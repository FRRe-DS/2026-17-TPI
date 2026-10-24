import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../../src/bd/migraciones.js';
import { crearPool, type PoolBd } from '../../src/bd/pool.js';
import { NoEncontrado } from '../../src/errores.js';
import { guardarPreferencias, obtenerPreferencias } from '../../src/preferencias/repositorio.js';
import type { Preferencias } from '../../src/preferencias/modelo.js';
import { type BaseDePrueba, crearBaseDePrueba } from '../ayudas/bd.js';

const DIR = fileURLToPath(new URL('../../migraciones', import.meta.url));
const migraciones = () => readdirSync(DIR).filter((nombre) => /^\d+_preferencias\.sql$/.test(nombre));

describe('migración de preferencias (006/T1)', () => {
  let base: BaseDePrueba;
  let bd: Client;
  const perfil = async () => {
    const id = randomUUID();
    await bd.query(`INSERT INTO clientes (cliente_id, nombre, apellido, telefono) VALUES ($1, 'Ana', 'Ejemplo', '+5493624000000')`, [id]);
    return id;
  };

  beforeAll(async () => {
    base = await crearBaseDePrueba();
    await migrar({ urlBd: base.urlBd, tiempoBdMs: 2000 });
    bd = new Client({ connectionString: base.urlBd });
    await bd.connect();
  });
  afterAll(async () => { await bd?.end(); await base?.borrar(); });

  it('crea una única migración, PK/FK con cascada y función inmutable', async () => {
    expect(migraciones()).toHaveLength(1);
    const { rows } = await bd.query(`SELECT contype, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = 'preferencias_cliente'::regclass`);
    expect(rows).toContainEqual({ contype: 'p', definicion: 'PRIMARY KEY (cliente_id)' });
    expect(rows).toContainEqual({ contype: 'f', definicion: 'FOREIGN KEY (cliente_id) REFERENCES clientes(cliente_id) ON DELETE CASCADE' });
    expect((await bd.query(`SELECT provolatile FROM pg_proc WHERE oid = 'arreglo_sin_repetidos(text[])'::regprocedure`)).rows).toEqual([{ provolatile: 'i' }]);
  });

  it('pone tres listas vacías y observaciones nulas; admite todos los enumerados y observaciones de 255 caracteres', async () => {
    const id = await perfil();
    await bd.query('INSERT INTO preferencias_cliente (cliente_id) VALUES ($1)', [id]);
    expect((await bd.query('SELECT * FROM preferencias_cliente WHERE cliente_id = $1', [id])).rows[0]).toEqual({
      cliente_id: id, tipos_vehiculo: [], canales: [], accesibilidad: [], observaciones_accesibilidad: null,
    });
    await bd.query(`UPDATE preferencias_cliente SET tipos_vehiculo = ARRAY['AUTO','MOTO'], canales = ARRAY['EMAIL','SMS','PUSH'], accesibilidad = ARRAY['SILLA_DE_RUEDAS','ASISTENCIA_VISUAL','ASISTENCIA_AUDITIVA','ANIMAL_DE_ASISTENCIA'], observaciones_accesibilidad = $2 WHERE cliente_id = $1`, [id, 'x'.repeat(255)]);
  });

  it('rechaza perfiles inexistentes y filas duplicadas', async () => {
    await expect(bd.query('INSERT INTO preferencias_cliente (cliente_id) VALUES ($1)', [randomUUID()])).rejects.toMatchObject({ code: '23503' });
    const id = await perfil();
    await bd.query('INSERT INTO preferencias_cliente (cliente_id) VALUES ($1)', [id]);
    await expect(bd.query('INSERT INTO preferencias_cliente (cliente_id) VALUES ($1)', [id])).rejects.toMatchObject({ code: '23505' });
  });

  for (const [columna, valido] of [['tipos_vehiculo', 'AUTO'], ['canales', 'SMS'], ['accesibilidad', 'SILLA_DE_RUEDAS']] as const) {
    it.each([[['INVALIDO']], [[valido, valido]], [[null]], [[valido, null]]])(`rechaza enum, repetidos y elementos nulos en ${columna}: %j`, async (valores) => {
      // columna es una constante de esta prueba; los valores se parametrizan.
      await expect(bd.query(`INSERT INTO preferencias_cliente (cliente_id, ${columna}) VALUES ($1, $2)`, [await perfil(), valores])).rejects.toMatchObject({ code: '23514' });
    });
    it(`rechaza un arreglo nulo en ${columna}`, async () => {
      await expect(bd.query(`INSERT INTO preferencias_cliente (cliente_id, ${columna}) VALUES ($1, NULL)`, [await perfil()])).rejects.toMatchObject({ code: '23502' });
    });
  }

  it('rechaza observaciones demasiado largas y también un UPDATE inválido', async () => {
    const id = await perfil();
    await expect(bd.query('INSERT INTO preferencias_cliente (cliente_id, observaciones_accesibilidad) VALUES ($1, $2)', [id, 'x'.repeat(256)])).rejects.toMatchObject({ code: '22001' });
    await bd.query('INSERT INTO preferencias_cliente (cliente_id) VALUES ($1)', [id]);
    await expect(bd.query(`UPDATE preferencias_cliente SET canales = ARRAY['PUSH','PUSH'] WHERE cliente_id = $1`, [id])).rejects.toMatchObject({ code: '23514' });
    await bd.query('DELETE FROM clientes WHERE cliente_id = $1', [id]);
    expect((await bd.query('SELECT 1 FROM preferencias_cliente WHERE cliente_id = $1', [id])).rowCount).toBe(0);
  });

  it('revierte tabla y función sin tocar clientes y vuelve a aplicarse', async () => {
    const nombre = migraciones()[0];
    expect(nombre).toBeDefined();
    await runner({ dbClient: bd, dir: DIR, migrationsTable: 'migraciones_aplicadas', direction: 'down', file: nombre?.slice(0, -4), log: () => {} });
    expect((await bd.query(`SELECT to_regclass('preferencias_cliente') AS tabla, to_regprocedure('arreglo_sin_repetidos(text[])') AS funcion, to_regclass('clientes') AS clientes`)).rows[0]).toEqual({ tabla: null, funcion: null, clientes: 'clientes' });
    expect(await migrar({ urlBd: base.urlBd, tiempoBdMs: 2000 })).toEqual([nombre?.slice(0, -4)]);
  });
});

describe('consulta de preferencias (006/T2)', () => {
  let base: BaseDePrueba;
  let bd: Client;
  let pool: PoolBd;
  const consultar: PoolBd['consultar'] = (sql, valores) => pool.consultar(sql, valores);
  const perfil = async () => {
    const id = randomUUID();
    await bd.query(`INSERT INTO clientes (cliente_id, nombre, apellido, telefono) VALUES ($1, 'Ana', 'Ejemplo', '+5493624000000')`, [id]);
    return id;
  };
  beforeAll(async () => {
    base = await crearBaseDePrueba();
    await migrar({ urlBd: base.urlBd, tiempoBdMs: 2000 });
    bd = new Client({ connectionString: base.urlBd }); await bd.connect();
    pool = crearPool({ urlBd: base.urlBd, tiempoBdMs: 2000 });
  });
  afterAll(async () => { await pool?.end(); await bd?.end(); await base?.borrar(); });

  it('devuelve listas vacías sin insertar y no comparte objetos entre consultas', async () => {
    const id = await perfil();
    const datos = await obtenerPreferencias(consultar, id);
    expect(datos).toEqual({ tiposVehiculo: [], canales: [], accesibilidad: [] });
    datos.tiposVehiculo.push('MOTO');
    expect(await obtenerPreferencias(consultar, id)).toEqual({ tiposVehiculo: [], canales: [], accesibilidad: [] });
    expect((await bd.query('SELECT 1 FROM preferencias_cliente WHERE cliente_id = $1', [id])).rowCount).toBe(0);
  });
  it('sin perfil da NoEncontrado', async () => {
    await expect(obtenerPreferencias(consultar, randomUUID())).rejects.toBeInstanceOf(NoEncontrado);
  });
  it.each([null, '', 'Observación ficticia'])('lee exactamente las preferencias guardadas, con observaciones %j', async (observaciones) => {
    const id = await perfil();
    await bd.query(`INSERT INTO preferencias_cliente (cliente_id, tipos_vehiculo, canales, accesibilidad, observaciones_accesibilidad) VALUES ($1, ARRAY['MOTO','AUTO'], ARRAY['EMAIL'], ARRAY['ANIMAL_DE_ASISTENCIA'], $2)`, [id, observaciones]);
    expect(await obtenerPreferencias(consultar, id)).toEqual({ tiposVehiculo: ['MOTO', 'AUTO'], canales: ['EMAIL'], accesibilidad: ['ANIMAL_DE_ASISTENCIA'], ...(observaciones === null ? {} : { observacionesAccesibilidad: observaciones }) });
  });

  const uno: Preferencias = { tiposVehiculo: ['AUTO'], canales: ['SMS'], accesibilidad: ['SILLA_DE_RUEDAS'], observacionesAccesibilidad: 'Primer conjunto ficticio' };
  const otro: Preferencias = { tiposVehiculo: ['MOTO'], canales: ['PUSH', 'EMAIL'], accesibilidad: ['ANIMAL_DE_ASISTENCIA'], observacionesAccesibilidad: 'Segundo conjunto ficticio' };
  const vacio: Preferencias = { tiposVehiculo: [], canales: [], accesibilidad: [] };

  it('inserta, repite y reemplaza todo, incluidas listas vacías y observaciones omitidas (006/T3)', async () => {
    const id = await perfil();
    expect(await guardarPreferencias(consultar, id, uno)).toEqual(uno);
    expect(await guardarPreferencias(consultar, id, uno)).toEqual(uno);
    expect(await guardarPreferencias(consultar, id, otro)).toEqual(otro);
    expect(await obtenerPreferencias(consultar, id)).toEqual(otro);
    expect(await guardarPreferencias(consultar, id, vacio)).toEqual(vacio);
    expect(await obtenerPreferencias(consultar, id)).toEqual(vacio);
    expect((await bd.query('SELECT count(*)::integer AS total FROM preferencias_cliente WHERE cliente_id = $1', [id])).rows).toEqual([{ total: 1 }]);
  });

  it('no crea fila ni da un error de FK al guardar sin perfil (006/T3)', async () => {
    const id = randomUUID();
    await expect(guardarPreferencias(consultar, id, uno)).rejects.toBeInstanceOf(NoEncontrado);
    expect((await bd.query('SELECT 1 FROM preferencias_cliente WHERE cliente_id = $1', [id])).rowCount).toBe(0);
  });

  it.each([false, true])('concurrentes, con fila inicial=%j: cada respuesta es completa y queda una fila (006/T3)', async (conFila) => {
    // Ejercita tanto el conflicto entre INSERT como entre UPDATE. Cada respuesta debe
    // ser la propia solicitud; el estado final, una de ellas, nunca una mezcla.
    for (let corrida = 0; corrida < 8; corrida++) {
      const id = await perfil();
      if (conFila) await guardarPreferencias(consultar, id, vacio);
      const pedidos = [uno, otro, vacio, uno, otro];
      expect(await Promise.all(pedidos.map((datos) => guardarPreferencias(consultar, id, datos)))).toEqual(pedidos);
      expect(pedidos).toContainEqual(await obtenerPreferencias(consultar, id));
      expect((await bd.query('SELECT count(*)::integer AS total FROM preferencias_cliente WHERE cliente_id = $1', [id])).rows).toEqual([{ total: 1 }]);
    }
  });
});
