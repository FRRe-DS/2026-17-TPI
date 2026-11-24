import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
export const PROYECTO = 'm2-front-keycloak';
export const ORIGEN = 'http://localhost:28083';
export const REALM = 'http://localhost:28080/realms/ds-2026-realm';
const cwd = fileURLToPath(new URL('../../', import.meta.url));
const ejecutar = promisify(execFile);
export const envFront = (): NodeJS.ProcessEnv => ({ ...process.env, COMPOSE_PROFILES: 'front,keycloak', PANEL_PUERTO: '28083',
  KEYCLOAK_PUERTO: '28080', M2_PUERTO: '28082', M2_MODO_TOKENS: 'jwks', M2_EMISOR_TOKENS: REALM,
  PANEL_URL_BD: 'centinela-base-no-heredar', PANEL_URL_M6_CONTROL: 'centinela-control-no-heredar',
});
class FalloEntornoFront extends Error {
  constructor(error: unknown) { super(describirFallaDocker(error)); this.name = 'FalloEntornoFront'; }
}
export async function docker(args: string[]) {
  try { return (await ejecutar('docker', args, { cwd, env: envFront(), maxBuffer: 32 * 1024 * 1024, timeout: 600_000 })).stdout; }
  catch (error) { throw new FalloEntornoFront(error); }
}
export function describirFallaDocker(error: unknown): string {
  const stderr = (error as { stderr?: unknown })?.stderr;
  let detalle = typeof stderr === 'string' ? stderr : 'Sin salida de error de Docker.';
  for (const [nombre, valor] of Object.entries(envFront())) {
    if (valor && /PASSWORD|SECRET|TOKEN|CLAVE|URL_BD|URL_M6_CONTROL/i.test(nombre)) detalle = detalle.replaceAll(valor, '[oculto]');
  }
  detalle = detalle.replace(/(https?:\/\/|postgres(?:ql)?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[oculto]@')
    .replace(/Bearer\s+\S+/gi, 'Bearer [oculto]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[oculto]')
    .replace(/((?:password|secret|token|clave)[\w-]*["']?\s*[:=]\s*)[^\s,}]+/gi, '$1[oculto]');
  return `Falló Docker en el entorno aislado m2-front-keycloak:\n${detalle.slice(-6000)}`;
}
export function compose(args: string[], override?: string) {
  return docker(['compose', '-p', PROYECTO, '-f', 'docker-compose.yml', '-f', 'docker-compose.front.yml',
    ...(override ? ['-f', override] : []), '--env-file', 'ejemplo-front-keycloak.env', ...args]);
}
