import { errors, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import type { ConfigTokens } from '../config.js';
import { NoAutenticado } from '../errores.js';

// Los roles que reconoce el servicio, escritos exactamente así: los demás se ignoran (RNF-12.3).
export const ROLES_CONOCIDOS = ['CLIENTE', 'CONDUCTOR', 'OPERADOR', 'SERVICIO'] as const;
export type Rol = (typeof ROLES_CONOCIDOS)[number];

// Quién llama, según su token: el `sub` y sus roles conocidos (RNF-12.4).
export type Identidad = { sub: string; roles: Rol[] };

export type DatosToken = { sub: string; roles: readonly string[]; venceEnSegundos?: number };

// Segundos de diferencia que se perdonan entre el reloj de quien firma y el de este servicio, en exp y nbf (RNF-12.2).
const TOLERANCIA_RELOJ_SEGUNDOS = 30;

// `Bearer <token>`. El esquema no distingue mayúsculas (RFC 9110) y puede ir seguido de más de un espacio.
const ESQUEMA_BEARER = /^Bearer +(\S+)$/i;

const MAL_FORMADO = 'El token está mal formado';
const SUB_INVALIDO = 'El sub del token falta, está vacío o no es texto';
const NO_VALIDO = 'El token no es válido';

// La clave de la firma: el texto de la configuración en UTF-8, como lo hace cualquier biblioteca de JWT con un secreto.
const claveDe = (config: ConfigTokens): Uint8Array => new TextEncoder().encode(config.claveTokens);

const esRolConocido = (rol: string): rol is Rol => (ROLES_CONOCIDOS as readonly string[]).includes(rol);

// El motivo de un claim que jose rechazó. `invalid` es un exp, nbf o iat que no es un número.
function motivoDelClaim({ claim, reason }: errors.JWTClaimValidationFailed): string {
  if (reason === 'invalid') return MAL_FORMADO;
  switch (claim) {
    case 'exp':
      return 'El token no tiene fecha de vencimiento (exp)';
    case 'nbf':
      return 'El token todavía no es válido (nbf)';
    case 'sub':
      return SUB_INVALIDO;
    case 'iss':
      return 'El emisor del token no es el esperado';
    case 'aud':
      return 'La audiencia del token no es la esperada';
    default:
      return NO_VALIDO;
  }
}

// El motivo del 401 según el error de jose (plan, Lógica 3). Dice qué falló y nunca repite nada de lo que traía el token.
function motivoDe(error: errors.JOSEError): string {
  if (error instanceof errors.JWTExpired) return 'El token venció';
  if (error instanceof errors.JWTClaimValidationFailed) return motivoDelClaim(error);
  if (error instanceof errors.JOSEAlgNotAllowed || error instanceof errors.JWSSignatureVerificationFailed) {
    return 'El token no está firmado con HS256 y la clave del servicio';
  }
  if (error instanceof errors.JWSInvalid || error instanceof errors.JWTInvalid) return MAL_FORMADO;
  return NO_VALIDO;
}

// Comprueba la firma, el emisor, la audiencia y las fechas. jose controla la firma antes que los claims, así que un token
// falso no revela qué más tenía mal. Un error que no es de jose (una clave que no sirve) no es culpa del token: sigue su
// camino y da 500.
async function validar(token: string, config: ConfigTokens): Promise<JWTPayload> {
  try {
    const { payload } = await jwtVerify(token, claveDe(config), {
      algorithms: ['HS256'],
      issuer: config.emisorTokens,
      audience: config.audienciaTokens,
      clockTolerance: TOLERANCIA_RELOJ_SEGUNDOS,
      requiredClaims: ['exp', 'sub'],
    });
    return payload;
  } catch (error) {
    throw error instanceof errors.JOSEError ? new NoAutenticado(motivoDe(error)) : error;
  }
}

// Si el campo de roles existe tiene que ser una lista de textos; de ella quedan solo los roles conocidos. `hasOwn` y no `in`:
// un campo configurado como `toString` no es un campo que el token trae.
function rolesConocidos(payload: JWTPayload, campo: string): Rol[] {
  if (!Object.hasOwn(payload, campo)) return [];
  const roles = payload[campo];
  if (!Array.isArray(roles) || !roles.every((rol) => typeof rol === 'string')) {
    throw new NoAutenticado('El campo de roles del token no es una lista de textos');
  }
  return roles.filter(esRolConocido);
}

// Valida el encabezado `Authorization: Bearer <token>` y dice quién llama (RNF-12.2, RNF-12.4). Si el token no sirve lanza
// `NoAutenticado` (401) con el motivo, que no repite el token.
export async function verificarToken(encabezado: string | undefined, config: ConfigTokens): Promise<Identidad> {
  const token = typeof encabezado === 'string' ? ESQUEMA_BEARER.exec(encabezado)?.[1] : undefined;
  if (token === undefined) throw new NoAutenticado('Falta el token');

  const payload = await validar(token, config);

  // jose solo exige que el sub exista: que sea un texto con algo escrito se controla acá.
  const { sub } = payload;
  if (typeof sub !== 'string' || sub.trim() === '') throw new NoAutenticado(SUB_INVALIDO);

  return { sub, roles: rolesConocidos(payload, config.campoRoles) };
}

// Firma un token HS256 con la clave, el emisor y la audiencia configurados (RNF-12.5). Hace de M1 en desarrollo y en las
// pruebas, así que no valida el `sub` ni los roles: firma lo que se le pide, también lo que `verificarToken` rechazaría.
export async function generarToken(
  { sub, roles, venceEnSegundos = 3600 }: DatosToken,
  config: ConfigTokens,
): Promise<string> {
  const emitidoEn = Math.floor(Date.now() / 1000);
  return new SignJWT({ [config.campoRoles]: roles })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(config.emisorTokens)
    .setAudience(config.audienciaTokens)
    .setSubject(sub)
    .setIssuedAt(emitidoEn)
    .setExpirationTime(emitidoEn + venceEnSegundos)
    .sign(claveDe(config));
}
