import { createServer } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearRedis, RedisNoDisponible, type AvisoRedis, type Redis } from '../../src/cache/redis.js';
import { levantarRedisFalso, type RedisFalso } from '../ayudas/redis-falso.js';

// El cliente de Redis de la caché del estado de cuenta (spec 107, RNF-13, RNF-19): tiempo máximo por operación, falla de
// inmediato si no está conectado, no reintenta dentro de la solicitud y solo avisa el nombre de la operación y un código.

const TIEMPO_MS = 150;
const abiertos: Redis[] = [];
const servidores: RedisFalso[] = [];

async function conectado(opciones: { colgado?: boolean; ahora?: () => number } = {}) {
  const servidor = await levantarRedisFalso();
  servidores.push(servidor);
  const avisos: AvisoRedis[] = [];
  const redis = crearRedis({ urlRedis: servidor.url, tiempoRedisMs: TIEMPO_MS }, { avisar: (aviso) => avisos.push(aviso), ahora: opciones.ahora });
  abiertos.push(redis);
  await vi.waitFor(() => expect(redis.conectado).toBe(true), { timeout: 3000 });
  servidor.colgado = opciones.colgado ?? false;
  return { servidor, redis, avisos };
}

// Un puerto en el que nadie escucha: se abre un servidor, se anota el puerto y se cierra.
async function puertoLibre(): Promise<number> {
  const servidor = createServer();
  await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
  const direccion = servidor.address();
  const puerto = typeof direccion === 'object' && direccion !== null ? direccion.port : 0;
  await new Promise<void>((listo) => servidor.close(() => listo()));
  return puerto;
}

afterEach(async () => {
  await Promise.all(abiertos.splice(0).map((redis) => redis.cerrar()));
  await Promise.all(servidores.splice(0).map((servidor) => servidor.cerrar()));
});

describe('crearRedis sin M2_URL_REDIS (RNF-06)', () => {
  it('es una caché apagada: leer no encuentra nada y lo demás no hace nada ni falla', async () => {
    const redis = crearRedis({ urlRedis: undefined, tiempoRedisMs: TIEMPO_MS }, { avisar: () => { throw new Error('no debe avisar'); } });
    expect(redis.activo).toBe(false);
    expect(redis.conectado).toBe(false);
    await expect(redis.get('m2:x')).resolves.toBeNull();
    await expect(redis.set('m2:x', 'valor', 1000)).resolves.toBeUndefined();
    await expect(redis.incr('m2:x')).resolves.toBe(0);
    await expect(redis.pexpire('m2:x', 1000)).resolves.toBeUndefined();
    await expect(redis.cerrar()).resolves.toBeUndefined();
  });
});

describe('crearRedis con un Redis que contesta', () => {
  it('se conecta y lee, guarda con vencimiento, incrementa y pone vencimiento', async () => {
    const { servidor, redis } = await conectado();
    expect(redis.activo).toBe(true);
    await expect(redis.get('m2:c')).resolves.toBeNull();
    await redis.set('m2:c', '{"a":1}', 4500);
    await expect(redis.get('m2:c')).resolves.toBe('{"a":1}');
    expect(servidor.vencimientos.get('m2:c')).toBe(4500);
    await expect(redis.incr('m2:v')).resolves.toBe(1);
    await expect(redis.incr('m2:v')).resolves.toBe(2);
    await redis.pexpire('m2:v', 9000);
    expect(servidor.vencimientos.get('m2:v')).toBe(9000);
  });

  it('cerrar lo desconecta y después toda operación falla de inmediato; cerrar dos veces no falla', async () => {
    const { redis } = await conectado();
    await redis.cerrar();
    await redis.cerrar();
    expect(redis.conectado).toBe(false);
    await expect(redis.get('m2:c')).rejects.toBeInstanceOf(RedisNoDisponible);
  });
});

