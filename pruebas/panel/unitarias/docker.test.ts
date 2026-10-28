import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buscarRaiz,
  ComandoDockerFallido,
  crearControlDocker,
  DockerNoDisponible,
  type Ejecutar,
} from '../../../panel/servidor/demo/docker.js';

// El control de Docker de la vista de demostración (spec 072, T7): apagar y encender la base con `docker compose`, con un
// `ejecutar` de mentira que anota cada llamada y responde lo que se le diga (RNF-13.4, RNF-13.6, RNF-12.10).
const RAIZ = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');

type Llamada = { archivo: string; argumentos: readonly string[]; opciones: Parameters<Ejecutar>[2] };
type Falla = { code?: string | number; stderr?: string; killed?: boolean; signal?: string };

function ejecutarDeMentira(falla?: Falla | ((argumentos: readonly string[]) => Falla | undefined)) {
  const llamadas: Llamada[] = [];
  const ejecutar: Ejecutar = async (archivo, argumentos, opciones) => {
    llamadas.push({ archivo, argumentos, opciones });
    const esta = typeof falla === 'function' ? falla(argumentos) : falla;
    if (esta !== undefined) throw Object.assign(new Error('Command failed: docker compose …'), esta);
    return { stdout: '', stderr: '' };
  };
  return { ejecutar, llamadas };
}

const controlCon = (ejecutar: Ejecutar, cambios: Partial<Parameters<typeof crearControlDocker>[0]> = {}) =>
  crearControlDocker({ docker: true, servicio: 'bd', ejecutar, ...cambios });

describe('crearControlDocker: los comandos (RNF-12.10)', () => {
  it('llama a docker con exactamente esos argumentos, sin shell, desde la raíz y con sus cortes', async () => {
    const { ejecutar, llamadas } = ejecutarDeMentira();
    const docker = controlCon(ejecutar);

    await docker.disponibilidad();
    await docker.apagar();
    await docker.encender();

    expect(llamadas).toEqual([
      { archivo: 'docker', argumentos: ['compose', 'ps', '--format', 'json', 'bd'], opciones: { cwd: RAIZ, timeout: 5000, shell: false } },
      { archivo: 'docker', argumentos: ['compose', 'stop', 'bd'], opciones: { cwd: RAIZ, timeout: 30_000, shell: false } },
      { archivo: 'docker', argumentos: ['compose', 'start', 'bd'], opciones: { cwd: RAIZ, timeout: 60_000, shell: false } },
    ]);
  });

  it('usa el servicio de la configuración', async () => {
    const { ejecutar, llamadas } = ejecutarDeMentira();

    await controlCon(ejecutar, { servicio: 'base-2' }).apagar();

    expect(llamadas.map(({ argumentos }) => argumentos.at(-1))).toEqual(['base-2', 'base-2']);
  });

  it('cada pulsación ejecuta el comando una vez', async () => {
    const { ejecutar, llamadas } = ejecutarDeMentira();
    const docker = controlCon(ejecutar);

    await docker.apagar();
    await docker.apagar();

    expect(llamadas.filter(({ argumentos }) => argumentos[1] === 'stop')).toHaveLength(2);
  });
});

