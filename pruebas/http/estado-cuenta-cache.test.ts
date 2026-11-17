import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BaseDeDatos } from '../../src/bd/pool.js';
import { crearBloqueo, levantarBloqueo, obtenerEstadoCuenta } from '../../src/clientes/operaciones.js';
import { cargarContrato } from '../../src/contrato/cargar.js';
import { crearApp, POOL_FALSO } from '../ayudas/app.js';
import { levantarRedisFalso, type RedisFalso } from '../ayudas/redis-falso.js';
import { bearer } from '../ayudas/tokens.js';

// obtenerEstadoCuenta con la caché (spec 107: RF-2.6.5, RF-2.6.5.2, RF-2.6.5.3, RF-2.6.5.4). Redis es un servidor falso por TCP y la
// base es un pool que cuenta sus consultas: se ve cuándo se la consulta y cuándo no.

const contrato = cargarContrato();
const CLIENTE = '6f1c1d1e-3b0a-4f55-9a6b-0d7a8f4c2e11';
const OTRO = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const HASTA = new Date(Date.now() + 3_600_000);
const SIN_BLOQUEO = { cliente_id: CLIENTE, bloqueo_id: null, motivo: null, vigente: null, hasta: null, creado_en: null, creado_por: null, levantado_en: null, levantado_por: null, motivo_levantamiento: null };
const CON_BLOQUEO = { ...SIN_BLOQUEO, bloqueo_id: 'b1f0c2d3-0000-4000-8000-000000000001', motivo: 'Pago rechazado', vigente: true, hasta: HASTA, creado_en: new Date('2026-11-15T10:00:00Z'), creado_por: 'operador-1' };

type Rol = 'CLIENTE' | 'CONDUCTOR' | 'OPERADOR' | 'SERVICIO';
const token = (roles: Rol[], sub = CLIENTE) => bearer({ claims: { sub, roles } });

// Un pool que contesta con `filas` y cuenta cuántas veces se lo consultó.
function baseCon(filas: object[]) {
  const estado = { consultas: 0 };
  const pool: BaseDeDatos = {
    ...POOL_FALSO,
    consultar: (async () => {
      estado.consultas += 1;
      return { rows: filas };
    }) as unknown as BaseDeDatos['consultar'],
  };
  return { pool, estado };
}

let redis: RedisFalso;
beforeEach(async () => {
  redis = await levantarRedisFalso();
});
afterEach(async () => {
  await redis.cerrar();
});

async function appConCache(pool: BaseDeDatos) {
  const app = crearApp({ obtenerEstadoCuenta, crearBloqueo, levantarBloqueo }, { contrato, pool, config: { urlRedis: redis.url, tiempoRedisMs: 500 } });
  await app.ready();
  await new Promise<void>((listo) => {
    const espera = setInterval(() => app.redis.conectado && (clearInterval(espera), listo()), 10);
  });
  return app;
}

const pedir = (app: Awaited<ReturnType<typeof appConCache>>, encabezados: Record<string, string>, id = CLIENTE) =>
  app.inject({ method: 'GET', url: `/api/v1/clientes/${id}/estado-cuenta`, headers: encabezados });

const guardados = () => redis.comandos.filter(([nombre]) => nombre?.toUpperCase() === 'SET');

