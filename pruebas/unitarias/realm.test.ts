import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cargarContrato, type Contrato } from '../../src/contrato/cargar.js';
import { CLIENTE_DE_DESARROLLO, CLIENTE_DEL_FRONT, ORIGENES_DEL_FRONT, RETORNOS_DEL_FRONT, SCOPES_DE_M2, USUARIOS_DE_EJEMPLO } from '../ayudas/realm.js';

// El realm de desarrollo (spec 080, RNF-12.17, RNF-06.8): copia del ds-2026-realm de la cátedra con lo que M2 necesita. Se lee el
// JSON, sin Keycloak; lo que hace Keycloak con él lo comprueba la prueba con Keycloak real.

type Mapper = { name?: string; protocolMapper?: string; config?: Record<string, string> };
type Scope = { name: string; attributes?: Record<string, string>; protocolMappers?: Mapper[] };
type Cliente = {
  clientId: string;
  publicClient?: boolean;
  secret?: string;
  standardFlowEnabled?: boolean;
  implicitFlowEnabled?: boolean;
  directAccessGrantsEnabled?: boolean;
  serviceAccountsEnabled?: boolean;
  redirectUris?: string[];
  webOrigins?: string[];
  attributes?: Record<string, string>;
  defaultClientScopes?: string[];
  optionalClientScopes?: string[];
};
type Credencial = { type?: string; value?: string; temporary?: boolean };
type Usuario = {
  id?: string;
  username: string;
  enabled?: boolean;
  emailVerified?: boolean;
  email?: string;
  firstName?: string;
  lastName?: string;
  requiredActions?: string[];
  credentials?: Credencial[];
  serviceAccountClientId?: string;
  realmRoles?: string[];
};
type Realm = {
  realm: string;
  roles?: { realm?: { name: string }[] };
  clientScopes?: Scope[];
  clients?: Cliente[];
  users?: Usuario[];
};

const realm = JSON.parse(readFileSync(new URL('../../keycloak/ds-2026-realm-realm.json', import.meta.url), 'utf8')) as Realm;

// Los valores de M2 salen de ejemplo.env, para que el realm y el servicio no puedan separarse sin que esta prueba lo note.
const ejemplo = readFileSync(new URL('../../ejemplo.env', import.meta.url), 'utf8');
function porDefecto(variable: string): string {
  return new RegExp(`^${variable}=\\$\\{${variable}:-([^}]*)\\}$`, 'm').exec(ejemplo)?.[1] ?? '';
}
const AUDIENCIA = porDefecto('M2_AUDIENCIA_TOKENS');
const CAMPO_ROLES = porDefecto('M2_CAMPO_ROLES');

const ROLES_DE_M2 = ['CLIENTE', 'OPERADOR', 'SERVICIO', 'CONDUCTOR'];
const ROLES_DE_LA_CATEDRA = ['clientes-be', 'conductores-be', 'ubicacion-be', 'solicitud-be', 'viajes-be', 'tarifas-be', 'notificaciones-be', 'reservas-be'];
// M5 (Solicitud y Despacho) y M9 (Reservas) de los dos consorcios: los únicos módulos que consultan a M2 (RNF-12.17).
const CLIENTES_M5_M9 = ['grupo-04', 'grupo-13', 'grupo-08', 'grupo-09'];
const GRUPOS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '17'].map((n) => `grupo-${n}`);

const scope = (nombre: string) => realm.clientScopes?.find((s) => s.name === nombre);
const cliente = (id: string) => realm.clients?.find((c) => c.clientId === id);
const cuentaDeServicio = (id: string) => realm.users?.find((u) => u.serviceAccountClientId === id);
const scopesDe = (c: Cliente | undefined) => [...(c?.defaultClientScopes ?? []), ...(c?.optionalClientScopes ?? [])];
const esDeM2 = (s: string) => (SCOPES_DE_M2 as readonly string[]).includes(s);
const usuario = (nombre: string) => realm.users?.find((u) => u.username === nombre);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Los scopes que declara un contrato: los de los flujos de cada esquema oauth2 y los que piden los renglones de `security` de
// esquemas oauth2 u openIdConnect, globales y por operación. Los de esquemas de roles (bearerAuth) no son scopes (T8).
function scopesDelContrato(contrato: Contrato): string[] {
  const componentes = contrato['components'] as { securitySchemes?: Record<string, { type?: string; flows?: Record<string, { scopes?: Record<string, string> }> }> } | undefined;
  const esquemas = componentes?.securitySchemes ?? {};
  const deScopes = new Set(Object.entries(esquemas).filter(([, e]) => e.type === 'oauth2' || e.type === 'openIdConnect').map(([nombre]) => nombre));
  const encontrados = new Set<string>();
  for (const esquema of Object.values(esquemas)) {
    for (const flujo of Object.values(esquema.flows ?? {})) for (const nombre of Object.keys(flujo.scopes ?? {})) encontrados.add(nombre);
  }
  const renglones: Record<string, string[]>[] = [...((contrato['security'] as Record<string, string[]>[] | undefined) ?? [])];
  for (const item of Object.values((contrato['paths'] as Record<string, Record<string, { security?: Record<string, string[]>[] }>> | undefined) ?? {})) {
    for (const operacion of Object.values(item)) if (Array.isArray(operacion?.security)) renglones.push(...operacion.security);
  }
  for (const renglon of renglones) {
    for (const [nombre, lista] of Object.entries(renglon)) if (deScopes.has(nombre)) for (const s of lista) encontrados.add(s);
  }
  return [...encontrados].sort();
}

