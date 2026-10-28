import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../../../src/bd/migraciones.js';
import { crearBaseDemo } from '../../../panel/servidor/demo/base.js';
import { probarRestriccion } from '../../../panel/servidor/demo/restriccion.js';
import { crearBaseDePrueba, type BaseDePrueba } from '../../ayudas/bd.js';

// La prueba de la restricción del puntaje (spec 072, T3): la base rechaza un puntaje 9 con su CHECK, y la prueba no deja nada
// (RNF-05.5, RNF-05.4). PostgreSQL real, con las migraciones de M2.
let base: BaseDePrueba;
let acceso: ReturnType<typeof crearBaseDemo>;

beforeAll(async () => {
  base = await crearBaseDePrueba();
  await migrar({ urlBd: base.urlBd, tiempoBdMs: 2000 });
  acceso = crearBaseDemo(base.urlBd);
});

afterAll(async () => {
  await acceso.cerrar();
  await base.borrar();
});

// La calificación necesita un cliente existente (clave foránea): en la vista lo crea M2, acá se inserta.
async function crearCliente(): Promise<string> {
  const clienteId = randomUUID();
  await acceso.pool?.query("INSERT INTO clientes (cliente_id, nombre, apellido, telefono) VALUES ($1, 'Ana', 'Pérez', '+5491122334455')", [clienteId]);
  return clienteId;
}

const total = async (tabla: 'calificaciones' | 'clientes') =>
  Number((await acceso.pool?.query<{ n: string }>(`SELECT count(*) AS n FROM ${tabla}`))?.rows[0]?.n);

describe('probarRestriccion con la base real (RNF-05.5)', () => {
  it('la base rechaza el puntaje 9 con la restricción calificaciones_puntaje_valido, código 23514 y su mensaje', async () => {
    const clienteId = await crearCliente();

    const resultado = await probarRestriccion(acceso, clienteId);

    expect(resultado).toMatchObject({
      clienteId,
      filasAntes: 0,
      filasDespues: 0,
      restriccion: 'calificaciones_puntaje_valido',
      codigo: '23514',
      cumple: true,
    });
    expect(resultado.mensaje).toContain('calificaciones_puntaje_valido');
  });

  it('las filas de antes y de después son iguales, y no queda ninguna fila nueva en toda la tabla', async () => {
    const clienteId = await crearCliente();
    const antes = await total('calificaciones');

    const resultado = await probarRestriccion(acceso, clienteId);

    expect(resultado.filasAntes).toBe(resultado.filasDespues);
    expect(await total('calificaciones')).toBe(antes);
  });

  it('no deja una transacción abierta ni una conexión ocupada', async () => {
    const clienteId = await crearCliente();

    await probarRestriccion(acceso, clienteId);

    const abiertas = await acceso.pool?.query<{ n: string }>(
      "SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%'",
    );
    expect(Number(abiertas?.rows[0]?.n)).toBe(0);
    expect(acceso.pool?.idleCount).toBe(acceso.pool?.totalCount);
    expect(acceso.pool?.waitingCount).toBe(0);
  });

  it('se puede repetir: cada corrida da lo mismo', async () => {
    const clienteId = await crearCliente();

    const primera = await probarRestriccion(acceso, clienteId);
    const segunda = await probarRestriccion(acceso, clienteId);

    expect(segunda).toEqual(primera);
  });

  it('cuenta las calificaciones que el cliente ya tenía y no las toca', async () => {
    const clienteId = await crearCliente();
    await acceso.pool?.query(
      'INSERT INTO calificaciones (calificacion_id, cliente_id, viaje_id, conductor_id, puntaje) VALUES ($1, $2, $3, $4, 4)',
      [randomUUID(), clienteId, randomUUID(), randomUUID()],
    );

    const resultado = await probarRestriccion(acceso, clienteId);

    expect(resultado).toMatchObject({ filasAntes: 1, filasDespues: 1, cumple: true });
  });

  // PostgreSQL revisa los CHECK de la fila antes que las claves foráneas (que se comprueban al final de la sentencia): el puntaje
  // 9 se rechaza por su propia restricción aunque el cliente no exista.
  it('con un cliente inexistente igual se rechaza por el puntaje y no por la clave foránea', async () => {
    const resultado = await probarRestriccion(acceso, randomUUID());

    expect(resultado).toMatchObject({ restriccion: 'calificaciones_puntaje_valido', codigo: '23514', cumple: true });
  });
});

