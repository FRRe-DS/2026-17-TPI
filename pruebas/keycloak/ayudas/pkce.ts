import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { CLIENTE_DEL_FRONT } from '../../ayudas/realm.js';
import { URL_REALM, URL_TOKEN } from './entorno.js';
import { usuarioDeEjemplo } from './pedir.js';

// El flujo de código de autorización con PKCE de `m2-front` (RNF-12.20), sin navegador: pedir la página de inicio de sesión,
// mandar el formulario con la cookie de sesión de Keycloak, leer el `code` de la redirección y canjearlo. La dirección de retorno
// es la del panel; nadie la atiende, porque la redirección no se sigue.
export const URL_AUTORIZACION = `${URL_REALM}/protocol/openid-connect/auth`;
export const RETORNO = 'http://localhost:8083/callback';
const CORTE_MS = 10_000;

export function parPkce(): { verificador: string; desafio: string } {
  const verificador = randomBytes(32).toString('base64url');
  return { verificador, desafio: createHash('sha256').update(verificador).digest('base64url') };
}

type Autorizacion = { scope?: string; desafio?: string; metodo?: string; retorno?: string };

// El pedido a /auth, sin seguir redirecciones: Keycloak contesta con la página de inicio de sesión o redirige con un error.
export function pedirAutorizacion({ scope = 'openid', desafio, metodo = 'S256', retorno = RETORNO }: Autorizacion): Promise<Response> {
  const parametros = new URLSearchParams({ client_id: CLIENTE_DEL_FRONT, response_type: 'code', redirect_uri: retorno, scope, state: randomUUID() });
  if (desafio !== undefined) {
    parametros.set('code_challenge', desafio);
    parametros.set('code_challenge_method', metodo);
  }
  return fetch(`${URL_AUTORIZACION}?${parametros}`, { redirect: 'manual', signal: AbortSignal.timeout(CORTE_MS) });
}

const cookiesDe = (respuesta: Response) =>
  respuesta.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');

// Inicia sesión como `nombre` y devuelve el `code` de la redirección a RETORNO.
export async function codigoDeAutorizacion(nombre: string, scopes: readonly string[], desafio: string): Promise<string> {
  const { usuario, contrasena } = usuarioDeEjemplo(nombre);
  const pagina = await pedirAutorizacion({ scope: ['openid', ...scopes].join(' '), desafio });
  const html = await pagina.text();
  if (pagina.status !== 200) throw new Error(`Keycloak no mostró el inicio de sesión: HTTP ${pagina.status}`);
  const accion = /action="([^"]+)"/.exec(html)?.[1]?.replaceAll('&amp;', '&');
  if (accion === undefined) throw new Error('La página de inicio de sesión no tiene un formulario.');
  const ingreso = await fetch(accion, {
    method: 'POST',
    headers: { cookie: cookiesDe(pagina) },
    body: new URLSearchParams({ username: usuario, password: contrasena }),
    redirect: 'manual',
    signal: AbortSignal.timeout(CORTE_MS),
  });
  const destino = ingreso.headers.get('location') ?? '';
  const codigo = destino.startsWith(RETORNO) ? new URL(destino).searchParams.get('code') : null;
  if (ingreso.status !== 302 || codigo === null) throw new Error(`El inicio de sesión de ${nombre} no redirigió con un código: HTTP ${ingreso.status}`);
  return codigo;
}

export type RespuestaDeTokens = { estado: number; cuerpo: { access_token?: string; id_token?: string; error?: string; error_description?: string } };

// El canje del código por tokens; sin `verificador`, el pedido sale sin `code_verifier`.
export async function canjear(codigo: string, verificador: string | undefined): Promise<RespuestaDeTokens> {
  const campos: Record<string, string> = { grant_type: 'authorization_code', client_id: CLIENTE_DEL_FRONT, code: codigo, redirect_uri: RETORNO };
  if (verificador !== undefined) campos['code_verifier'] = verificador;
  return pedirAlEndpointDeTokens(campos);
}

export async function pedirAlEndpointDeTokens(campos: Record<string, string>): Promise<RespuestaDeTokens> {
  const respuesta = await fetch(URL_TOKEN, { method: 'POST', body: new URLSearchParams(campos), signal: AbortSignal.timeout(CORTE_MS) });
  return { estado: respuesta.status, cuerpo: (await respuesta.json()) as RespuestaDeTokens['cuerpo'] };
}
