import { readFileSync } from 'node:fs';
import { CLIENTE_DE_DESARROLLO, USUARIOS_DE_EJEMPLO, type UsuarioDeEjemplo } from '../../ayudas/realm.js';
import { compose, URL_M2, URL_TOKEN } from './entorno.js';

// Los pedidos de la prueba con Keycloak real: a Keycloak, por tokens, y a M2, con ellos. Corte de 10 s en cada uno.
const CORTE_MS = 10_000;

export type Respuesta = { estado: number; encabezados: Headers; texto: string; cuerpo: unknown };
type Pedido = { cuerpo?: unknown; encabezados?: Record<string, string> };

async function leer(respuesta: Response): Promise<Respuesta> {
  const texto = await respuesta.text();
  let cuerpo: unknown;
  try {
    cuerpo = texto === '' ? undefined : JSON.parse(texto);
  } catch {
    cuerpo = undefined;
  }
  return { estado: respuesta.status, encabezados: respuesta.headers, texto, cuerpo };
}

export async function pedirM2(token: string | undefined, metodo: string, ruta: string, pedido: Pedido = {}): Promise<Respuesta> {
  const encabezados: Record<string, string> = { ...pedido.encabezados };
  if (token !== undefined) encabezados['authorization'] = `Bearer ${token}`;
  if (pedido.cuerpo !== undefined) encabezados['content-type'] = 'application/json';
  const respuesta = await fetch(`${URL_M2}${ruta}`, {
    method: metodo,
    headers: encabezados,
    body: pedido.cuerpo === undefined ? undefined : JSON.stringify(pedido.cuerpo),
    signal: AbortSignal.timeout(CORTE_MS),
  });
  return leer(respuesta);
}

type Tokens = { access_token?: string; id_token?: string; error?: string; error_description?: string };

// Un pedido al endpoint de tokens de Keycloak. Si no da un token, el error dice qué contestó Keycloak (nunca la contraseña).
async function pedirTokens(campos: Record<string, string>, quien: string): Promise<Required<Pick<Tokens, 'access_token'>> & Tokens> {
  const respuesta = await leer(
    await fetch(URL_TOKEN, { method: 'POST', body: new URLSearchParams(campos), signal: AbortSignal.timeout(CORTE_MS) }),
  );
  const tokens = (respuesta.cuerpo ?? {}) as Tokens;
  if (respuesta.estado !== 200 || typeof tokens.access_token !== 'string') {
    throw new Error(`Keycloak no dio un token para ${quien}: HTTP ${respuesta.estado} ${tokens.error ?? ''} ${tokens.error_description ?? ''}`.trim());
  }
  return { ...tokens, access_token: tokens.access_token };
}

export function usuarioDeEjemplo(nombre: string): UsuarioDeEjemplo {
  const usuario = USUARIOS_DE_EJEMPLO.find((u) => u.usuario === nombre);
  if (!usuario) throw new Error(`No hay un usuario de ejemplo «${nombre}» en pruebas/ayudas/realm.ts.`);
  return usuario;
}

// El token de acceso de una persona, pedido con usuario y contraseña a `m2-desarrollo`, con los scopes que se pidan.
export async function tokenDePersona(nombre: string, scopes: readonly string[]): Promise<string> {
  const { usuario, contrasena } = usuarioDeEjemplo(nombre);
  const campos: Record<string, string> = { grant_type: 'password', client_id: CLIENTE_DE_DESARROLLO, username: usuario, password: contrasena };
  if (scopes.length > 0) campos['scope'] = scopes.join(' ');
  return (await pedirTokens(campos, nombre)).access_token;
}

// El ID token de una persona: se firma con la misma clave que el de acceso, pero su audiencia es el cliente, no M2.
export async function idTokenDePersona(nombre: string): Promise<string> {
  const { usuario, contrasena } = usuarioDeEjemplo(nombre);
  const tokens = await pedirTokens(
    { grant_type: 'password', client_id: CLIENTE_DE_DESARROLLO, username: usuario, password: contrasena, scope: 'openid' },
    `${nombre} (ID token)`,
  );
  if (typeof tokens.id_token !== 'string') throw new Error(`Keycloak no dio un ID token para ${nombre}.`);
  return tokens.id_token;
}

type ClienteDelRealm = { clientId: string; secret?: string };
const clientes = (
  JSON.parse(readFileSync(new URL('../../../keycloak/ds-2026-realm-realm.json', import.meta.url), 'utf8')) as { clients: ClienteDelRealm[] }
).clients;

// El token de la cuenta de servicio de un cliente grupo-NN, con el secreto del realm de desarrollo.
export async function tokenDeServicio(clientId: string): Promise<string> {
  const secreto = clientes.find((c) => c.clientId === clientId)?.secret;
  if (secreto === undefined) throw new Error(`El realm no tiene un cliente «${clientId}» con secreto.`);
  return (await pedirTokens({ grant_type: 'client_credentials', client_id: clientId, client_secret: secreto }, clientId)).access_token;
}

// Lo que dice un token, sin comprobar la firma: solo para mirar qué emitió Keycloak.
export function claimsDe(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
}

// Un token HS256 del comando de tokens de M2, firmado dentro del contenedor con la configuración que tiene M2: la clave de
// desarrollo, el emisor de Keycloak y la audiencia de M2. En modo jwks no tiene que pasar (RNF-12.11).
export async function tokenDelComandoDeM2(sub: string, roles: string[]): Promise<string> {
  const salida = await compose(['exec', '-T', 'm2', 'node', 'dist/herramientas/token.js', '--sub', sub, '--roles', roles.join(',')], {
    tiempoMs: 30_000,
  });
  return salida.trim();
}