describe('obtenerEstadoCuenta con caché', () => {
  it('la primera consulta lee la base y guarda; la segunda sale de la copia sin consultar la base (RF-2.6.5, RF-2.6.5.1)', async () => {
    const { pool, estado } = baseCon([CON_BLOQUEO]);
    const app = await appConCache(pool);
    const primera = await pedir(app, token(['CLIENTE']));
    const segunda = await pedir(app, token(['CLIENTE']));
    expect([primera.statusCode, segunda.statusCode]).toEqual([200, 200]);
    expect(estado.consultas).toBe(1);
    expect(guardados()).toHaveLength(1);
  });

  it('el cuerpo y los encabezados son idénticos con copia, sin copia y sin caché (RF-2.6.5.2)', async () => {
    const conCache = await appConCache(baseCon([CON_BLOQUEO]).pool);
    const desdeBase = await pedir(conCache, token(['CLIENTE']));
    const desdeCopia = await pedir(conCache, token(['CLIENTE']));
    const sinCache = crearApp({ obtenerEstadoCuenta }, { contrato, pool: baseCon([CON_BLOQUEO]).pool });
    const sinRedis = await pedir(sinCache as never, token(['CLIENTE']));
    expect(desdeCopia.body).toBe(desdeBase.body);
    expect(sinRedis.body).toBe(desdeBase.body);
    expect(desdeCopia.headers['content-type']).toBe(desdeBase.headers['content-type']);
    expect(JSON.parse(desdeCopia.body)).toMatchObject({ clienteId: CLIENTE, estado: 'BLOQUEADO', bloqueosVigentes: [{ motivo: 'Pago rechazado' }] });
  });

  it('un cliente sin bloqueos también sale de la copia, ACTIVO', async () => {
    const { pool, estado } = baseCon([SIN_BLOQUEO]);
    const app = await appConCache(pool);
    await pedir(app, token(['CLIENTE']));
    const respuesta = await pedir(app, token(['CLIENTE']));
    expect(JSON.parse(respuesta.body)).toEqual({ clienteId: CLIENTE, estado: 'ACTIVO', bloqueosVigentes: [] });
    expect(estado.consultas).toBe(1);
  });

  it('un OPERADOR y un SERVICIO leen la copia del cliente', async () => {
    const { pool, estado } = baseCon([CON_BLOQUEO]);
    const app = await appConCache(pool);
    await pedir(app, token(['CLIENTE']));
    for (const rol of ['OPERADOR', 'SERVICIO'] as Rol[]) {
      expect((await pedir(app, token([rol], OTRO))).statusCode).toBe(200);
    }
    expect(estado.consultas).toBe(1);
  });

  it('el clienteId en mayúsculas usa la misma copia que en minúsculas', async () => {
    const { pool, estado } = baseCon([CON_BLOQUEO]);
    const app = await appConCache(pool);
    await pedir(app, token(['OPERADOR'], OTRO), CLIENTE);
    await pedir(app, token(['OPERADOR'], OTRO), CLIENTE.toUpperCase());
    expect(estado.consultas).toBe(1);
  });
});

describe('los permisos van antes que la copia (RF-2.6.5.3)', () => {
  it.each([
    ['otro cliente', token(['CLIENTE'], OTRO), 403],
    ['un CONDUCTOR', token(['CONDUCTOR']), 403],
    ['sin token', {}, 401],
  ] as [string, Record<string, string>, number][])('con una copia guardada, %s no la recibe', async (_quien, encabezados, esperado) => {
    const { pool, estado } = baseCon([CON_BLOQUEO]);
    const app = await appConCache(pool);
    await pedir(app, token(['CLIENTE']));
    expect(guardados()).toHaveLength(1);
    const comandosAntes = redis.comandos.length;

    const respuesta = await pedir(app, encabezados);

    expect(respuesta.statusCode).toBe(esperado);
    expect(respuesta.body).not.toContain('Pago rechazado');
    // Ni siquiera se miró la caché: el rechazo salió antes.
    expect(redis.comandos).toHaveLength(comandosAntes);
    expect(estado.consultas).toBe(1);
  });
});

describe('un cliente inexistente no deja nada en la caché (RF-2.6.5.4)', () => {
  it('404 y ningún SET', async () => {
    const { pool } = baseCon([]);
    const app = await appConCache(pool);
    const respuesta = await pedir(app, token(['OPERADOR'], OTRO));
    expect(respuesta.statusCode).toBe(404);
    expect(guardados()).toEqual([]);
    // Y la siguiente consulta vuelve a la base: no quedó una copia del 404.
    const otra = await pedir(app, token(['OPERADOR'], OTRO));
    expect(otra.statusCode).toBe(404);
  });
});
