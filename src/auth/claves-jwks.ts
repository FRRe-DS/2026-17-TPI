import { createRemoteJWKSet, errors, type FlattenedJWSInput, type JWSHeaderParameters } from 'jose';
import type { Config } from '../config.js';
import { ModuloNoDisponible } from '../errores.js';
import { PAUSA_REINTENTO_MS, pausar } from '../modulos/cliente.js';

export type ConfigClaves = Pick<Config, 'tiempoModulosMs' | 'reintentosModulos' | 'reintentarDespuesS'> & { urlJwks: string };

const NOMBRE = 'El servicio de identidad';

// Cada cuánto, como mucho, se vuelven a pedir las claves por un `kid` que no se tiene, contado desde la última obtención
// (RNF-12.16). Sin este tope, muchos tokens con `kid` inventados serían muchos pedidos a Keycloak.
const ESPERA_ENTRE_PEDIDOS_MS = 30_000;

// Las claves llegaron y la que pide el token no está, o no se sabe cuál es. Keycloak anduvo: es un 401 y reintentar no cambia
// nada (RNF-12.19).
const esCulpaDelToken = (error: unknown): boolean =>
  error instanceof errors.JWKSNoMatchingKey || error instanceof errors.JWKSMultipleMatchingKeys;

// Lo que falló, para el aviso del log. `fetch` dice solo «fetch failed»; el porqué (conexión rechazada, cortada) está en su causa.
function motivoDe({ cause: falla }: ModuloNoDisponible): string {
  if (!(falla instanceof Error)) return String(falla);
  return falla.cause instanceof Error ? `${falla.message}: ${falla.cause.message}` : falla.message;
}

// Las claves públicas con las que se validan los tokens en modo `jwks` (RNF-12.11). `jose` las pide a `urlJwks` con el primer
// token que las necesita y las guarda en memoria, así que no se llama a Keycloak en cada solicitud, y junta en un solo pedido
// las solicitudes que llegan mientras otro está en curso. Un `kid` que no está da `JWKSNoMatchingKey` (401, RNF-12.19), y se
// vuelve a pedir solo pasado el tope. Un pedido fallido no cuenta para ese tope: M2 se recupera en cuanto Keycloak vuelve.
export function crearClaves({ urlJwks, tiempoModulosMs, reintentosModulos, reintentarDespuesS }: ConfigClaves) {
  const jwks = createRemoteJWKSet(new URL(urlJwks), {
    timeoutDuration: tiempoModulosMs,
    cooldownDuration: ESPERA_ENTRE_PEDIDOS_MS,
    // Las claves guardadas no vencen. Con el valor por defecto, 10 minutos, se pedirían de nuevo aunque no falte ninguna y M2
    // dejaría de atender con Keycloak caído (RNF-13.11). Una clave retirada se sigue aceptando hasta que se vea un `kid` nuevo o
    // se reinicie: es el costo, anotado en la spec.
    cacheMaxAge: Infinity,
  });

  // Como con los otros módulos: 200 ms de pausa solo entre intentos y, agotados, `ModuloNoDisponible` con lo que falló en el
  // último como causa (RNF-13.10, RNF-14.8). No es un `JOSEError`, así que para el verificador no es un 401.
  async function conIntentos<T>(pedir: () => Promise<T>): Promise<T> {
    const intentos = 1 + reintentosModulos;
    let ultimaFalla: unknown;
    for (let intento = 1; intento <= intentos; intento++) {
      try {
        return await pedir();
      } catch (error) {
        if (esCulpaDelToken(error)) throw error;
        ultimaFalla = error;
        if (intento < intentos) await pausar(PAUSA_REINTENTO_MS);
      }
    }
    throw new ModuloNoDisponible(NOMBRE, { cause: ultimaFalla, reintentarDespuesS });
  }

  return {
    // La clave con la que validar un token, para `jwtVerify`.
    clave: (encabezado?: JWSHeaderParameters, token?: FlattenedJWSInput) => conIntentos(() => jwks(encabezado, token)),

    // Trae las claves antes del primer token (RNF-13.9). Nunca lanza: si no pudo, devuelve el motivo, y las claves llegarán con
    // el primer token (RNF-13.12).
    async precargar(): Promise<string | undefined> {
      try {
        await conIntentos(() => jwks.reload());
        return undefined;
      } catch (error) {
        return motivoDe(error as ModuloNoDisponible);
      }
    },
  };
}
