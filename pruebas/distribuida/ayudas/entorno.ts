import { execFile } from 'node:child_process';
import { setTimeout as pausar } from 'node:timers/promises';
import { promisify } from 'node:util';

// El entorno de la prueba distribuida (spec 081, plan «Entorno»): M2, su base, el M6 real del Grupo 12 y la base de M6, en un
// proyecto de compose aparte y con puertos propios, para no pisar el M2 que la persona tenga levantado para trabajar.
export const PROYECTO = 'm2-distribuida';
export const PUERTO_M2 = 18082;
export const PUERTO_M6 = 13006;
export const URL_M2 = `http://127.0.0.1:${PUERTO_M2}`;
export const URL_M6 = `http://127.0.0.1:${PUERTO_M6}`;
// Cómo ve M2 a M6 por la red de compose (RNF-06.6: es lo único que cambia respecto de la configuración normal).
export const URL_M6_DESDE_M2 = 'http://m6-real:3006';

// El primer build baja y compila a M6: puede tardar minutos.
export const TIEMPO_COMPOSE_MS = 10 * 60_000;

const TIEMPO_SALUD_MS = 60_000;

const ejecutar = promisify(execFile);

export const entornoCompose = (): NodeJS.ProcessEnv => ({
  ...process.env,
  M2_URL_M6: URL_M6_DESDE_M2,
  M2_PUERTO: String(PUERTO_M2),
  M6_REAL_PUERTO: String(PUERTO_M6),
});

// Corre `docker <argumentos>`. Si falla, el error dice qué comando fue y la cola de su salida; no deja pasar nada en silencio.
async function docker(argumentos: string[], opciones: { tiempoMs?: number } = {}): Promise<string> {
  try {
    const { stdout } = await ejecutar('docker', argumentos, {
      env: entornoCompose(),
      timeout: opciones.tiempoMs ?? TIEMPO_COMPOSE_MS,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    throw new Error(descripcionDeFalla(`docker ${argumentos.join(' ')}`, error), { cause: error });
  }
}

export const compose = (argumentos: string[], opciones: { tiempoMs?: number } = {}): Promise<string> =>
  docker(['compose', '-p', PROYECTO, '--profile', 'm6-real', ...argumentos], opciones);

// Cuándo arrancó el contenedor de M2: si cambia, M2 se reinició.
export async function inicioDeM2(): Promise<string> {
  const id = (await compose(['ps', '-q', 'm2'], { tiempoMs: 30_000 })).trim();
  if (id === '') throw new Error(`No hay un contenedor de m2 en el proyecto «${PROYECTO}».`);
  return (await docker(['inspect', '-f', '{{.State.StartedAt}}', id], { tiempoMs: 30_000 })).trim();
}

// Espera a que `GET /health` conteste 2xx. No pasa por el contador: M6 no le aplica su límite de pedidos a esa ruta.
export async function esperarSalud(nombre: string, url: string): Promise<void> {
  const limite = Date.now() + TIEMPO_SALUD_MS;
  let ultimo = 'sin respuesta';
  while (Date.now() < limite) {
    try {
      const respuesta = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
      if (respuesta.ok) return;
      ultimo = `respondió ${respuesta.status}`;
    } catch (error) {
      ultimo = error instanceof Error ? error.message : String(error);
    }
    await pausar(1000);
  }
  throw new Error(`${nombre} no quedó sano en ${TIEMPO_SALUD_MS / 1000} s (${ultimo}). El proyecto de compose es «${PROYECTO}».`);
}

const COLA_MAXIMA = 2000;

export function descripcionDeFalla(comando: string, error: unknown): string {
  const e = error as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
  if (e.code === 'ENOENT') return `No se encontró el comando «docker». ¿Está instalado y en el PATH? (${comando})`;
  const salida = (e.stderr ?? '').trim();
  const cola = salida.length > COLA_MAXIMA ? `…${salida.slice(-COLA_MAXIMA)}` : salida;
  const causa = e.killed === true ? 'pasó el tiempo máximo' : 'terminó con error';
  return `Falló el entorno distribuido: ${comando} ${causa}.${cola === '' ? '' : `\n${cola}`}`;
}
