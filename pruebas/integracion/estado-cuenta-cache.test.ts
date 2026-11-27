import { randomUUID } from 'node:crypto';
import { setTimeout as esperar } from 'node:timers/promises';
import type { StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrar } from '../../src/bd/migraciones.js';
import { crearPool, type BaseDeDatos, type PoolBd } from '../../src/bd/pool.js';
import { cargarContrato } from '../../src/contrato/cargar.js';
import { manejadores } from '../../src/operaciones/index.js';
import { crearApp } from '../ayudas/app.js';
import { type BaseDePrueba, crearBaseDePrueba } from '../ayudas/bd.js';
import { levantarRedisReal, puertoLibre, redisCli } from '../ayudas/redis-real.js';
import { armarToken } from '../ayudas/tokens.js';

// La caché del estado de cuenta con Redis y PostgreSQL reales, en contenedor (spec 107: RF-2.6.5 a RF-2.6.8.1, RNF-05, RNF-07).
// Redis es la imagen del compose; PostgreSQL, la de todas las pruebas de integración.

const TIEMPO_BD_MS = 2000;
const contrato = cargarContrato();
const OPERADOR = 'operador-de-la-prueba';
type Rol = 'CLIENTE' | 'OPERADOR';
const autorizacion = (sub: string, roles: Rol[]) => ({ authorization: `Bearer ${armarToken({ claims: { sub, roles } })}` });