describe('crearRedis con un Redis que no contesta (RNF-13)', () => {
  it('cada operación falla dentro del tiempo máximo, con RedisNoDisponible y sin reintentar', async () => {
    const { servidor, redis } = await conectado({ colgado: true });
    const antes = Date.now();
    const error = await redis.get('m2:c').catch((e: unknown) => e);
    const demora = Date.now() - antes;
    expect(error).toBeInstanceOf(RedisNoDisponible);
    expect(error).toMatchObject({ operacion: 'get', codigo: 'TIMEOUT' });
    expect(demora).toBeGreaterThanOrEqual(TIEMPO_MS - 20);
    expect(demora).toBeLessThan(TIEMPO_MS + 400);
    // Un solo comando llegó al servidor: no hubo reintento.
    expect(servidor.comandos).toEqual([['GET', 'm2:c']]);
  });

  it('el error no lleva la clave, el valor ni la dirección', async () => {
    const { redis } = await conectado({ colgado: true });
    const error = (await redis.set('m2:estado-cuenta:v:cliente-secreto', 'valor-secreto', 1000).catch((e: unknown) => e)) as Error;
    expect(`${error.message} ${JSON.stringify(error)} ${error.stack ?? ''}`).not.toMatch(/secreto|127\.0\.0\.1|redis:\/\//);
  });
});

describe('crearRedis sin conexión (RNF-13)', () => {
  it('con el puerto cerrado, falla de inmediato (sin esperar el tiempo máximo) y el servicio no se cae', async () => {
    const puerto = await puertoLibre();
    const avisos: AvisoRedis[] = [];
    const redis = crearRedis({ urlRedis: `redis://127.0.0.1:${puerto}`, tiempoRedisMs: 2000 }, { avisar: (aviso) => avisos.push(aviso) });
    abiertos.push(redis);
    const antes = Date.now();
    const error = await redis.get('m2:c').catch((e: unknown) => e);
    expect(Date.now() - antes).toBeLessThan(200);
    expect(error).toMatchObject({ operacion: 'get', codigo: 'NO_CONECTADO' });
    expect(redis.conectado).toBe(false);
  });

  it('cuando Redis aparece, la conexión se recupera sola, sin intervención', async () => {
    const servidor = await levantarRedisFalso();
    servidores.push(servidor);
    const { puerto } = servidor;
    await servidor.cerrar();
    servidores.pop();
    const redis = crearRedis({ urlRedis: `redis://127.0.0.1:${puerto}`, tiempoRedisMs: TIEMPO_MS }, { avisar: () => undefined });
    abiertos.push(redis);
    await expect(redis.get('m2:c')).rejects.toBeInstanceOf(RedisNoDisponible);
    // Levanta un Redis en el mismo puerto.
    const nuevo = await new Promise<RedisFalso | undefined>((resolver) => {
      void (async () => {
        for (let intento = 0; intento < 20; intento += 1) {
          const otro = await levantarRedisFalso(puerto).catch(() => undefined);
          if (otro) return resolver(otro);
          await new Promise((listo) => setTimeout(listo, 50));
        }
        resolver(undefined);
      })();
    });
    expect(nuevo).toBeDefined();
    if (nuevo) servidores.push(nuevo);
    await vi.waitFor(() => expect(redis.conectado).toBe(true), { timeout: 5000 });
    await expect(redis.get('m2:c')).resolves.toBeNull();
  });

  it('cerrar mientras todavía intenta conectar termina sin error', async () => {
    const puerto = await puertoLibre();
    const redis = crearRedis({ urlRedis: `redis://127.0.0.1:${puerto}`, tiempoRedisMs: TIEMPO_MS }, { avisar: () => undefined });
    await expect(redis.cerrar()).resolves.toBeUndefined();
  });
});

describe('avisos al log (RF-2.6.8, RNF-19)', () => {
  it('un fallo deja el nombre de la operación y un código, y nada más', async () => {
    const { redis, avisos } = await conectado({ colgado: true });
    await redis.incr('m2:estado-cuenta:v:cliente-secreto').catch(() => undefined);
    expect(avisos).toEqual([{ operacion: 'incr', codigo: 'TIMEOUT' }]);
    expect(JSON.stringify(avisos)).not.toMatch(/secreto|127\.0\.0\.1/);
  });

  it('varios fallos seguidos dejan un solo aviso por ventana, y otro cuando la ventana pasa', async () => {
    let reloj = 1_000_000;
    const { redis, avisos } = await conectado({ colgado: true, ahora: () => reloj });
    await Promise.all([redis.get('a').catch(() => undefined), redis.get('b').catch(() => undefined), redis.incr('c').catch(() => undefined)]);
    expect(avisos).toHaveLength(1);
    reloj += 10_000;
    await redis.get('d').catch(() => undefined);
    expect(avisos).toHaveLength(2);
  });
});
