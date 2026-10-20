import { createHmac } from 'node:crypto';
import type { ConfigTokens } from '../../src/config.js';

// La configuración de tokens de las pruebas. `CONFIG` (ayudas/app.ts) la usa para el servicio, así que un token armado con
// ella lo acepta.
export const CONFIG_TOKENS: ConfigTokens = {
  claveTokens: 'clave-de-prueba-de-32-caracteres!',
  emisorTokens: 'pruebas',
  audienciaTokens: 'm2',
  campoRoles: 'roles',
};

export const SUB_DE_PRUEBA = '00000000-0000-4000-8000-000000000001';

const HASH = { HS256: 'sha256', HS384: 'sha384', HS512: 'sha512' } as const;

export const base64url = (texto: string): string => Buffer.from(texto).toString('base64url');

// Un objeto JSON en base64url: la forma en que viajan la cabecera y el cuerpo de un token. Lo que vale `undefined` no va.
export const codificar = (valor: unknown): string => base64url(JSON.stringify(valor));

// La firma HMAC de `texto` (cabecera.cuerpo) con la clave como texto UTF-8, como la calcula cualquier biblioteca de JWT.
export const firmar = (texto: string, clave: string, alg: keyof typeof HASH = 'HS256'): string =>
  createHmac(HASH[alg], clave).update(texto).digest('base64url');

export type OpcionesToken = {
  // Clave, emisor, audiencia y campo de roles. Por defecto, CONFIG_TOKENS.
  config?: ConfigTokens;
  // Con qué se firma, si no es la clave de `config`.
  clave?: string;
  // HS256 por defecto. HS384 y HS512 se firman con su hash. `none` arma un token sin firma: termina en un punto.
  alg?: keyof typeof HASH | 'none';
  // Se suma a la cabecera `{ alg, typ: 'JWT' }`. Un campo con `undefined` no va.
  cabecera?: Record<string, unknown>;
  // Se suma al cuerpo normal (iss, aud, sub, exp a 3600 s y roles CLIENTE). Un claim con `undefined` no va.
  claims?: Record<string, unknown>;
  // Reemplaza el cuerpo entero, para uno que no es un objeto.
  cuerpo?: unknown;
};

// Arma un token a mano, sin jose ni `generarToken`: así las pruebas no dependen del código que prueban. El token es válido
// salvo lo que se pida cambiar. Lee el reloj al armarlo, así que una prueba con reloj fijo da siempre el mismo.
export function armarToken({
  config = CONFIG_TOKENS,
  clave = config.claveTokens,
  alg = 'HS256',
  cabecera = {},
  claims = {},
  cuerpo,
}: OpcionesToken = {}): string {
  const normal = {
    iss: config.emisorTokens,
    aud: config.audienciaTokens,
    sub: SUB_DE_PRUEBA,
    exp: Math.floor(Date.now() / 1000) + 3600,
    [config.campoRoles]: ['CLIENTE'],
    ...claims,
  };
  const firmado = `${codificar({ alg, typ: 'JWT', ...cabecera })}.${codificar(cuerpo === undefined ? normal : cuerpo)}`;
  return alg === 'none' ? `${firmado}.` : `${firmado}.${firmar(firmado, clave, alg)}`;
}

// El encabezado `Authorization: Bearer <token>` con un token armado con `opciones`: válido, con el rol CLIENTE, salvo lo que se
// pida cambiar. Para pasar como `headers` de `inject`.
export const bearer = (opciones?: OpcionesToken): { authorization: string } => ({
  authorization: `Bearer ${armarToken(opciones)}`,
});

// Un `Authorization` con un token válido que trae los cuatro roles, para las pruebas que no son de autenticación y llaman a una
// operación protegida: pasa cualquier permiso. El token dura una hora desde que se importa el módulo.
export const AUTORIZADO = bearer({ claims: { roles: ['CLIENTE', 'CONDUCTOR', 'OPERADOR', 'SERVICIO'] } });
