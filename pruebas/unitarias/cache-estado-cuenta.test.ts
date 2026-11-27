import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crearCacheEstadoCuenta } from '../../src/cache/estado-cuenta.js';
import type { EstadoCuenta } from '../../src/clientes/modelo.js';
import { NoEncontrado } from '../../src/errores.js';
import { crearRedisEnMemoria, type RedisEnMemoria } from '../ayudas/redis-memoria.js';

// Leer y guardar el estado de cuenta con versión y vencimiento (spec 107: RF-2.6.5, RF-2.6.5.1, RF-2.6.7, RNF-11, RNF-19).

const CLIENTE = '4f3d9b1e-0c1a-4d5e-9f10-2a3b4c5d6e7f';
const OTRO = '9a8b7c6d-1111-4222-8333-444455556666';
const TTL_S = 60;
const AHORA = Date.parse('2026-11-15T12:00:00.000Z');

const bloqueo = (hasta?: string) => ({
  bloqueoId: 'b1f0c2d3-0000-4000-8000-000000000001',
  motivo: 'motivo-con-datos-sensibles',
  vigente: true,
  desde: '2026-11-15T10:00:00.000Z',
  ...(hasta === undefined ? {} : { hasta }),
  creadoEn: '2026-11-15T10:00:00.000Z',
  creadoPor: 'operador-secreto',
});
const estadoCon = (clienteId: string, ...hastas: (string | undefined)[]): EstadoCuenta => ({
  clienteId,
  estado: hastas.length > 0 ? 'BLOQUEADO' : 'ACTIVO',
  bloqueosVigentes: hastas.map((hasta) => bloqueo(hasta)),
});
const en = (ms: number) => new Date(AHORA + ms).toISOString();

let redis: RedisEnMemoria;
const crear = (opciones: { ttlS?: number; redis?: RedisEnMemoria } = {}) =>
  crearCacheEstadoCuenta(opciones.redis ?? redis, { ttlS: opciones.ttlS ?? TTL_S, ahora: () => AHORA });
const clavesDeCopia = () => redis.claves().filter((clave) => clave.includes(':c:'));

beforeEach(() => {
  redis = crearRedisEnMemoria(() => AHORA);
});

describe('leer: la segunda lectura sale de la copia (RF-2.6.5, RF-2.6.5.1)', () => {
  it('la primera consulta calcula y guarda; la segunda no vuelve a calcular y da el mismo cuerpo', async () => {
    const cache = crear();
    const calcular = vi.fn(async () => estadoCon(CLIENTE, en(3_600_000)));
    const primera = await cache.leer(CLIENTE, calcular);
    const segunda = await cache.leer(CLIENTE, calcular);
    expect(calcular).toHaveBeenCalledTimes(1);
    expect(segunda).toEqual(primera);
    expect(JSON.stringify(segunda)).toBe(JSON.stringify(primera));
  });

  it('un cliente sin bloqueos también se guarda, con su estado ACTIVO', async () => {
    const cache = crear();
    const calcular = vi.fn(async () => estadoCon(CLIENTE));
    await cache.leer(CLIENTE, calcular);
    await expect(cache.leer(CLIENTE, calcular)).resolves.toEqual({ clienteId: CLIENTE, estado: 'ACTIVO', bloqueosVigentes: [] });
    expect(calcular).toHaveBeenCalledTimes(1);
  });

  it('cada cliente tiene su copia: la de uno no se entrega a otro', async () => {
    const cache = crear();
    await cache.leer(CLIENTE, async () => estadoCon(CLIENTE, undefined));
    const calcularOtro = vi.fn(async () => estadoCon(OTRO));
    await expect(cache.leer(OTRO, calcularOtro)).resolves.toMatchObject({ clienteId: OTRO, estado: 'ACTIVO' });
    expect(calcularOtro).toHaveBeenCalledTimes(1);
  });

  it('una copia que no es la de ese cliente, o que no tiene la forma, se ignora y se reemplaza', async () => {
    const cache = crear();
    await cache.leer(CLIENTE, async () => estadoCon(CLIENTE));
    const clave = clavesDeCopia()[0] ?? '';
    for (const basura of ['no es json', '{}', '[]', 'null', JSON.stringify(estadoCon(OTRO)), '{"clienteId":"x","estado":1}']) {
      await redis.set(clave, basura, 60_000);
      const calcular = vi.fn(async () => estadoCon(CLIENTE));
      await expect(cache.leer(CLIENTE, calcular)).resolves.toEqual(estadoCon(CLIENTE));
      expect(calcular).toHaveBeenCalledTimes(1);
      expect(JSON.parse(redis.valor(clave) ?? 'null')).toEqual(estadoCon(CLIENTE));
    }
  });

  it('si calcular falla (cliente inexistente), el error sale tal cual y no se guarda nada (RF-2.6.5.4)', async () => {
    const cache = crear();
    await expect(cache.leer(CLIENTE, async () => { throw new NoEncontrado('no existe'); })).rejects.toBeInstanceOf(NoEncontrado);
    expect(clavesDeCopia()).toEqual([]);
    expect(redis.llamadas.set).toBe(0);
  });
});

