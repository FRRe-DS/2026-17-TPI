import { createHash, timingSafeEqual } from 'node:crypto';
import { errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { ConfigPanelOidc } from '../config.js';

export class CredencialInvalida extends Error {
  constructor() {
    super('La credencial de identidad no es válida');
    this.name = 'CredencialInvalida';
  }
}

export class IdentidadNoDisponible extends Error {
  constructor() {
    super('No se pudo verificar la identidad');
    this.name = 'IdentidadNoDisponible';
  }
}

interface IdentidadValidada {
  sub: string;
  emitidoEn: number;
  venceEn: number;
  atHash?: string;
}

interface AccesoValidado {
  sub: string;
  emitidoEn: number;
  venceEn: number;
  roles: string[];
  scopes: string[];
}

const ROLES = new Set(['CLIENTE', 'CONDUCTOR', 'OPERADOR', 'SERVICIO']);

function exigir(condicion: unknown): asserts condicion {
  if (!condicion) throw new CredencialInvalida();
}

function iguales(a: string, b: string): boolean {
  const primero = Buffer.from(a);
  const segundo = Buffer.from(b);
  return primero.length === segundo.length && timingSafeEqual(primero, segundo);
}

function fechaValida(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isSafeInteger(valor) && Number.isSafeInteger(valor * 1000);
}

/** Verifica credenciales en el servidor; el proveedor de claves se conecta en el cliente OIDC. */
export function crearValidadorTokens(
  config: Pick<ConfigPanelOidc, 'oidcEmisor' | 'oidcCliente'>,
  claves: JWTVerifyGetKey,
  ahora: () => number = Date.now,
) {
  async function verificar(credencial: string, tipo: 'id' | 'access'): Promise<JWTPayload> {
    exigir(typeof credencial === 'string' && credencial.length > 0);
    const instante = ahora();
    let resultado;
    try {
      resultado = await jwtVerify(credencial, claves, {
        algorithms: ['RS256'],
        issuer: config.oidcEmisor,
        audience: tipo === 'id' ? config.oidcCliente : 'm2-clientes',
        requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat'],
        currentDate: new Date(instante),
        clockTolerance: 0,
      });
    } catch (error) {
      // No se adjuntan causas: pueden contener credenciales o respuestas del proveedor.
      if (error instanceof errors.JWTExpired || error instanceof errors.JWTClaimValidationFailed
        || error instanceof errors.JOSEAlgNotAllowed || error instanceof errors.JWSInvalid
        || error instanceof errors.JWTInvalid || error instanceof errors.JWSSignatureVerificationFailed
        || error instanceof errors.JWKSNoMatchingKey || error instanceof errors.JWKSMultipleMatchingKeys
        || error instanceof errors.JOSENotSupported) throw new CredencialInvalida();
      throw new IdentidadNoDisponible();
    }
    const { payload, protectedHeader } = resultado;
    exigir(protectedHeader.typ === undefined || (typeof protectedHeader.typ === 'string'
      && ['jwt', 'application/jwt'].includes(protectedHeader.typ.toLowerCase())));
    exigir(typeof payload.sub === 'string' && payload.sub.trim().length > 0);
    exigir(fechaValida(payload.exp) && fechaValida(payload.iat));
    exigir(payload.iat <= Math.floor(instante / 1000) && payload.exp > payload.iat);
    exigir(payload.azp === undefined || payload.azp === config.oidcCliente);
    if (tipo === 'id') {
      exigir(payload.typ === undefined || payload.typ === 'ID');
      const audiencias = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      exigir(audiencias.every((audiencia) => audiencia === config.oidcCliente));
    } else {
      exigir(payload.typ === 'Bearer');
    }
    return payload;
  }

  async function validarIdToken(credencial: string, nonceEsperado: string): Promise<IdentidadValidada> {
    const payload = await verificar(credencial, 'id');
    exigir(typeof nonceEsperado === 'string' && nonceEsperado.length > 0);
    exigir(typeof payload.nonce === 'string' && iguales(payload.nonce, nonceEsperado));
    exigir(payload.at_hash === undefined || (typeof payload.at_hash === 'string'
      && /^[A-Za-z0-9_-]{22}$/.test(payload.at_hash)));
    return {
      sub: payload.sub!, emitidoEn: payload.iat! * 1000, venceEn: payload.exp! * 1000,
      ...(payload.at_hash === undefined ? {} : { atHash: payload.at_hash as string }),
    };
  }

  async function validarAccessToken(credencial: string, subEsperado: string): Promise<AccesoValidado> {
    const payload = await verificar(credencial, 'access');
    exigir(typeof subEsperado === 'string' && subEsperado.trim().length > 0 && payload.sub === subEsperado);
    const roles = payload.roles;
    exigir(roles === undefined || (Array.isArray(roles) && roles.every((rol) => typeof rol === 'string')));
    exigir(payload.scope === undefined || typeof payload.scope === 'string');
    return {
      sub: payload.sub!, emitidoEn: payload.iat! * 1000, venceEn: payload.exp! * 1000,
      roles: [...new Set((roles as string[] | undefined)?.filter((rol) => ROLES.has(rol)) ?? [])],
      scopes: [...new Set((payload.scope as string | undefined)?.split(' ').filter(Boolean) ?? [])],
    };
  }

  async function validarPar(tokens: { idToken: string; accessToken: string }, nonceEsperado: string): Promise<AccesoValidado> {
    const identidad = await validarIdToken(tokens.idToken, nonceEsperado);
    const acceso = await validarAccessToken(tokens.accessToken, identidad.sub);
    if (identidad.atHash !== undefined) {
      const calculado = createHash('sha256').update(tokens.accessToken, 'ascii').digest().subarray(0, 16).toString('base64url');
      exigir(iguales(identidad.atHash, calculado));
    }
    return acceso;
  }

  return { validarIdToken, validarAccessToken, validarPar };
}
