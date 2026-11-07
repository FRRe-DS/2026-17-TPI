import { errors, jwtVerify, SignJWT, type JWTPayload, type JWTVerifyResult } from 'jose';
import type { Config, ConfigTokens } from '../config.js';
import { NoAutenticado } from '../errores.js';
import { crearClaves } from './claves-jwks.js';

// Los roles que reconoce el servicio, escritos exactamente así: los demás se ignoran (RNF-12.3).
export const ROLES_CONOCIDOS = ['CLIENTE', 'CONDUCTOR', 'OPERADOR', 'SERVICIO'] as const;
export type Rol = (typeof ROLES_CONOCIDOS)[number];

// Quién llama, según su token: el `sub` y sus roles conocidos (RNF-12.4). `scopes` está solo en el modo `jwks`.
export type Identidad = { sub: string; roles: Rol[]; scopes?: string[] };

export type DatosToken = { sub: string; roles: readonly string[]; venceEnSegundos?: number };

// Segundos de diferencia que se perdonan entre el reloj de quien firma y el de este servicio, en exp y nbf (RNF-12.2).
const TOLERANCIA_RELOJ_SEGUNDOS = 30;

// `Bearer <token>`. El esquema no distingue mayúsculas (RFC 9110) y puede ir seguido de más de un espacio.
const ESQUEMA_BEARER = /^Bearer +(\S+)$/i;

const MAL_FORMADO = 'El token está mal formado';
const SUB_INVALIDO = 'El sub del token falta, está vacío o no es texto';
const NO_VALIDO = 'El token no es válido';
const FIRMA_HS256 = 'El token no está firmado con HS256 y la clave del servicio';
const FIRMA_RS256 = 'El token no está firmado con RS256 y una clave del servicio de identidad';
const KID_DESCONOCIDO = 'El kid del token no está entre las claves del servicio de identidad';

// La clave de la firma: el texto de la configuración en UTF-8, como lo hace cualquier biblioteca de JWT con un secreto.
const claveDe = (config: ConfigTokens): Uint8Array => new TextEncoder().encode(config.claveTokens);

export const esRolConocido = (rol: string): rol is Rol => (ROLES_CONOCIDOS as readonly string[]).includes(rol);

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

// El motivo del 401 según el error de jose (plan, Lógica 3). Dice qué falló y nunca repite nada de lo que traía el token. El de
// la firma depende del modo.
function motivoDe(error: errors.JOSEError, motivoFirma: string): string {
  if (error instanceof errors.JWTExpired) return 'El token venció';
  if (error instanceof errors.JWTClaimValidationFailed) return motivoDelClaim(error);
  if (error instanceof errors.JOSEAlgNotAllowed || error instanceof errors.JWSSignatureVerificationFailed) {
    return motivoFirma;
  }
  // Sin kid y con varias claves de firma jose tampoco sabe cuál usar: para el token es lo mismo que un kid que no está.
  if (error instanceof errors.JWKSNoMatchingKey || error instanceof errors.JWKSMultipleMatchingKeys) return KID_DESCONOCIDO;
  if (error instanceof errors.JWSInvalid || error instanceof errors.JWTInvalid) return MAL_FORMADO;
  return NO_VALIDO;
}

// El emisor, la audiencia y las fechas se controlan igual en los dos modos (RNF-12.12).
const reglasDe = (config: ConfigTokens) => ({
  issuer: config.emisorTokens,
  audience: config.audienciaTokens,
  clockTolerance: TOLERANCIA_RELOJ_SEGUNDOS,
  requiredClaims: ['exp', 'sub'],
});

