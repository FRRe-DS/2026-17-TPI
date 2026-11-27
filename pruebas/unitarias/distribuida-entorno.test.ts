import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { entornoCompose, PUERTO_KEYCLOAK, URL_TOKEN } from '../distribuida/ayudas/entorno.js';

// El entorno de compose de la prueba distribuida (spec 081, RNF-07.7) con el token de servicio de Keycloak (spec 125, RNF-07.15).
const keycloakEnv = readFileSync(new URL('../../ejemplo-keycloak.env', import.meta.url), 'utf8');
const delArchivo = (variable: string) => new RegExp(`^${variable}=(.*)$`, 'm').exec(keycloakEnv)?.[1];

describe('pruebas/distribuida/ayudas/entorno.ts: entornoCompose', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(['M2_URL_TOKENS_SERVICIO', 'M2_CLIENTE_SERVICIO', 'M2_SECRETO_SERVICIO'])(
    'M2 recibe %s de ejemplo-keycloak.env: pide su token a Keycloak como grupo-17',
    (variable) => {
      expect(delArchivo(variable)).toBeTruthy();
      expect(entornoCompose()[variable]).toBe(delArchivo(variable));
    },
  );

  it('ni la terminal ni la sesión pisan las variables del token de servicio', () => {
    vi.stubEnv('M2_SECRETO_SERVICIO', 'otro-secreto');
    vi.stubEnv('M2_CLIENTE_SERVICIO', 'otro-cliente');
    expect(entornoCompose()['M2_SECRETO_SERVICIO']).toBe(delArchivo('M2_SECRETO_SERVICIO'));
    expect(entornoCompose()['M2_CLIENTE_SERVICIO']).toBe('grupo-17');
  });

  // M2 sigue validando en hs256 los tokens que recibe: la prueba los firma con dist/herramientas/token.js.
  it('no hereda de la terminal el modo ni el emisor de los tokens que M2 recibe, ni perfiles de compose', () => {
    vi.stubEnv('M2_MODO_TOKENS', 'jwks');
    vi.stubEnv('M2_EMISOR_TOKENS', 'http://otro');
    vi.stubEnv('COMPOSE_PROFILES', 'panel');
    const entorno = entornoCompose();
    expect(entorno['M2_MODO_TOKENS']).toBeUndefined();
    expect(entorno['M2_EMISOR_TOKENS']).toBeUndefined();
    expect(entorno['COMPOSE_PROFILES']).toBeUndefined();
  });

  // Uno propio: ni el 8080 de quien trabaja ni el 18080 de la prueba con Keycloak (spec 080).
  it('publica Keycloak en un puerto propio, y el emisor sale de ese puerto', () => {
    expect(PUERTO_KEYCLOAK).toBe(18081);
    expect(entornoCompose()['KEYCLOAK_PUERTO']).toBe('18081');
    expect(URL_TOKEN).toBe('http://localhost:18081/realms/ds-2026-realm/protocol/openid-connect/token');
  });
});
