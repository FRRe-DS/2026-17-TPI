import { createLocalJWKSet, errors, type JSONWebKeySet, type JWTVerifyGetKey } from 'jose';
import { setTimeout as esperar } from 'node:timers/promises';
import type { ConfigPanelOidc } from '../config.js';
import type { DatosSesion } from './sesiones.js';
import { crearValidadorTokens, CredencialInvalida, IdentidadNoDisponible } from './validacion.js';

export class SesionRechazada extends Error {
  constructor() { super('La sesión ya no es válida'); this.name = 'SesionRechazada'; }
}
export async function comprobarDisponibilidad(config: ConfigPanelOidc, pedir: typeof fetch = fetch): Promise<void> {
  try {
    const respuesta = await pedir(`${config.oidcUrlInterna}/.well-known/openid-configuration`, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(config.tiempoIdentidadMs),
    });
    // Solo interesa disponibilidad; no se conserva ni procesa el documento remoto.
    await respuesta.body?.cancel();
    if (!respuesta.ok) throw new IdentidadNoDisponible();
  } catch { throw new IdentidadNoDisponible(); }
}

export function crearClienteOidc(config: ConfigPanelOidc, pedir: typeof fetch = fetch, ahora = Date.now) {
  let local: ReturnType<typeof createLocalJWKSet> | undefined;
  let cargadoEn = 0;
  let pendiente: Promise<void> | undefined;
  async function json(ruta: string, opciones: RequestInit): Promise<{ estado: number; datos: Record<string, unknown> }> {
    try {
      const respuesta = await pedir(`${config.oidcUrlInterna}/protocol/openid-connect/${ruta}`, {
        ...opciones, redirect: 'error', signal: AbortSignal.timeout(config.tiempoIdentidadMs),
      });
      // El plazo incluye todo el cuerpo. Se limita también memoria ante un proveedor defectuoso.
      const lector = respuesta.body?.getReader(); const partes: Uint8Array[] = []; let longitud = 0;
      if (lector) {
        try {
          for (;;) {
            const parte = await lector.read(); if (parte.done) break;
            longitud += parte.value.length;
            if (longitud > 1024 * 1024) throw new IdentidadNoDisponible();
            partes.push(parte.value);
          }
        } finally { await lector.cancel(); }
      }
      const datos: unknown = JSON.parse(Buffer.concat(partes).toString());
      if (!datos || typeof datos !== 'object' || Array.isArray(datos)) throw new IdentidadNoDisponible();
      return { estado: respuesta.status, datos: datos as Record<string, unknown> };
    } catch { throw new IdentidadNoDisponible(); }
  }
  async function cargar() {
    if (!pendiente) pendiente = (async () => {
      for (let intento = 0; intento < 2; intento++) {
        try {
          const respuesta = await json('certs', { method: 'GET' });
          if (respuesta.estado !== 200) throw new IdentidadNoDisponible();
          const nuevo = createLocalJWKSet(respuesta.datos as unknown as JSONWebKeySet);
          local = nuevo; cargadoEn = ahora(); return;
        } catch { if (intento === 1) throw new IdentidadNoDisponible(); await esperar(200); }
      }
    })().finally(() => { pendiente = undefined; });
    await pendiente;
  }
  const claves: JWTVerifyGetKey = async (cabecera, token) => {
    if (!local || ahora() - cargadoEn >= 300_000) await cargar();
    try { return await local!(cabecera, token); }
    catch (error) {
      if (!(error instanceof errors.JWKSNoMatchingKey) || ahora() - cargadoEn < 30_000) throw error;
      await cargar(); return local!(cabecera, token);
    }
  };
  const validar = crearValidadorTokens(config, claves, ahora);
  async function intercambiar(parametros: Record<string, string>, identidad: { nonce: string } | { sub: string }): Promise<DatosSesion> {
    const { estado, datos } = await json('token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.oidcCliente, ...parametros }) });
    if (estado === 400 && datos.error === 'invalid_grant') throw new SesionRechazada();
    if (estado !== 200) throw new IdentidadNoDisponible();
    if (datos.token_type !== 'Bearer' || typeof datos.access_token !== 'string' || typeof datos.refresh_token !== 'string'
      || !datos.refresh_token || typeof datos.refresh_expires_in !== 'number' || !Number.isSafeInteger(datos.refresh_expires_in)
      || datos.refresh_expires_in <= 0) throw new CredencialInvalida();
    const acceso = 'nonce' in identidad
      ? await validar.validarPar({ idToken: datos.id_token as string, accessToken: datos.access_token }, identidad.nonce)
      : await validar.validarAccessToken(datos.access_token, identidad.sub);
    const refreshTokenVenceEn = ahora() + datos.refresh_expires_in * 1000;
    if (!Number.isSafeInteger(refreshTokenVenceEn)) throw new CredencialInvalida();
    return { sub: acceso.sub, roles: acceso.roles, scopes: acceso.scopes, credenciales: {
      accessToken: datos.access_token, refreshToken: datos.refresh_token,
      accessTokenVenceEn: acceso.venceEn, refreshTokenVenceEn,
    } };
  }
  return {
    ingresar: (code: string, verifier: string, nonce: string) => intercambiar({ grant_type: 'authorization_code', code,
      code_verifier: verifier, redirect_uri: config.urlRetorno }, { nonce }),
    renovar: (refreshToken: string, sub: string) => intercambiar({ grant_type: 'refresh_token', refresh_token: refreshToken }, { sub }),
  };
}
export type ClienteOidc = ReturnType<typeof crearClienteOidc>;
