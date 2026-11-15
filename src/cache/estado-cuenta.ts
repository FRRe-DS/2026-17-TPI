import type { EstadoCuenta } from '../clientes/modelo.js';
import type { Redis } from './redis.js';

// La copia del estado de cuenta en Redis (spec 107). La base sigue siendo la única fuente de verdad (RNF-05): la copia es la
// respuesta `EstadoCuenta` tal cual, con un vencimiento, y todo lo que salga mal con Redis se vuelve «no hay copia» y se sigue
// por la base (RF-2.6.8). Las claves identifican al cliente solo por su `clienteId`: ni nombre, ni motivo, ni token (RNF-19).
//
// Dos claves por cliente:
//  - `m2:estado-cuenta:v:<clienteId>`: un contador entero, la versión; ausente vale 0.
//  - `m2:estado-cuenta:c:<clienteId>:<versión>`: el JSON de `EstadoCuenta`, con vencimiento.
// Invalidar es subir la versión: la copia de la versión anterior queda sin uso y vence sola. El lector toma la versión ANTES
// de leer la base: si un bloqueo se confirma mientras tanto, escribe bajo la versión vieja, que ya nadie lee, y no puede dejar
// una copia vieja viva.
// La versión NO vence (desvío del plan, aprobado el 2026-11-15; ver guia.md, T6). Las lecturas siguen guardando copias con la
// versión vigente mucho después del último cambio; si la versión venciera, el siguiente INCR partiría de 0 y volvería a dar
// un número ya usado, y una copia de ese número todavía viva pasaría por vigente justo después de un bloqueo. Es una clave
// chica por cliente que alguna vez cambió; un reinicio o vaciado de Redis borra versiones y copias juntas.

export type OpcionesCache = {
  // Segundos que dura una copia como máximo (`M2_CACHE_TTL_S`).
  ttlS: number;
  // El reloj, en milisegundos. Solo para las pruebas.
  ahora?: () => number;
};

export type CacheEstadoCuenta = {
  // El estado de `clienteId`: la copia si hay una vigente y, si no, lo que devuelva `calcular` (la lectura en la base), que
  // además se guarda. Un error de `calcular` sale tal cual y no se guarda nada (el cliente no existe: RF-2.6.5.4).
  leer: (clienteId: string, calcular: () => Promise<EstadoCuenta>) => Promise<EstadoCuenta>;
  // Descarta las copias de `clienteId`: se llama después de que la base confirmó un alta o un levantamiento de bloqueo, y
  // antes de responder (RF-2.6.6, RF-2.6.6.1). No lanza: si Redis falla, la respuesta al operador no cambia.
  invalidar: (clienteId: string) => Promise<void>;
};

export const claveVersion = (clienteId: string): string => `m2:estado-cuenta:v:${clienteId}`;
export const claveCopia = (clienteId: string, version: number): string => `m2:estado-cuenta:c:${clienteId}:${version}`;

// Lo que se acepta como copia: un `EstadoCuenta` de ese cliente. Cualquier otra cosa en la clave (un JSON de otra forma, texto
// roto) es como no tener copia y se reemplaza.
function aEstado(texto: string, clienteId: string): EstadoCuenta | undefined {
  let valor: unknown;
  try {
    valor = JSON.parse(texto);
  } catch {
    return undefined;
  }
  if (typeof valor !== 'object' || valor === null) return undefined;
  const { clienteId: id, estado, bloqueosVigentes } = valor as Record<string, unknown>;
  const valido = id === clienteId && typeof estado === 'string' && Array.isArray(bloqueosVigentes);
  return valido ? (valor as EstadoCuenta) : undefined;
}

// Cuánto puede vivir la copia: lo configurado, o menos si algún bloqueo vigente termina antes (RF-2.6.7). Con 0 o menos, no se
// guarda: la copia nunca sobrevive al primer `hasta`.
function vencimientoMs(estado: EstadoCuenta, ttlS: number, ahoraMs: number): number {
  let ms = ttlS * 1000;
  for (const { hasta } of estado.bloqueosVigentes) {
    if (hasta !== undefined) ms = Math.min(ms, Date.parse(hasta) - ahoraMs);
  }
  return Math.floor(ms);
}

export function crearCacheEstadoCuenta(redis: Redis, { ttlS, ahora = Date.now }: OpcionesCache): CacheEstadoCuenta {
  // La versión actual del cliente. Un fallo de Redis, o un valor que no es un entero, lanza: quien llama sigue por la base.
  async function versionDe(clienteId: string): Promise<number> {
    const texto = await redis.get(claveVersion(clienteId));
    if (texto === null) return 0;
    if (!/^\d+$/.test(texto)) throw new Error('versión inválida');
    return Number(texto);
  }

  return {
    async leer(clienteId, calcular) {
      if (!redis.activo) return calcular();

      let version: number;
      let copia: EstadoCuenta | undefined;
      try {
        version = await versionDe(clienteId);
        const texto = await redis.get(claveCopia(clienteId, version));
        copia = texto === null ? undefined : aEstado(texto, clienteId);
      } catch {
        // Redis no contesta o devolvió algo que no es una versión: se responde desde la base y no se guarda, porque sin la
        // versión no se sabe bajo qué clave.
        return calcular();
      }
      if (copia !== undefined) return copia;

      const estado = await calcular();
      const ms = vencimientoMs(estado, ttlS, ahora());
      if (ms > 0) {
        try {
          await redis.set(claveCopia(clienteId, version), JSON.stringify(estado), ms);
        } catch {
          // Guardar es un beneficio: si falla, el cliente ya tiene su respuesta (el cliente de Redis ya avisó al log).
        }
      }
      return estado;
    },

    async invalidar(clienteId) {
      if (!redis.activo) return;
      try {
        await redis.incr(claveVersion(clienteId));
      } catch {
        // El cliente de Redis ya avisó al log. Qué pasa con las copias de este cliente mientras tanto es la T7 (RF-2.6.8.1).
      }
    },
  };
}