describe('realm de desarrollo: lo que se conserva de la cátedra (RNF-12.17)', () => {
  it('se llama ds-2026-realm y conserva los 16 clientes grupo-NN y los roles *-be', () => {
    expect(realm.realm).toBe('ds-2026-realm');
    expect(GRUPOS.filter((id) => !cliente(id))).toEqual([]);
    const roles = (realm.roles?.realm ?? []).map((r) => r.name);
    expect(ROLES_DE_LA_CATEDRA.filter((r) => !roles.includes(r))).toEqual([]);
  });

  it('cada cuenta de servicio conserva su rol *-be', () => {
    for (const id of GRUPOS) expect(cuentaDeServicio(id)?.realmRoles?.some((r) => r.endsWith('-be')), id).toBe(true);
  });
});

describe('realm de desarrollo: roles, scopes y cuentas de servicio de M2 (RNF-12.17)', () => {
  it('trae los roles de realm de M2, una sola vez cada uno', () => {
    const roles = (realm.roles?.realm ?? []).map((r) => r.name);
    for (const rol of ROLES_DE_M2) expect(roles.filter((r) => r === rol), rol).toEqual([rol]);
  });

  it('el scope m2-token no figura en el campo scope y pone los roles de realm en el campo que lee M2', () => {
    const m2Token = scope('m2-token');
    expect(m2Token?.attributes?.['include.in.token.scope']).toBe('false');
    const roles = m2Token?.protocolMappers?.filter((m) => m.protocolMapper === 'oidc-usermodel-realm-role-mapper') ?? [];
    expect(roles).toHaveLength(1);
    expect(roles[0]?.config).toMatchObject({ 'claim.name': CAMPO_ROLES, multivalued: 'true', 'access.token.claim': 'true' });
  });

  // Un ID token se firma con la misma clave: si trajera la audiencia, pasaría en M2 (RNF-07.13).
  it('el scope m2-token pone la audiencia de M2 solo en el token de acceso, nunca en el ID token', () => {
    const audiencias = scope('m2-token')?.protocolMappers?.filter((m) => m.protocolMapper === 'oidc-audience-mapper') ?? [];
    expect(audiencias).toHaveLength(1);
    expect(AUDIENCIA).toBe('m2-clientes');
    expect(audiencias[0]?.config).toMatchObject({ 'included.custom.audience': AUDIENCIA, 'access.token.claim': 'true', 'id.token.claim': 'false' });
  });

  it('los scopes de M2 existen, una sola vez cada uno, y figuran en el campo scope del token', () => {
    for (const nombre of SCOPES_DE_M2) {
      expect(realm.clientScopes?.filter((s) => s.name === nombre), nombre).toHaveLength(1);
      expect(scope(nombre)?.attributes?.['include.in.token.scope'], nombre).toBe('true');
    }
  });

  it('los clientes de M5 y M9 obtienen por defecto m2-token y clientes.estado:read, y ningún otro scope de M2', () => {
    for (const id of CLIENTES_M5_M9) {
      expect(cliente(id)?.defaultClientScopes, id).toEqual(expect.arrayContaining(['m2-token', 'clientes.estado:read']));
      expect(scopesDe(cliente(id)).filter((s) => esDeM2(s)), id).toEqual(['clientes.estado:read']);
    }
  });

  it('las cuentas de servicio de M5 y M9 tienen el rol SERVICIO, además del suyo, y ningún rol de persona', () => {
    for (const id of CLIENTES_M5_M9) {
      const roles = cuentaDeServicio(id)?.realmRoles ?? [];
      expect(roles, id).toContain('SERVICIO');
      expect(roles.filter((r) => ['CLIENTE', 'OPERADOR', 'CONDUCTOR'].includes(r)), id).toEqual([]);
    }
  });

  it('entre los grupo-NN, solo los de M5 y M9 obtienen la audiencia, los roles o algún scope de M2', () => {
    const conAlgo = GRUPOS.filter((id) => scopesDe(cliente(id)).some((s) => s === 'm2-token' || esDeM2(s)));
    expect(conAlgo.sort()).toEqual([...CLIENTES_M5_M9].sort());
    const conServicio = GRUPOS.filter((id) => cuentaDeServicio(id)?.realmRoles?.includes('SERVICIO'));
    expect(conServicio.sort()).toEqual([...CLIENTES_M5_M9].sort());
  });
});

