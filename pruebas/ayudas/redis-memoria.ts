import { RedisNoDisponible, type Redis } from '../../src/cache/redis.js';

// Un Redis en memoria para las pruebas unitarias de la caché (spec 107): guarda cada valor con el instante en que vence, según
// un reloj que la prueba mueve. `fallar` hace que toda operación falle como falla Redis cuando no está (RNF-13).
export type RedisEnMemoria = Redis & {
  claves: () => string[];
  valor: (clave: string) => string | undefined;
  // El vencimiento que se pidió al guardar, en milisegundos (undefined si no lleva).
  vencimientoPedido: (clave: string) => number | undefined;
  fallar: boolean;
  // Solo estas operaciones fallan (por ejemplo, el INCR de una invalidación y nada más).
  fallarEn: Set<'get' | 'set' | 'incr' | 'pexpire'>;
  // Cuántas operaciones se hicieron, por nombre.
  llamadas: { get: number; set: number; incr: number; pexpire: number };
};

export function crearRedisEnMemoria(ahora: () => number = Date.now): RedisEnMemoria {
  const datos = new Map<string, { valor: string; venceEn: number | undefined; pedido: number | undefined }>();
  const llamadas = { get: 0, set: 0, incr: 0, pexpire: 0 };
  const vigente = (clave: string) => {
    const entrada = datos.get(clave);
    if (entrada === undefined) return undefined;
    if (entrada.venceEn !== undefined && entrada.venceEn <= ahora()) {
      datos.delete(clave);
      return undefined;
    }
    return entrada;
  };
  const redis: RedisEnMemoria = {
    activo: true,
    conectado: true,
    fallar: false,
    fallarEn: new Set(),
    llamadas,
    claves: () => [...datos.keys()].filter((clave) => vigente(clave) !== undefined),
    valor: (clave) => vigente(clave)?.valor,
    vencimientoPedido: (clave) => datos.get(clave)?.pedido,
    get: async (clave) => {
      llamadas.get += 1;
      if (redis.fallar || redis.fallarEn.has('get')) throw new RedisNoDisponible('get', 'NO_CONECTADO');
      return vigente(clave)?.valor ?? null;
    },
    set: async (clave, valor, vencimientoMs) => {
      llamadas.set += 1;
      if (redis.fallar || redis.fallarEn.has('set')) throw new RedisNoDisponible('set', 'NO_CONECTADO');
      datos.set(clave, { valor, venceEn: ahora() + vencimientoMs, pedido: vencimientoMs });
    },
    incr: async (clave) => {
      llamadas.incr += 1;
      if (redis.fallar || redis.fallarEn.has('incr')) throw new RedisNoDisponible('incr', 'NO_CONECTADO');
      const actual = vigente(clave);
      const siguiente = Number(actual?.valor ?? '0') + 1;
      datos.set(clave, { valor: String(siguiente), venceEn: actual?.venceEn, pedido: actual?.pedido });
      return siguiente;
    },
    pexpire: async (clave, vencimientoMs) => {
      llamadas.pexpire += 1;
      if (redis.fallar || redis.fallarEn.has('pexpire')) throw new RedisNoDisponible('pexpire', 'NO_CONECTADO');
      const actual = vigente(clave);
      if (actual) datos.set(clave, { ...actual, venceEn: ahora() + vencimientoMs, pedido: vencimientoMs });
    },
    cerrar: async () => undefined,
  };
  return redis;
}