describe('probarRestriccion con un pool de mentira', () => {
  type Cliente = { query: (sql: string) => Promise<unknown>; release: (descartar?: unknown) => void };

  // Un pool cuya inserción NO falla (la restricción «falta») y que anota qué se le pidió.
  function poolQueAcepta() {
    const sentencias: string[] = [];
    const liberadas: unknown[] = [];
    const cliente: Cliente = {
      query: async (sql: string) => {
        sentencias.push(sql.trim().split(/\s+/)[0] ?? '');
        return { rows: [] };
      },
      release: (descartar) => liberadas.push(descartar === true ? 'descartada' : 'bien'),
    };
    const pool = { connect: async () => cliente };
    return { pool, sentencias, liberadas };
  }
  const contarCero = async () => ({ filas: 0 });

  it('si la inserción no fallara, cumple es false y se deshace igual', async () => {
    const { pool, sentencias, liberadas } = poolQueAcepta();

    const resultado = await probarRestriccion({ pool: pool as never, contarCalificaciones: contarCero }, randomUUID());

    expect(resultado.cumple).toBe(false);
    expect(resultado.restriccion).toBeUndefined();
    expect(resultado.mensaje).toContain('aceptó el puntaje 9');
    expect(sentencias).toEqual(['BEGIN', 'INSERT', 'ROLLBACK']);
    expect(liberadas).toEqual(['bien']);
  });

  it('si el ROLLBACK falla, descarta la conexión en vez de devolverla al pool', async () => {
    const liberadas: unknown[] = [];
    const cliente = {
      query: async (sql: string) => {
        if (sql.startsWith('ROLLBACK')) throw new Error('conexión caída');
        return { rows: [] };
      },
      release: (descartar?: unknown) => liberadas.push(descartar === true ? 'descartada' : 'bien'),
    };

    const resultado = await probarRestriccion(
      { pool: { connect: async () => cliente } as never, contarCalificaciones: contarCero },
      randomUUID(),
    );

    expect(resultado.cumple).toBe(false);
    expect(liberadas).toEqual(['descartada']);
  });

  // Una falla de la base que no es la restricción (acá, una sentencia cortada por el tiempo) no cuenta como cumplida.
  it('si la inserción falla por otra razón, informa su código y no cumple', async () => {
    const cortada = Object.assign(new pg.DatabaseError('canceling statement due to statement timeout', 0, 'error'), { code: '57014' });
    const cliente = {
      query: async (sql: string) => {
        if (sql.startsWith('INSERT')) throw cortada;
        return { rows: [] };
      },
      release: () => {},
    };

    const resultado = await probarRestriccion({ pool: { connect: async () => cliente } as never, contarCalificaciones: contarCero }, randomUUID());

    expect(resultado).toMatchObject({ codigo: '57014', cumple: false });
    expect(resultado.restriccion).toBeUndefined();
  });

  it('si no consigue conexión, no cumple y dice por qué sin repetir la dirección', async () => {
    const pool = {
      connect: async () => {
        throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5433'), { code: 'ECONNREFUSED' });
      },
    };

    const resultado = await probarRestriccion({ pool: pool as never, contarCalificaciones: contarCero }, randomUUID());

    expect(resultado.cumple).toBe(false);
    expect(resultado.mensaje).toContain('ECONNREFUSED');
    expect(JSON.stringify(resultado)).not.toContain('127.0.0.1');
  });
});

describe('probarRestriccion sin la base', () => {
  it('sin PANEL_URL_BD no cumple, con el motivo, y filas null', async () => {
    const sinBase = crearBaseDemo(undefined);

    const resultado = await probarRestriccion(sinBase, randomUUID());

    expect(resultado).toMatchObject({ filasAntes: null, filasDespues: null, cumple: false });
    expect(resultado.mensaje).toContain('no configurada');
    await sinBase.cerrar();
  });
});
