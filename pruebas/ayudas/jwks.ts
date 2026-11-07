import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import type { ConfigTokens } from '../../src/config.js';
import { codificar, CONFIG_TOKENS, SUB_DE_PRUEBA } from './tokens.js';

// Claves y tokens RS256 de las pruebas del modo `jwks` (spec 080, RNF-07.12): sin Keycloak y armados a mano, sin jose, para no
// depender del código que se prueba.
export type ClaveDePrueba = { kid: string; privada: KeyObject; jwk: Record<string, unknown> };

// Un par RSA nuevo, y su parte pública como la publica Keycloak para firmar.
export function crearClave(kid = 'clave-de-firma'): ClaveDePrueba {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, privada: privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' } };
}

// Keycloak publica también una clave para cifrar, que no sirve para validar firmas.
export function crearClaveDeCifrado(kid = 'clave-de-cifrado'): Record<string, unknown> {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { ...publicKey.export({ format: 'jwk' }), kid, use: 'enc', alg: 'RSA-OAEP' };
}

export const jwksDe = (...claves: (ClaveDePrueba | Record<string, unknown>)[]) => ({
  keys: claves.map((clave) => ('jwk' in clave ? clave.jwk : clave)),
});

export type OpcionesTokenRsa = {
  // Emisor, audiencia y campo de roles. Por defecto, CONFIG_TOKENS.
  config?: ConfigTokens;
  alg?: 'RS256' | 'RS384';
  // Se suma a la cabecera `{ alg, typ: 'JWT', kid }`. Un campo con `undefined` no va.
  cabecera?: Record<string, unknown>;
  // Se suma al cuerpo normal (iss, aud, sub, exp a 3600 s y roles CLIENTE). Un claim con `undefined` no va.
  claims?: Record<string, unknown>;
};

const HASH = { RS256: 'RSA-SHA256', RS384: 'RSA-SHA384' } as const;

// Un token firmado con `clave`. Es válido salvo lo que se pida cambiar.
export function armarTokenRsa(clave: ClaveDePrueba, opciones: OpcionesTokenRsa = {}): string {
  const { config = CONFIG_TOKENS, alg = 'RS256', cabecera = {}, claims = {} } = opciones;
  const cuerpo = {
    iss: config.emisorTokens,
    aud: config.audienciaTokens,
    sub: SUB_DE_PRUEBA,
    exp: Math.floor(Date.now() / 1000) + 3600,
    [config.campoRoles]: ['CLIENTE'],
    ...claims,
  };
  const firmado = `${codificar({ alg, typ: 'JWT', kid: clave.kid, ...cabecera })}.${codificar(cuerpo)}`;
  const firma = createSign(HASH[alg]).update(firmado).sign(clave.privada).toString('base64url');
  return `${firmado}.${firma}`;
}
