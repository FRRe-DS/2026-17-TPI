import { createServer } from 'node:net';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

// La imagen de Redis de las pruebas de integración: la misma, con su versión exacta, que usa docker compose (spec 107, RNF-04.1).
// consistencia.test.ts comprueba que coinciden.
export const IMAGEN_REDIS = 'redis:8.6.8-alpine';

// Un puerto libre de la máquina: se abre un servidor, se anota el puerto y se cierra.
export async function puertoLibre(): Promise<number> {
  const servidor = createServer();
  await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
  const direccion = servidor.address();
  const puerto = typeof direccion === 'object' && direccion !== null ? direccion.port : 0;
  await new Promise<void>((listo) => servidor.close(() => listo()));
  return puerto;
}

// Un Redis de verdad, como el del compose (sin persistencia), publicado en `puerto` de la máquina. Con un puerto fijo, se lo puede
// detener y levantar otro en el mismo lugar: M2 no cambia su configuración y se reconecta solo.
export async function levantarRedisReal(puerto: number): Promise<StartedTestContainer> {
  return new GenericContainer(IMAGEN_REDIS)
    .withCommand(['redis-server', '--save', '', '--appendonly', 'no', '--maxmemory-policy', 'noeviction'])
    .withExposedPorts({ container: 6379, host: puerto })
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .start();
}

// Un comando de redis-cli dentro del contenedor, y su salida sin el salto final.
export async function redisCli(contenedor: StartedTestContainer, ...argumentos: string[]): Promise<string> {
  const { output, exitCode } = await contenedor.exec(['redis-cli', ...argumentos]);
  if (exitCode !== 0) throw new Error(`redis-cli ${argumentos[0] ?? ''} terminó con ${exitCode}`);
  return output.trim();
}