describe('vencimiento de la copia (RF-2.6.7, RNF-11)', () => {
  const vencimiento = () => redis.vencimientoPedido(clavesDeCopia()[0] ?? '');

  it('sin bloqueos o sin fecha hasta, dura lo configurado', async () => {
    await crear().leer(CLIENTE, async () => estadoCon(CLIENTE));
    expect(vencimiento()).toBe(TTL_S * 1000);
  });

  it('un bloqueo sin hasta no acorta la copia', async () => {
    await crear().leer(CLIENTE, async () => estadoCon(CLIENTE, undefined));
    expect(vencimiento()).toBe(TTL_S * 1000);
  });

  it('un hasta más cercano que lo configurado la acorta hasta ese instante', async () => {
    await crear().leer(CLIENTE, async () => estadoCon(CLIENTE, en(12_345)));
    expect(vencimiento()).toBe(12_345);
  });

  it('un hasta más lejano que lo configurado no la alarga', async () => {
    await crear().leer(CLIENTE, async () => estadoCon(CLIENTE, en(3_600_000)));
    expect(vencimiento()).toBe(TTL_S * 1000);
  });

  it('con varios bloqueos toma el primer vencimiento, también si otro no tiene hasta', async () => {
    await crear().leer(CLIENTE, async () => estadoCon(CLIENTE, en(40_000), undefined, en(5_000), en(20_000)));
    expect(vencimiento()).toBe(5_000);
  });

  it('con un TTL configurado menor que el hasta, manda el TTL', async () => {
    await crear({ ttlS: 3 }).leer(CLIENTE, async () => estadoCon(CLIENTE, en(30_000)));
    expect(vencimiento()).toBe(3000);
  });

  it('nunca devuelve una copia pasado el hasta: al vencer, vuelve a calcular', async () => {
    let reloj = AHORA;
    redis = crearRedisEnMemoria(() => reloj);
    const cache = crearCacheEstadoCuenta(redis, { ttlS: TTL_S, ahora: () => reloj });
    const calcular = vi.fn(async () => estadoCon(CLIENTE, new Date(reloj + 10_000).toISOString()));
    await cache.leer(CLIENTE, calcular);
    reloj += 9_999;
    await cache.leer(CLIENTE, calcular);
    expect(calcular).toHaveBeenCalledTimes(1);
    reloj += 1;
    await cache.leer(CLIENTE, calcular);
    expect(calcular).toHaveBeenCalledTimes(2);
  });

  it.each([['ya venció', en(-1)], ['vence ahora', en(0)]])('si el bloqueo %s, no se guarda copia', async (_caso, hasta) => {
    const cache = crear();
    const calcular = vi.fn(async () => estadoCon(CLIENTE, hasta));
    await cache.leer(CLIENTE, calcular);
    await cache.leer(CLIENTE, calcular);
    expect(clavesDeCopia()).toEqual([]);
    expect(calcular).toHaveBeenCalledTimes(2);
  });
});