describe('crearControlDocker: disponibilidad (RNF-13.6)', () => {
  it('disponible si `docker compose ps` termina bien, aunque el servicio esté detenido (sin salida)', async () => {
    const { ejecutar } = ejecutarDeMentira();

    expect(await controlCon(ejecutar).disponibilidad()).toEqual({ disponible: true });
  });

  it('con PANEL_DOCKER=no no ejecuta nada y dice que el panel corre en un contenedor', async () => {
    const { ejecutar, llamadas } = ejecutarDeMentira();

    const disponibilidad = await controlCon(ejecutar, { docker: false }).disponibilidad();

    expect(disponibilidad).toEqual({
      disponible: false,
      motivo: 'el panel corre en un contenedor y no tiene acceso a Docker',
      comoActivar: expect.stringContaining('npm run panel'),
    });
    expect(llamadas).toEqual([]);
  });

  it('ENOENT: Docker no está instalado', async () => {
    const { ejecutar } = ejecutarDeMentira({ code: 'ENOENT' });

    expect(await controlCon(ejecutar).disponibilidad()).toMatchObject({
      disponible: false,
      motivo: 'Docker no está instalado en esta máquina',
      comoActivar: expect.stringContaining('npm run panel'),
    });
  });

  it('«permission denied»: falta el grupo docker, y cómo sumarse', async () => {
    const { ejecutar } = ejecutarDeMentira({
      code: 1,
      stderr: 'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: Get "http://%2Fvar%2Frun%2Fdocker.sock/v1.47/containers/json": dial unix /var/run/docker.sock: connect: permission denied\n',
    });

    const disponibilidad = await controlCon(ejecutar).disponibilidad();

    expect(disponibilidad).toMatchObject({ disponible: false, motivo: 'el usuario no puede usar Docker sin sudo (grupo docker)' });
    expect(disponibilidad.comoActivar).toContain('grupo docker');
    expect(disponibilidad.comoActivar).toContain('npm run panel');
    expect(JSON.stringify(disponibilidad)).not.toContain('/var/run');
    expect(JSON.stringify(disponibilidad)).not.toContain('$');
  });

  it('servicio ausente: el primer renglón del error', async () => {
    const { ejecutar } = ejecutarDeMentira({ code: 1, stderr: 'no such service: bd\n' });

    expect(await controlCon(ejecutar).disponibilidad()).toMatchObject({ disponible: false, motivo: 'no such service: bd' });
  });

  it('otro error: el primer renglón, sin rutas, URLs ni variables', async () => {
    const { ejecutar } = ejecutarDeMentira({
      code: 1,
      stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is $DOCKER_HOST set in /home/ana/.bashrc?\nsegundo renglón\n',
    });

    const { motivo, comoActivar } = await controlCon(ejecutar).disponibilidad();

    expect(motivo).toMatch(/^Cannot connect to the Docker daemon at …/);
    for (const texto of ['/var/run', 'docker.sock', 'DOCKER_HOST', '/home/ana', 'segundo renglón']) expect(motivo).not.toContain(texto);
    expect(comoActivar).toContain('npm run panel');
  });

  it('si `docker compose ps` no contesta en 5 s, lo dice', async () => {
    const { ejecutar } = ejecutarDeMentira({ killed: true, signal: 'SIGTERM' });

    expect(await controlCon(ejecutar).disponibilidad()).toMatchObject({ disponible: false, motivo: 'docker compose no respondió en 5 s' });
  });

  it('sin docker-compose.yml en ninguna carpeta de arriba, no está disponible y no ejecuta nada', async () => {
    const { ejecutar, llamadas } = ejecutarDeMentira();

    const disponibilidad = await controlCon(ejecutar, { raiz: undefined }).disponibilidad();

    expect(disponibilidad).toMatchObject({ disponible: false, motivo: 'no se encontró docker-compose.yml' });
    expect(llamadas).toEqual([]);
  });

  it('guarda la disponibilidad 10 s', async () => {
    const { ejecutar, llamadas } = ejecutarDeMentira();
    let ahora = 1_000_000;
    const docker = controlCon(ejecutar, { ahora: () => ahora });

    await docker.disponibilidad();
    ahora += 9_999;
    await docker.disponibilidad();
    expect(llamadas).toHaveLength(1);

    ahora += 1;
    await docker.disponibilidad();
    expect(llamadas).toHaveLength(2);
  });

  it('dos consultas a la vez ejecutan `ps` una sola vez', async () => {
    const { ejecutar, llamadas } = ejecutarDeMentira();
    const docker = controlCon(ejecutar);

    await Promise.all([docker.disponibilidad(), docker.disponibilidad()]);

    expect(llamadas).toHaveLength(1);
  });
});

describe('crearControlDocker: apagar y encender (RNF-13.4)', () => {
  it.each([
    ['PANEL_DOCKER=no', { docker: false }, undefined],
    ['ENOENT', {}, { code: 'ENOENT' }],
    ['permission denied', {}, { code: 1, stderr: 'permission denied' }],
  ] as const)('sin Docker disponible (%s), apagar y encender no ejecutan nada y lanzan DockerNoDisponible', async (_caso, cambios, falla) => {
    const { ejecutar, llamadas } = ejecutarDeMentira(falla);
    const docker = controlCon(ejecutar, cambios);

    const errores = await Promise.all([docker.apagar().catch((e: unknown) => e), docker.encender().catch((e: unknown) => e)]);

    for (const error of errores) {
      expect(error).toBeInstanceOf(DockerNoDisponible);
      expect((error as DockerNoDisponible).disponibilidad.disponible).toBe(false);
    }
    expect(llamadas.filter(({ argumentos }) => argumentos[1] !== 'ps')).toEqual([]);
  });

  it('si el comando falla, lanza ComandoDockerFallido con el primer renglón sin rutas', async () => {
    const { ejecutar } = ejecutarDeMentira((argumentos) =>
      argumentos[1] === 'stop' ? { code: 1, stderr: 'Error response from daemon: open /var/lib/docker/x: no space left\n' } : undefined,
    );

    const error = await controlCon(ejecutar).apagar().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ComandoDockerFallido);
    expect((error as Error).message).toContain('Error response from daemon');
    expect((error as Error).message).not.toContain('/var/lib');
  });

  it('si encender no termina en 60 s, lo dice', async () => {
    const { ejecutar } = ejecutarDeMentira((argumentos) => (argumentos[1] === 'start' ? { killed: true, signal: 'SIGTERM' } : undefined));

    await expect(controlCon(ejecutar).encender()).rejects.toThrow('docker compose no respondió en 60 s');
  });
});

describe('buscarRaiz', () => {
  it('desde el código fuente y desde el compilado encuentra la raíz del repositorio', () => {
    expect(buscarRaiz(join(RAIZ, 'panel/servidor/demo'))).toBe(RAIZ);
    expect(buscarRaiz(join(RAIZ, 'panel/dist/servidor/demo'))).toBe(RAIZ);
  });

  it('sin docker-compose.yml arriba devuelve undefined', () => {
    const carpeta = mkdtempSync(join(tmpdir(), 'panel-raiz-'));
    try {
      expect(buscarRaiz(carpeta)).toBeUndefined();
    } finally {
      rmSync(carpeta, { recursive: true, force: true });
    }
  });
});
