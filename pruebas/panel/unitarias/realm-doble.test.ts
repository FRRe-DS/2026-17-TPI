import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
it('realm agrega identidad doble sin alterar roles previos ni PKCE', () => {
  const realm = JSON.parse(readFileSync(new URL('../../../keycloak/ds-2026-realm-realm.json', import.meta.url), 'utf8'));
  const usuario = realm.users.find((u: { username: string }) => u.username === 'cliente-operador1');
  expect(usuario).toMatchObject({ id: 'd0b00000-0000-4000-8000-000000000001', enabled: true, realmRoles: ['CLIENTE', 'OPERADOR'] });
  for (const [nombre, rol] of [['cliente1', 'CLIENTE'], ['cliente2', 'CLIENTE'], ['operador1', 'OPERADOR']])
    expect(realm.users.find((u: { username: string }) => u.username === nombre).realmRoles).toEqual([rol]);
  expect(realm.clients.find((c: { clientId: string }) => c.clientId === 'm2-front').attributes['pkce.code.challenge.method']).toBe('S256');
});