describe('claves y versión (RF-2.6.5.1, RNF-19)', () => {
  it('las claves solo contienen el prefijo, el clienteId y la versión', async () => {
    await crear().leer(CLIENTE, async () => estadoCon(CLIENTE, en(30_000)));
    const claves = redis.claves();
    expect(claves.length).toBeGreaterThan(0);
    for (const clave of claves) expect(clave).toMatch(new RegExp(`^m2:estado-cuenta:(v:${CLIENTE}|c:${CLIENTE}:\\d+)$`));
    expect(claves.join(' ')).not.toMatch(/motivo|operador|secreto|BLOQUEADO|ACTIVO/);
  });

  it('sin versión guardada, la copia va con la versión 0', async () => {
    await crear().leer(CLIENTE, async () => estadoCon(CLIENTE));
    expect(clavesDeCopia()).toEqual([`m2:estado-cuenta:c:${CLIENTE}:0`]);
  });

  it('la copia se guarda con la versión que había antes de calcular, y subir la versión la deja sin uso', async () => {
    const cache = crear();
    await redis.incr(`m2:estado-cuenta:v:${CLIENTE}`);
    await redis.incr(`m2:estado-cuenta:v:${CLIENTE}`);
    const calcular = vi.fn(async () => estadoCon(CLIENTE));
    await cache.leer(CLIENTE, calcular);
    expect(clavesDeCopia()).toEqual([`m2:estado-cuenta:c:${CLIENTE}:2`]);
    await cache.leer(CLIENTE, calcular);
    expect(calcular).toHaveBeenCalledTimes(1);
    await redis.incr(`m2:estado-cuenta:v:${CLIENTE}`);
    await cache.leer(CLIENTE, calcular);
    expect(calcular).toHaveBeenCalledTimes(2);
  });

  it('si la versión cambia mientras se calcula, la copia queda bajo la versión vieja y nadie la lee', async () => {
    const cache = crear();
    const viejo = estadoCon(CLIENTE);
    const nuevo = estadoCon(CLIENTE, undefined);
    await cache.leer(CLIENTE, async () => {
      await redis.incr(`m2:estado-cuenta:v:${CLIENTE}`);
      return viejo;
    });
    expect(clavesDeCopia()).toEqual([`m2:estado-cuenta:c:${CLIENTE}:0`]);
    await expect(cache.leer(CLIENTE, async () => nuevo)).resolves.toEqual(nuevo);
  });

  it('una versión que no es un entero se trata como falla de Redis: calcula y no guarda', async () => {
    await redis.set(`m2:estado-cuenta:v:${CLIENTE}`, 'abc', 60_000);
    const calcular = vi.fn(async () => estadoCon(CLIENTE));
    await expect(crear().leer(CLIENTE, calcular)).resolves.toEqual(estadoCon(CLIENTE));
    expect(clavesDeCopia()).toEqual([]);
  });
});

describe('sin caché o con Redis fallando (RF-2.6.8, RNF-06)', () => {
  it('con la caché apagada, siempre calcula y no usa Redis', async () => {
    const apagada = { ...crearRedisEnMemoria(), activo: false };
    const cache = crearCacheEstadoCuenta(apagada, { ttlS: TTL_S, ahora: () => AHORA });
    const calcular = vi.fn(async () => estadoCon(CLIENTE));
    await cache.leer(CLIENTE, calcular);
    await cache.leer(CLIENTE, calcular);
    expect(calcular).toHaveBeenCalledTimes(2);
    expect(apagada.llamadas).toEqual({ get: 0, set: 0, incr: 0, pexpire: 0 });
  });

  it('con Redis caído, responde calculando, sin lanzar y sin guardar', async () => {
    redis.fallar = true;
    const calcular = vi.fn(async () => estadoCon(CLIENTE));
    await expect(crear().leer(CLIENTE, calcular)).resolves.toEqual(estadoCon(CLIENTE));
    expect(calcular).toHaveBeenCalledTimes(1);
    redis.fallar = false;
    expect(clavesDeCopia()).toEqual([]);
  });

  it('si solo falla el guardado, igual devuelve el estado calculado', async () => {
    const original = redis.set;
    redis.set = async () => { throw new Error('se cortó'); };
    await expect(crear().leer(CLIENTE, async () => estadoCon(CLIENTE))).resolves.toEqual(estadoCon(CLIENTE));
    redis.set = original;
  });
});