describe('realm de desarrollo: cliente de desarrollo y usuarios de ejemplo (RNF-12.17, RNF-06.8)', () => {
  it('m2-desarrollo es público y solo sirve para pedir tokens con usuario y contraseña', () => {
    const c = cliente(CLIENTE_DE_DESARROLLO);
    expect(c).toBeDefined();
    expect(c?.publicClient).toBe(true);
    expect(c?.secret).toBeUndefined();
    expect(c?.directAccessGrantsEnabled).toBe(true);
    expect(c?.standardFlowEnabled).toBe(false);
    expect(c?.implicitFlowEnabled ?? false).toBe(false);
    expect(c?.serviceAccountsEnabled ?? false).toBe(false);
    expect(cuentaDeServicio(CLIENTE_DE_DESARROLLO)).toBeUndefined();
  });

  // El realm de la cátedra declara sus propios client scopes, así que Keycloak no crea los que trae por defecto: sin `basic`, un
  // token de usuario sale sin `sub` y M2 lo rechaza (comprobado en T13). Las cuentas de servicio tienen `sub` igual.
  it('el scope basic pone el sub en el token de acceso, fuera del campo scope, y m2-desarrollo lo trae por defecto', () => {
    const basic = scope('basic');
    expect(basic?.attributes?.['include.in.token.scope']).toBe('false');
    const sub = basic?.protocolMappers?.filter((m) => m.protocolMapper === 'oidc-sub-mapper') ?? [];
    expect(sub).toHaveLength(1);
    expect(sub[0]?.config).toMatchObject({ 'access.token.claim': 'true' });
    expect(cliente(CLIENTE_DE_DESARROLLO)?.defaultClientScopes).toContain('basic');
  });

  // Sin pedirlos, el token trae `scope: ""`: así se prueba el 403 de scope (T18).
  it('m2-desarrollo trae m2-token por defecto y los scopes de M2 solo como opcionales', () => {
    const c = cliente(CLIENTE_DE_DESARROLLO);
    expect(c?.defaultClientScopes).toContain('m2-token');
    expect((c?.defaultClientScopes ?? []).filter((s) => esDeM2(s) || scope(s)?.attributes?.['include.in.token.scope'] !== 'false')).toEqual([]);
    expect((c?.optionalClientScopes ?? []).filter((s) => esDeM2(s)).sort()).toEqual([...SCOPES_DE_M2].sort());
  });

  it('cada usuario de ejemplo existe con su id fijo, un UUID distinto de los demás', () => {
    for (const { usuario: nombre, id } of USUARIOS_DE_EJEMPLO) {
      expect(usuario(nombre)?.id, nombre).toBe(id);
      expect(id, nombre).toMatch(UUID);
    }
    const ids = (realm.users ?? []).map((u) => u.id).filter(Boolean);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it('hay al menos un usuario por rol de persona, y cada uno tiene solo su rol', () => {
    for (const rol of ['CLIENTE', 'OPERADOR', 'CONDUCTOR']) expect(USUARIOS_DE_EJEMPLO.some((u) => u.rol === rol), rol).toBe(true);
    expect(USUARIOS_DE_EJEMPLO.filter((u) => u.rol === 'CLIENTE').length).toBeGreaterThanOrEqual(2);
    for (const { usuario: nombre, rol } of USUARIOS_DE_EJEMPLO) expect(usuario(nombre)?.realmRoles, nombre).toEqual([rol]);
  });

  // Sin estos datos, el perfil de usuario de Keycloak 26 pide completarlos y el token con usuario y contraseña no sale.
  it('cada usuario de ejemplo está listo para entrar: habilitado, con correo verificado, nombre y sin acciones pendientes', () => {
    for (const { usuario: nombre } of USUARIOS_DE_EJEMPLO) {
      const u = usuario(nombre);
      expect(u?.enabled, nombre).toBe(true);
      expect(u?.emailVerified, nombre).toBe(true);
      expect(u?.email, nombre).toMatch(/^[a-z0-9]+@ejemplo\.test$/);
      expect(u?.firstName, nombre).toBeTruthy();
      expect(u?.lastName, nombre).toBeTruthy();
      expect(u?.requiredActions ?? [], nombre).toEqual([]);
      expect(u?.serviceAccountClientId, nombre).toBeUndefined();
    }
  });

  it('cada usuario de ejemplo tiene una contraseña de desarrollo, no temporal, la misma que usan las pruebas', () => {
    for (const { usuario: nombre, contrasena } of USUARIOS_DE_EJEMPLO) {
      expect(usuario(nombre)?.credentials, nombre).toEqual([{ type: 'password', value: contrasena, temporary: false }]);
      expect(contrasena, nombre).toContain('desarrollo');
    }
  });
});

// RNF-12.20: el cliente con el que va a entrar el frontend (#83). Lo que Keycloak hace con él lo prueba pruebas/keycloak/pkce.test.ts.
describe('realm de desarrollo: cliente público del frontend con PKCE (RNF-12.20)', () => {
  const front = () => cliente(CLIENTE_DEL_FRONT);

  it('m2-front es público, sin secreto, solo con código de autorización, sin usuario y contraseña directos ni cuenta de servicio', () => {
    const c = front();
    expect(c).toBeDefined();
    expect(c?.publicClient).toBe(true);
    expect(c?.secret).toBeUndefined();
    expect(c?.standardFlowEnabled).toBe(true);
    expect(c?.directAccessGrantsEnabled).toBe(false);
    expect(c?.implicitFlowEnabled).toBe(false);
    expect(c?.serviceAccountsEnabled).toBe(false);
    expect(cuentaDeServicio(CLIENTE_DEL_FRONT)).toBeUndefined();
  });

  it('m2-front exige PKCE con S256', () => {
    expect(front()?.attributes?.['pkce.code.challenge.method']).toBe('S256');
  });

  // Un comodín suelto o un host ajeno dejaría que un sitio cualquiera reciba el código de autorización.
  it('m2-front vuelve solo a la máquina local, sin comodines sueltos, y acepta solo esos orígenes', () => {
    expect([...(front()?.redirectUris ?? [])].sort()).toEqual([...RETORNOS_DEL_FRONT].sort());
    expect([...(front()?.webOrigins ?? [])].sort()).toEqual([...ORIGENES_DEL_FRONT].sort());
    const salida = (front()?.attributes?.['post.logout.redirect.uris'] ?? '').split('##');
    expect([...salida].sort()).toEqual([...RETORNOS_DEL_FRONT].sort());
    for (const uri of [...(front()?.redirectUris ?? []), ...salida]) {
      expect(uri, uri).not.toBe('*');
      expect(['localhost', '127.0.0.1'], uri).toContain(new URL(uri.replace(/\*$/, '')).hostname);
    }
  });

  it('m2-front trae m2-token y basic por defecto, y los scopes de M2 solo como opcionales', () => {
    const c = front();
    expect(c?.defaultClientScopes).toEqual(expect.arrayContaining(['m2-token', 'basic']));
    expect((c?.defaultClientScopes ?? []).filter((s) => esDeM2(s) || scope(s)?.attributes?.['include.in.token.scope'] !== 'false')).toEqual([]);
    expect((c?.optionalClientScopes ?? []).filter((s) => esDeM2(s)).sort()).toEqual([...SCOPES_DE_M2].sort());
  });
});

// Un scope que pide el contrato y el realm no tiene daría 403 en todos los tokens: un tipeo como `cleintes` tiene que dar rojo acá.
describe('realm de desarrollo y contrato (RNF-12.17, RNF-12.13)', () => {
  const nombres = (realm.clientScopes ?? []).map((s) => s.name);

  it('todo scope que declara contrato/openapi.yml existe en el realm', () => {
    expect(scopesDelContrato(cargarContrato()).filter((s) => !nombres.includes(s))).toEqual([]);
  });

  it('la búsqueda de scopes del contrato encuentra los de flujos, los de security global y por operación, y no los roles', () => {
    const contrato: Contrato = {
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
          keycloak: { type: 'oauth2', flows: { clientCredentials: { tokenUrl: 'http://x/token', scopes: { 'clientes:read': '' } } } },
          oidc: { type: 'openIdConnect' },
        },
      },
      security: [{ keycloak: ['global:read'] }],
      paths: {
        '/a': {
          get: { security: [{ bearerAuth: ['CLIENTE'], keycloak: ['cleintes:read'] }] },
          post: { security: [{ bearerAuth: ['OPERADOR'], oidc: ['clientes.estado:read'] }] },
          parameters: [],
        },
      },
    };
    expect(scopesDelContrato(contrato)).toEqual(['cleintes:read', 'clientes.estado:read', 'clientes:read', 'global:read']);
    expect(scopesDelContrato(contrato).filter((s) => !nombres.includes(s))).toEqual(['cleintes:read', 'global:read']);
  });
});