describe('estado de cuenta con Redis y PostgreSQL reales', () => {
  let base: BaseDePrueba;
  let pool: PoolBd;
  let puerto: number;
  let redis: StartedTestContainer;
  // Cuántas consultas llegaron a la base: el pool real, envuelto.
  const lecturas = { total: 0 };
  let contado: BaseDeDatos;

  beforeAll(async () => {
    base = await crearBaseDePrueba();
    await migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });
    pool = crearPool({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });
    contado = {
      tiempoBdMs: pool.tiempoBdMs,
      connect: () => pool.connect(),
      consultar: ((sql: string, parametros?: unknown[]) => {
        lecturas.total += 1;
        return pool.consultar(sql, parametros);
      }) as BaseDeDatos['consultar'],
    };
    puerto = await puertoLibre();
    redis = await levantarRedisReal(puerto);
  }, 120_000);

  afterAll(async () => {
    await redis?.stop();
    await pool?.end();
    await base?.borrar();
  });

  async function crear() {
    const app = crearApp(manejadores, { contrato, pool: contado, config: { urlRedis: `redis://127.0.0.1:${puerto}`, tiempoRedisMs: 500 } });
    await app.ready();
    await vi.waitFor(() => expect(app.redis.conectado).toBe(true), { timeout: 10_000 });
    const clienteId = randomUUID();
    await app.inject({ method: 'POST', url: '/api/v1/clientes', headers: { ...autorizacion(clienteId, ['CLIENTE']), 'idempotency-key': randomUUID() }, payload: { nombre: 'Ana', apellido: 'Gómez', telefono: '+5493624000000' } });
    // Lo que cuesta en la base una consulta del estado de cuenta.
    const estado = async () => {
      const antes = lecturas.total;
      const respuesta = await app.inject({ method: 'GET', url: `/api/v1/clientes/${clienteId}/estado-cuenta`, headers: autorizacion(OPERADOR, ['OPERADOR']) });
      return { codigo: respuesta.statusCode, cuerpo: respuesta.body, estado: (respuesta.json() as { estado: string }).estado, base: lecturas.total - antes };
    };
    const alta = async (payload: object) =>
      app.inject({ method: 'POST', url: `/api/v1/clientes/${clienteId}/bloqueos`, headers: { ...autorizacion(OPERADOR, ['OPERADOR']), 'idempotency-key': randomUUID() }, payload });
    const levantar = async (bloqueoId: string) =>
      app.inject({ method: 'PATCH', url: `/api/v1/clientes/${clienteId}/bloqueos/${bloqueoId}`, headers: autorizacion(OPERADOR, ['OPERADOR']), payload: { motivo: 'Pagó' } });
    const salud = async () => (await app.inject({ method: 'GET', url: '/health' })).statusCode;
    return { app, clienteId, estado, alta, levantar, salud };
  }

  it('dos consultas seguidas hacen una sola lectura en la base y dan el mismo cuerpo (RF-2.6.5, RF-2.6.5.2)', async () => {
    const { clienteId, estado } = await crear();
    const primera = await estado();
    const segunda = await estado();
    expect([primera.codigo, segunda.codigo]).toEqual([200, 200]);
    expect(primera.base).toBe(1);
    expect(segunda.base).toBe(0);
    expect(segunda.cuerpo).toBe(primera.cuerpo);
    // Las claves solo llevan el clienteId (RNF-19), y la copia vence.
    const claves = (await redisCli(redis, '--scan', '--pattern', `*${clienteId}*`)).split('\n').sort();
    expect(claves).toEqual([`m2:estado-cuenta:c:${clienteId}:0`]);
    const vence = Number(await redisCli(redis, 'PTTL', claves[0] ?? ''));
    expect(vence).toBeGreaterThan(0);
    expect(vence).toBeLessThanOrEqual(60_000);
  });

  it('un alta y un levantamiento se ven en la consulta siguiente (RF-2.6.6, RF-2.6.6.1)', async () => {
    const { estado, alta, levantar } = await crear();
    await estado();
    const { bloqueoId } = (await alta({ motivo: 'Deuda' })).json() as { bloqueoId: string };
    expect((await estado()).estado).toBe('BLOQUEADO');
    expect((await estado()).base).toBe(0);
    expect((await levantar(bloqueoId)).statusCode).toBe(200);
    expect((await estado()).estado).toBe('ACTIVO');
  });

  it('vaciar Redis no pierde nada: todo se reconstruye desde la base (RNF-05)', async () => {
    const { estado, alta } = await crear();
    await alta({ motivo: 'Deuda' });
    const antes = await estado();
    await redisCli(redis, 'FLUSHALL');
    const despues = await estado();
    expect(despues.base).toBe(1);
    expect(despues.cuerpo).toBe(antes.cuerpo);
    expect((await estado()).base).toBe(0);
  });

  it('un bloqueo con hasta cercano deja de informarse al vencer (RF-2.6.7)', async () => {
    const { clienteId, estado, alta } = await crear();
    const hasta = new Date(Date.now() + 3000).toISOString();
    expect((await alta({ motivo: 'Corto', hasta })).statusCode).toBe(201);
    expect((await estado()).estado).toBe('BLOQUEADO');
    const vence = Number(await redisCli(redis, 'PTTL', `m2:estado-cuenta:c:${clienteId}:1`));
    expect(vence).toBeGreaterThan(0);
    expect(vence).toBeLessThanOrEqual(3000);
    await esperar(Date.parse(hasta) - Date.now() + 200);
    const vencido = await estado();
    expect(vencido.estado).toBe('ACTIVO');
    expect(vencido.base).toBe(1);
  }, 15_000);

  it('detener Redis y levantar otro no cambia ninguna respuesta (RF-2.6.8, RNF-13, RNF-14)', async () => {
    const { app, estado, alta, salud } = await crear();
    await alta({ motivo: 'Deuda' });
    const conRedis = await estado();
    await redis.stop();

    const sinRedis = await estado();
    expect(sinRedis.codigo).toBe(200);
    expect(sinRedis.cuerpo).toBe(conRedis.cuerpo);
    expect(sinRedis.base).toBe(1);
    expect(await salud()).toBe(200);

    redis = await levantarRedisReal(puerto);
    await vi.waitFor(() => expect(app.redis.conectado).toBe(true), { timeout: 10_000 });
    const deVuelta = await estado();
    expect(deVuelta.cuerpo).toBe(conRedis.cuerpo);
    expect((await estado()).base).toBe(0);
  }, 60_000);
});