describe('invalidar: subir la versión (RF-2.6.6, RF-2.6.6.1)', () => {
  it('después de invalidar, la siguiente lectura vuelve a calcular', async () => {
    const cache = crear();
    const calcular = vi.fn(async () => estadoCon(CLIENTE));
    await cache.leer(CLIENTE, calcular);
    await cache.invalidar(CLIENTE);
    await cache.leer(CLIENTE, calcular);
    expect(calcular).toHaveBeenCalledTimes(2);
    expect(redis.valor(`m2:estado-cuenta:v:${CLIENTE}`)).toBe('1');
  });

  it('solo invalida al cliente indicado', async () => {
    const cache = crear();
    const calcularOtro = vi.fn(async () => estadoCon(OTRO));
    await cache.leer(OTRO, calcularOtro);
    await cache.invalidar(CLIENTE);
    await cache.leer(OTRO, calcularOtro);
    expect(calcularOtro).toHaveBeenCalledTimes(1);
  });

  // La versión no vence: si venciera, el siguiente INCR volvería a dar un número ya usado, y una copia guardada con ese número
  // antes del vencimiento (todavía viva) pasaría por vigente aunque el cliente acabe de cambiar.
  it('la versión no tiene vencimiento: no se pide PEXPIRE ni se guarda con vencimiento', async () => {
    await crear().invalidar(CLIENTE);
    expect(redis.llamadas.pexpire).toBe(0);
    expect(redis.vencimientoPedido(`m2:estado-cuenta:v:${CLIENTE}`)).toBeUndefined();
  });

  // El caso que rompería una versión con vencimiento de 2 × TTL (60 s → 120 s): a los 70 s una consulta guarda la copia de la
  // versión 1, que vive hasta los 130 s; a los 120 s vencería la versión; a los 125 s llega un bloqueo y el INCR volvería a dar 1:
  // la consulta siguiente encontraría la copia ACTIVA de los 70 s.
  it('una copia guardada después del último cambio no reaparece tras el bloqueo siguiente', async () => {
    let reloj = AHORA;
    redis = crearRedisEnMemoria(() => reloj);
    const cache = crearCacheEstadoCuenta(redis, { ttlS: TTL_S, ahora: () => reloj });
    await cache.invalidar(CLIENTE);
    reloj += 70_000;
    await cache.leer(CLIENTE, async () => estadoCon(CLIENTE));
    reloj += 55_000;
    await cache.invalidar(CLIENTE);
    const bloqueado = estadoCon(CLIENTE, undefined);
    await expect(cache.leer(CLIENTE, async () => bloqueado)).resolves.toEqual(bloqueado);
  });

  it('con la caché apagada no hace nada', async () => {
    const apagada = { ...crearRedisEnMemoria(), activo: false };
    await crearCacheEstadoCuenta(apagada, { ttlS: TTL_S }).invalidar(CLIENTE);
    expect(apagada.llamadas).toEqual({ get: 0, set: 0, incr: 0, pexpire: 0 });
  });

  it('si Redis falla, no lanza: quien llama responde igual al operador', async () => {
    redis.fallar = true;
    await expect(crear().invalidar(CLIENTE)).resolves.toBeUndefined();
  });
});

describe('invalidación que falla (RF-2.6.8.1)', () => {
  it('mientras no se confirma el descarte, no sirve la copia de ese cliente ni guarda otra', async () => {
    const cache = crear();
    await cache.leer(CLIENTE, async () => estadoCon(CLIENTE));
    redis.fallarEn.add('incr');
    await cache.invalidar(CLIENTE);

    const bloqueado = estadoCon(CLIENTE, undefined);
    const calcular = vi.fn(async () => bloqueado);
    await expect(cache.leer(CLIENTE, calcular)).resolves.toEqual(bloqueado);
    await expect(cache.leer(CLIENTE, calcular)).resolves.toEqual(bloqueado);
    expect(calcular).toHaveBeenCalledTimes(2);
    // La copia ACTIVA sigue en Redis, pero nadie la sirve; y no se guardó otra.
    expect(redis.llamadas.set).toBe(1);
  });

  it('en la lectura siguiente reintenta el descarte; cuando sale, vuelve a usar la caché', async () => {
    const cache = crear();
    await cache.leer(CLIENTE, async () => estadoCon(CLIENTE));
    redis.fallarEn.add('incr');
    await cache.invalidar(CLIENTE);
    redis.fallarEn.delete('incr');

    const bloqueado = estadoCon(CLIENTE, undefined);
    const calcular = vi.fn(async () => bloqueado);
    await expect(cache.leer(CLIENTE, calcular)).resolves.toEqual(bloqueado);
    expect(redis.valor(`m2:estado-cuenta:v:${CLIENTE}`)).toBe('1');
    await expect(cache.leer(CLIENTE, calcular)).resolves.toEqual(bloqueado);
    expect(calcular).toHaveBeenCalledTimes(1);
  });

  it('una invalidación posterior que sale bien también la confirma', async () => {
    const cache = crear();
    redis.fallarEn.add('incr');
    await cache.invalidar(CLIENTE);
    redis.fallarEn.delete('incr');
    await cache.invalidar(CLIENTE);
    const calcular = vi.fn(async () => estadoCon(CLIENTE));
    await cache.leer(CLIENTE, calcular);
    await cache.leer(CLIENTE, calcular);
    expect(calcular).toHaveBeenCalledTimes(1);
    expect(redis.llamadas.incr).toBe(2);
  });

  it('solo afecta al cliente cuya invalidación falló', async () => {
    const cache = crear();
    redis.fallarEn.add('incr');
    await cache.invalidar(CLIENTE);
    const calcularOtro = vi.fn(async () => estadoCon(OTRO));
    await cache.leer(OTRO, calcularOtro);
    await cache.leer(OTRO, calcularOtro);
    expect(calcularOtro).toHaveBeenCalledTimes(1);
  });
});
