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

// El cliente público del frontend (RNF-12.20): solo código de autorización con PKCE S256, y vuelve solo a la máquina local (el
// panel, en PANEL_PUERTO). Lo va a usar el inicio de sesión del #83.
export const CLIENTE_DEL_FRONT = 'm2-front';
export const RETORNOS_DEL_FRONT = ['http://localhost:8083/*', 'http://127.0.0.1:8083/*'] as const;
export const ORIGENES_DEL_FRONT = ['http://localhost:8083', 'http://127.0.0.1:8083'] as const;

// Los scopes de M2 que define el realm.
export const SCOPES_DE_M2 = ['clientes:read', 'clientes:write', 'clientes.estado:read'] as const;
