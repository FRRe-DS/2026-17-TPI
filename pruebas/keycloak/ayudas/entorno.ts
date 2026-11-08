import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as pausar } from 'node:timers/promises';
import { promisify } from 'node:util';

// El entorno de la prueba con Keycloak real (spec 080, plan «Pruebas», RNF-07.13): M2 en modo jwks, su base, Keycloak y la base de
// Keycloak, levantados con `--env-file ejemplo-keycloak.env` en un proyecto de compose aparte y con puertos propios, para no pisar
// lo que la persona tenga levantado.
export const PROYECTO = 'm2-keycloak';
export const PUERTO_M2 = 18083;
export const PUERTO_KEYCLOAK = 18080;
export const URL_M2 = `http://127.0.0.1:${PUERTO_M2}`;
// El emisor sale de KC_HOSTNAME, que dice localhost: se le pide a Keycloak por ese mismo nombre.
export const URL_REALM = `http://localhost:${PUERTO_KEYCLOAK}/realms/ds-2026-realm`;
export const URL_TOKEN = `${URL_REALM}/protocol/openid-connect/token`;

// El primer build de M2 y el primer arranque de Keycloak (crea sus tablas e importa el realm) pueden tardar minutos.
export const TIEMPO_COMPOSE_MS = 10 * 60_000;
const TIEMPO_SALUD_MS = 90_000;

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
const ejecutar = promisify(execFile);

// Lo que define ejemplo-keycloak.env no se hereda del entorno de quien corre la prueba: compose le daría prioridad, y una
// M2_MODO_TOKENS=hs256 de la terminal haría pasar la prueba por el modo equivocado.
const DEL_ARCHIVO = ['COMPOSE_PROFILES', 'M2_MODO_TOKENS', 'M2_EMISOR_TOKENS'];

export function entornoCompose(): NodeJS.ProcessEnv {
  const entorno: NodeJS.ProcessEnv = { ...process.env, M2_PUERTO: String(PUERTO_M2), KEYCLOAK_PUERTO: String(PUERTO_KEYCLOAK) };
  for (const variable of DEL_ARCHIVO) delete entorno[variable];
  return entorno;
}

// Corre `docker <argumentos>` en la raíz del repositorio. Si falla, el error dice qué comando fue y la cola de su salida.
export async function docker(argumentos: string[], opciones: { tiempoMs?: number } = {}): Promise<string> {
  try {
    const { stdout } = await ejecutar('docker', argumentos, {
      cwd: RAIZ,
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
  docker(['compose', '-p', PROYECTO, '--env-file', 'ejemplo-keycloak.env', ...argumentos], opciones);

// Espera a que `url` conteste 2xx.
export async function esperarSano(nombre: string, url: string): Promise<void> {
  const limite = Date.now() + TIEMPO_SALUD_MS;
  let ultimo = 'sin respuesta';
  while (Date.now() < limite) {
    try {
      const respuesta = await fetch(url, { signal: AbortSignal.timeout(3000) });
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
  return `Falló el entorno con Keycloak: ${comando} ${causa}.${cola === '' ? '' : `\n${cola}`}`;
}
