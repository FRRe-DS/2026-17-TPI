// Los usuarios de ejemplo del realm de desarrollo (spec 080, RNF-12.17), con su `id` fijo: es el `sub` de sus tokens y, para un
// CLIENTE, su `clienteId`. `pruebas/unitarias/realm.test.ts` comprueba que el JSON dice lo mismo, y la prueba con Keycloak real
// los usa para pedir tokens. Las contraseñas son de desarrollo y no sirven fuera de la máquina (RNF-06.8).
export type UsuarioDeEjemplo = { usuario: string; id: string; rol: 'CLIENTE' | 'OPERADOR' | 'CONDUCTOR'; contrasena: string };

export const USUARIOS_DE_EJEMPLO: readonly UsuarioDeEjemplo[] = [
  { usuario: 'cliente1', id: 'c1e00000-0000-4000-8000-000000000001', rol: 'CLIENTE', contrasena: 'cliente1-contrasena-de-desarrollo' },
  { usuario: 'cliente2', id: 'c1e00000-0000-4000-8000-000000000002', rol: 'CLIENTE', contrasena: 'cliente2-contrasena-de-desarrollo' },
  { usuario: 'operador1', id: '0be00000-0000-4000-8000-000000000001', rol: 'OPERADOR', contrasena: 'operador1-contrasena-de-desarrollo' },
  { usuario: 'conductor1', id: 'c0d00000-0000-4000-8000-000000000001', rol: 'CONDUCTOR', contrasena: 'conductor1-contrasena-de-desarrollo' },
];

// El cliente público con el que las pruebas piden tokens de persona con usuario y contraseña, sin navegador.
export const CLIENTE_DE_DESARROLLO = 'm2-desarrollo';

// Los scopes de M2 que define el realm.
export const SCOPES_DE_M2 = ['clientes:read', 'clientes:write', 'clientes.estado:read'] as const;
