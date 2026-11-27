import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as pausar } from 'node:timers/promises';
import { promisify } from 'node:util';

// El entorno de la prueba distribuida (spec 081, plan «Entorno»): M2, su base, el M6 real del Grupo 12 y la base de M6, en un
// proyecto de compose aparte y con puertos propios, para no pisar el M2 que la persona tenga levantado para trabajar. Desde la
// spec 125 también Keycloak y su base (el perfil m6-real los levanta): el M6 real valida contra él el token de servicio de M2.
export const PROYECTO = 'm2-distribuida';
export const PUERTO_M2 = 18082;
export const PUERTO_M6 = 13006;
export const URL_M2 = `http://127.0.0.1:${PUERTO_M2}`;
export const URL_M6 = `http://127.0.0.1:${PUERTO_M6}`;
// Cómo ve M2 a M6 por la red de compose (RNF-06.6: es lo único que cambia respecto de la configuración normal).
export const URL_M6_DESDE_M2 = 'http://m6-real:3006';
// Ni el 8080 de quien trabaja ni el 18080 de la prueba con Keycloak (spec 080). El emisor de los tokens sale de este puerto.
export const PUERTO_KEYCLOAK = 18081;
export const URL_TOKEN = `http://localhost:${PUERTO_KEYCLOAK}/realms/ds-2026-realm/protocol/openid-connect/token`;

// M2 pide su token de servicio a Keycloak como grupo-17 con los mismos valores que ejemplo-keycloak.env (spec 125, RNF-07.15). Solo
// esas tres: el resto de ese archivo pasaría a M2 a modo jwks, y la prueba firma los tokens que M2 recibe con su comando hs256.
const TOKEN_DE_SERVICIO = ['M2_URL_TOKENS_SERVICIO', 'M2_CLIENTE_SERVICIO', 'M2_SECRETO_SERVICIO'] as const;
const ARCHIVO_KEYCLOAK = readFileSync(new URL('../../../ejemplo-keycloak.env', import.meta.url), 'utf8');
const delArchivoKeycloak = (variable: string): string => {
  const valor = new RegExp(`^${variable}=(.*)$`, 'm').exec(ARCHIVO_KEYCLOAK)?.[1];
  if (valor === undefined || valor === '') throw new Error(`ejemplo-keycloak.env no trae ${variable}.`);
  return valor;
};
// Lo que no se hereda de la terminal: haría pasar la prueba por otro modo de tokens u otros perfiles.
const NO_HEREDADAS = ['M2_MODO_TOKENS', 'M2_EMISOR_TOKENS', 'COMPOSE_PROFILES'];

// El primer build baja y compila a M6: puede tardar minutos.
export const TIEMPO_COMPOSE_MS = 10 * 60_000;

const TIEMPO_SALUD_MS = 60_000;

const ejecutar = promisify(execFile);

export function entornoCompose(): NodeJS.ProcessEnv {
  const entorno: NodeJS.ProcessEnv = {
    ...process.env,
    M2_URL_M6: URL_M6_DESDE_M2,
    M2_PUERTO: String(PUERTO_M2),
    M6_REAL_PUERTO: String(PUERTO_M6),
    KEYCLOAK_PUERTO: String(PUERTO_KEYCLOAK),
  };
  for (const variable of NO_HEREDADAS) delete entorno[variable];
  for (const variable of TOKEN_DE_SERVICIO) entorno[variable] = delArchivoKeycloak(variable);
  return entorno;
}

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
