import { createServer } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearApp } from '../ayudas/app.js';
import { capturarLogs } from '../ayudas/logs.js';
import { levantarRedisFalso, type RedisFalso } from '../ayudas/redis-falso.js';

// La app crea el cliente de Redis con la configuración y lo cierra al detenerse (spec 107, RNF-11, RNF-13, RNF-14, RNF-19).

const servidores: RedisFalso[] = [];
afterEach(async () => {
  await Promise.all(servidores.splice(0).map((servidor) => servidor.cerrar()));
});

describe('app.redis', () => {
  it('sin M2_URL_REDIS, la caché está apagada', () => {
    const app = crearApp({});
    expect(app.redis.activo).toBe(false);
  });

  it('con M2_URL_REDIS se conecta, y app.close() lo cierra', async () => {
    const servidor = await levantarRedisFalso();
    servidores.push(servidor);
    const app = crearApp({}, { config: { urlRedis: servidor.url, tiempoRedisMs: 150 } });
    expect(app.redis.activo).toBe(true);
    await vi.waitFor(() => expect(app.redis.conectado).toBe(true), { timeout: 3000 });
    await app.close();
    expect(app.redis.conectado).toBe(false);
  });

  it('con Redis caído la app arranca igual y deja un aviso con la operación y el código, sin la dirección', async () => {
    const libre = createServer();
    await new Promise<void>((listo) => libre.listen(0, '127.0.0.1', listo));
    const direccion = libre.address();
    const puerto = typeof direccion === 'object' && direccion !== null ? direccion.port : 0;
    await new Promise<void>((listo) => libre.close(() => listo()));

    const logs = capturarLogs();
    const app = crearApp({}, { config: { urlRedis: `redis://:clave-secreta@127.0.0.1:${puerto}`, tiempoRedisMs: 150 }, flujoLog: logs.flujo });
    await app.ready();
    await vi.waitFor(() => expect(logs.lineas().some((linea) => linea['operacion'] === 'conexion')).toBe(true), { timeout: 3000 });
    const aviso = logs.lineas().find((linea) => linea['operacion'] === 'conexion');
    expect(aviso).toMatchObject({ level: 40, operacion: 'conexion', codigo: 'ECONNREFUSED' });
    expect(logs.texto()).not.toMatch(/clave-secreta|127\.0\.0\.1/);
  });
});
