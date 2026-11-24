import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { it, expect } from 'vitest';
const cwd = fileURLToPath(new URL('../../../', import.meta.url));
const PERMITIDAS = ['PANEL_MODO_AUTH', 'PANEL_ESCUCHA', 'PANEL_PUERTO', 'PANEL_URL_M2', 'PANEL_URL_M2_PUBLICA', 'PANEL_ORIGEN_PUBLICO',
  'PANEL_OIDC_EMISOR', 'PANEL_OIDC_URL_INTERNA', 'PANEL_OIDC_CLIENTE', 'PANEL_TIEMPO_IDENTIDAD_MS', 'PANEL_M6_SIMULADO'];
it('compose resuelto reemplaza secretos heredados y no publica BD/control', () => {
  const entorno = { ...process.env, COMPOSE_PROFILES: 'front,keycloak', PANEL_URL_BD: 'centinela-base', M2_CLAVE_TOKENS: 'centinela-firma',
    POSTGRES_PASSWORD: 'centinela-postgres', PANEL_URL_M6_CONTROL: 'centinela-control' };
  const modelo = JSON.parse(execFileSync('docker', ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.front.yml',
    '--env-file', 'ejemplo-front-keycloak.env', 'config', '--format', 'json'], { cwd, env: entorno, encoding: 'utf8' }));
  const panel = modelo.services.panel;
  expect(Object.keys(panel.environment).sort()).toEqual([...PERMITIDAS].sort());
  expect(JSON.stringify(panel).includes('centinela')).toBe(false); expect(panel.env_file).toBeUndefined();
  expect(modelo.services['bd-puente']).toBeUndefined(); expect(modelo.services.bd.ports ?? []).toEqual([]);
  expect(modelo.services.m6.ports ?? []).toEqual([]); expect(modelo.services.m2.environment.M2_MODO_TOKENS).toBe('jwks');
});
it('desarrollo conserva puente en perfil panel', () => {
  const modelo = JSON.parse(execFileSync('docker', ['compose', '--profile', 'panel', 'config', '--format', 'json'], {
    cwd, env: { ...process.env, COMPOSE_PROFILES: 'panel' }, encoding: 'utf8',
  }));
  expect(modelo.services['bd-puente'].ports[0].host_ip).toBe('127.0.0.1');
});
