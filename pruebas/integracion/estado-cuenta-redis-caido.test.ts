import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../../src/bd/migraciones.js';
import { crearPool, type PoolBd } from '../../src/bd/pool.js';
import { cargarContrato } from '../../src/contrato/cargar.js';
import { manejadores } from '../../src/operaciones/index.js';
import { crearApp } from '../ayudas/app.js';
import { type BaseDePrueba, crearBaseDePrueba } from '../ayudas/bd.js';
import { capturarLogs } from '../ayudas/logs.js';
import { levantarRedisFalso, type RedisFalso } from '../ayudas/redis-falso.js';
import { armarToken } from '../ayudas/tokens.js';

// Redis caído o lento no cambia ninguna respuesta (spec 107: RF-2.6.11, RF-2.6.11.1, RNF-13, RNF-14, RNF-19). PostgreSQL real; Redis,
// el falso por TCP, que se puede cortar o colgar.

const TIEMPO_BD_MS = 2000;
const TIEMPO_REDIS_MS = 300;
// Lo que puede costar la base en estas pruebas, además de la espera a Redis.
const MARGEN_BASE_MS = 1000;
const contrato = cargarContrato();
const OPERADOR = 'operador-de-la-prueba';
type Rol = 'CLIENTE' | 'OPERADOR';

describe('estado de cuenta con Redis caído o lento', () => {
  let base: BaseDePrueba;
  let pool: PoolBd;
  const servidores: RedisFalso[] = [];

  beforeAll(async () => {
    base = await crearBaseDePrueba();
    await migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });
    pool = crearPool({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });
  });
  afterEach(async () => {
    await Promise.all(servidores.splice(0).map((servidor) => servidor.cerrar()));
  });
  afterAll(async () => {
    await pool?.end();
    await base?.borrar();
  });

  async function crear() {
    const redis = await levantarRedisFalso();
    servidores.push(redis);
    const logs = capturarLogs();
    const app = crearApp(manejadores, { contrato, pool, flujoLog: logs.flujo, config: { urlRedis: redis.url, tiempoRedisMs: TIEMPO_REDIS_MS } });
    await app.ready();
    await new Promise<void>((listo) => {
      const espera = setInterval(() => app.redis.conectado && (clearInterval(espera), listo()), 10);
    });
    const autorizacion = (sub: string, roles: Rol[]) => ({ authorization: `Bearer ${armarToken({ claims: { sub, roles } })}` });
    const clienteId = randomUUID();
    await app.inject({ method: 'POST', url: '/api/v1/clientes', headers: { ...autorizacion(clienteId, ['CLIENTE']), 'idempotency-key': randomUUID() }, payload: { nombre: 'Ana', apellido: 'Gómez', telefono: '+5493624000000' } });
    const medir = async <T>(hacer: () => Promise<T>) => {
      const antes = Date.now();
      const resultado = await hacer();
      return { resultado, ms: Date.now() - antes };
    };
    return {
      app,
      redis,
      logs,
      clienteId,
      estado: () =>
        medir(async () => {
          const respuesta = await app.inject({ method: 'GET', url: `/api/v1/clientes/${clienteId}/estado-cuenta`, headers: autorizacion(OPERADOR, ['OPERADOR']) });
          return { codigo: respuesta.statusCode, cuerpo: respuesta.json() as { estado: string } };
        }),
      alta: () =>
        medir(async () =>
          (await app.inject({ method: 'POST', url: `/api/v1/clientes/${clienteId}/bloqueos`, headers: { ...autorizacion(OPERADOR, ['OPERADOR']), 'idempotency-key': randomUUID() }, payload: { motivo: 'Deuda' } })).statusCode,
        ),
      salud: async () => (await app.inject({ method: 'GET', url: '/health' })).statusCode,
    };
  }

  const sinDatos = (texto: string, clienteId: string) => {
    expect(texto).not.toContain(clienteId);
    expect(texto).not.toContain('Deuda');
    expect(texto).not.toContain('127.0.0.1');
  };

  it('con Redis cortado: 200 desde la base sin esperar, /health 200, el alta 201 y un aviso sin datos (RF-2.6.11, RNF-14)', async () => {
    const { redis, logs, clienteId, estado, alta, salud } = await crear();
    await estado();
    await redis.cerrar();
    servidores.pop();

    const consulta = await estado();
    expect(consulta.resultado).toEqual({ codigo: 200, cuerpo: expect.objectContaining({ estado: 'ACTIVO' }) });
    expect(consulta.ms).toBeLessThan(TIEMPO_REDIS_MS + MARGEN_BASE_MS);
    expect(await salud()).toBe(200);
    expect((await alta()).resultado).toBe(201);
    expect((await estado()).resultado.cuerpo.estado).toBe('BLOQUEADO');

    const avisos = logs.lineas().filter((linea) => linea.level === 40 && 'operacion' in linea);
    expect(avisos.length).toBeGreaterThan(0);
    for (const aviso of avisos) expect(Object.keys(aviso).sort()).toEqual(['codigo', 'hostname', 'level', 'msg', 'operacion', 'pid', 'time']);
    sinDatos(JSON.stringify(avisos), clienteId);
  });

  it('con Redis colgado: cada respuesta tarda como máximo el tiempo de Redis más la base, y nada da 503 (RNF-13)', async () => {
    const { redis, logs, clienteId, estado, alta, salud } = await crear();
    await estado();
    redis.colgado = true;

    const consulta = await estado();
    expect(consulta.resultado.codigo).toBe(200);
    expect(consulta.ms).toBeLessThan(TIEMPO_REDIS_MS + MARGEN_BASE_MS);

    const bloqueo = await alta();
    expect(bloqueo.resultado).toBe(201);
    expect(bloqueo.ms).toBeLessThan(TIEMPO_REDIS_MS + MARGEN_BASE_MS);
    expect(await salud()).toBe(200);

    const despues = await estado();
    expect(despues.resultado).toEqual({ codigo: 200, cuerpo: expect.objectContaining({ estado: 'BLOQUEADO' }) });
    expect(despues.ms).toBeLessThan(TIEMPO_REDIS_MS + MARGEN_BASE_MS);
    sinDatos(logs.texto().split('\n').filter((linea) => linea.includes('"operacion"')).join('\n'), clienteId);
  });

  it('cuando Redis vuelve, el descarte pendiente se confirma y la copia ACTIVA de antes no reaparece (RF-2.6.11.1)', async () => {
    const { redis, estado, alta } = await crear();
    // Copia ACTIVA guardada.
    expect((await estado()).resultado.cuerpo.estado).toBe('ACTIVO');
    expect((await estado()).resultado.cuerpo.estado).toBe('ACTIVO');
    redis.colgado = true;
    expect((await alta()).resultado).toBe(201);
    redis.soltar();

    for (let vez = 0; vez < 3; vez += 1) expect((await estado()).resultado.cuerpo.estado).toBe('BLOQUEADO');
  });
});