// Comprueba la firma, el emisor, la audiencia y las fechas. jose controla la firma antes que los claims, así que un token
// falso no revela qué más tenía mal. Un error que no es de jose (una clave que no sirve) no es culpa del token: sigue su
// camino y da 500.
async function validar(comprobar: () => Promise<JWTVerifyResult>, motivoFirma: string): Promise<JWTPayload> {
  try {
    const { payload } = await comprobar();
    return payload;
  } catch (error) {
    throw error instanceof errors.JOSEError ? new NoAutenticado(motivoDe(error, motivoFirma)) : error;
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

// El token del encabezado `Authorization: Bearer <token>`.
function tokenDe(encabezado: string | undefined): string {
  const token = typeof encabezado === 'string' ? ESQUEMA_BEARER.exec(encabezado)?.[1] : undefined;
  if (token === undefined) throw new NoAutenticado('Falta el token');
  return token;
}

// jose solo exige que el sub exista: que sea un texto con algo escrito se controla acá.
function subDe({ sub }: JWTPayload): string {
  if (typeof sub !== 'string' || sub.trim() === '') throw new NoAutenticado(SUB_INVALIDO);
  return sub;
}

// El campo `scope` es un texto con los scopes separados por espacios (RFC 6749). Sin él, o vacío, no hay ninguno.
function scopesDe({ scope }: JWTPayload): string[] {
  if (scope === undefined) return [];
  if (typeof scope !== 'string') throw new NoAutenticado('El campo scope del token no es un texto');
  return scope.split(' ').filter((nombre) => nombre !== '');
}

// Valida el encabezado `Authorization: Bearer <token>` y dice quién llama (RNF-12.2, RNF-12.4). Si el token no sirve lanza
// `NoAutenticado` (401) con el motivo, que no repite el token.
export async function verificarToken(encabezado: string | undefined, config: ConfigTokens): Promise<Identidad> {
  const token = tokenDe(encabezado);
  const payload = await validar(
    () => jwtVerify(token, claveDe(config), { ...reglasDe(config), algorithms: ['HS256'] }),
    FIRMA_HS256,
  );
  return { sub: subDe(payload), roles: rolesConocidos(payload, config.campoRoles) };
}

export type ConfigVerificador = ConfigTokens &
  Pick<Config, 'modoTokens' | 'urlJwks' | 'tiempoModulosMs' | 'reintentosModulos' | 'reintentarDespuesS'>;

// Valida el encabezado de una solicitud según el modo configurado (RNF-06.7).
export type Verificador = { verificar: (encabezado: string | undefined) => Promise<Identidad> };

// `hs256` valida como siempre (RNF-12.15). `jwks` aplica las mismas reglas con RS256 y las claves de `urlJwks` (RNF-12.11,
// RNF-12.12). jose revisa el algoritmo antes de pedir la clave: un `none` o un HS256 dan 401 sin llamar a Keycloak, y por eso
// solo se acepta RS256, para que la clave compartida de M2 no valga como pública. Keycloak puede repetir un rol que venga del
// realm y de un cliente, y acá no cuenta dos veces. Si Keycloak no entrega las claves, `clave` lanza `ModuloNoDisponible`, que no
// es un `JOSEError`: `validar` lo deja pasar y da 503, no 401 (RNF-13.10).
export function crearVerificador(config: ConfigVerificador): Verificador {
  if (config.modoTokens === 'hs256') return { verificar: (encabezado) => verificarToken(encabezado, config) };
  if (config.urlJwks === undefined) throw new Error('El modo jwks necesita urlJwks');

  const { clave } = crearClaves({ ...config, urlJwks: config.urlJwks });
  return {
    async verificar(encabezado) {
      const token = tokenDe(encabezado);
      const payload = await validar(
        () => jwtVerify(token, clave, { ...reglasDe(config), algorithms: ['RS256'] }),
        FIRMA_RS256,
      );
      return {
        sub: subDe(payload),
        roles: [...new Set(rolesConocidos(payload, config.campoRoles))],
        scopes: scopesDe(payload),
      };
    },
  };
}

type ClaimsFirmados = { campoRoles: string; roles: readonly string[]; sub: string; audiencia: string; venceEnSegundos: number };

// La firma que comparten los tokens que genera M2: HS256 con la clave y el emisor configurados.
async function firmar(
  { campoRoles, roles, sub, audiencia, venceEnSegundos }: ClaimsFirmados,
  config: ConfigTokens,
): Promise<string> {
  const emitidoEn = Math.floor(Date.now() / 1000);
  return new SignJWT({ [campoRoles]: roles })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(config.emisorTokens)
    .setAudience(audiencia)
    .setSubject(sub)
    .setIssuedAt(emitidoEn)
    .setExpirationTime(emitidoEn + venceEnSegundos)
    .sign(claveDe(config));
}

// Firma un token HS256 con la clave, el emisor y la audiencia configurados (RNF-12.5). Hace de M1 en desarrollo y en las
// pruebas, así que no valida el `sub` ni los roles: firma lo que se le pide, también lo que `verificarToken` rechazaría.
export function generarToken(
  { sub, roles, venceEnSegundos = 3600 }: DatosToken,
  config: ConfigTokens,
): Promise<string> {
  return firmar({ campoRoles: config.campoRoles, roles, sub, audiencia: config.audienciaTokens, venceEnSegundos }, config);
}

// Quién es M2 ante los demás módulos y cuánto dura cada token que firma (RF-2.4.11, ADR 009).
const SUB_DE_SERVICIO = 'm2-clientes';
const VIDA_TOKEN_DE_SERVICIO_SEGUNDOS = 60;

// El token con el que M2 se presenta ante otro módulo: con el emisor y la clave del consorcio, `SERVICIO` como rol y la
// audiencia de ese módulo. Es de vida corta y se pide uno en cada intento, así que no se guarda (RNF-19). Los otros módulos
// leen los roles del campo `roles` del acuerdo, aunque `M2_CAMPO_ROLES` cambie el que lee M2.
export function tokenDeServicio(config: ConfigTokens & Pick<Config, 'audienciaM6'>): Promise<string> {
  return firmar(
    {
      campoRoles: 'roles',
      roles: ['SERVICIO'],
      sub: SUB_DE_SERVICIO,
      audiencia: config.audienciaM6,
      venceEnSegundos: VIDA_TOKEN_DE_SERVICIO_SEGUNDOS,
    },
    config,
  );
}
