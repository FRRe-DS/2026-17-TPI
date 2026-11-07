import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cargarContrato, type Contrato } from '../../src/contrato/cargar.js';

// El realm de desarrollo (spec 080, RNF-12.17, RNF-06.8): copia del ds-2026-realm de la cátedra con lo que M2 necesita. Se lee el
// JSON, sin Keycloak; lo que hace Keycloak con él lo comprueba la prueba con Keycloak real.

type Mapper = { name?: string; protocolMapper?: string; config?: Record<string, string> };
type Scope = { name: string; attributes?: Record<string, string>; protocolMappers?: Mapper[] };
type Cliente = {
  clientId: string;
  defaultClientScopes?: string[];
  optionalClientScopes?: string[];
};
type Usuario = { username: string; serviceAccountClientId?: string; realmRoles?: string[] };
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
const SCOPES_DE_M2 = ['clientes:read', 'clientes:write', 'clientes.estado:read'];
// M5 (Solicitud y Despacho) y M9 (Reservas) de los dos consorcios: los únicos módulos que consultan a M2 (RNF-12.17).
const CLIENTES_M5_M9 = ['grupo-04', 'grupo-13', 'grupo-08', 'grupo-09'];
const GRUPOS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '17'].map((n) => `grupo-${n}`);

const scope = (nombre: string) => realm.clientScopes?.find((s) => s.name === nombre);
const cliente = (id: string) => realm.clients?.find((c) => c.clientId === id);
const cuentaDeServicio = (id: string) => realm.users?.find((u) => u.serviceAccountClientId === id);
const scopesDe = (c: Cliente | undefined) => [...(c?.defaultClientScopes ?? []), ...(c?.optionalClientScopes ?? [])];

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
      expect(scopesDe(cliente(id)).filter((s) => SCOPES_DE_M2.includes(s)), id).toEqual(['clientes.estado:read']);
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
    const conAlgo = GRUPOS.filter((id) => scopesDe(cliente(id)).some((s) => s === 'm2-token' || SCOPES_DE_M2.includes(s)));
    expect(conAlgo.sort()).toEqual([...CLIENTES_M5_M9].sort());
    const conServicio = GRUPOS.filter((id) => cuentaDeServicio(id)?.realmRoles?.includes('SERVICIO'));
    expect(conServicio.sort()).toEqual([...CLIENTES_M5_M9].sort());
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
