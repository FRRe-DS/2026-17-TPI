import { it, expect } from 'vitest';
import { describirFallaDocker } from '../../front-keycloak/entorno.js';
it('conserva error útil de Docker sin volcar credenciales ni entorno', () => {
  const mensaje = describirFallaDocker({ stderr: 'uid 1000: directory not found /tmp/realm\nPANEL_URL_BD=centinela-base-no-heredar\npassword=muy-secreta\npostgres://user:otra-clave@bd/base\nBearer mi-token' });
  expect(mensaje).toContain('uid 1000: directory not found /tmp/realm');
  for (const secreto of ['centinela-base-no-heredar', 'muy-secreta', 'otra-clave', 'mi-token']) expect(mensaje).not.toContain(secreto);
});
