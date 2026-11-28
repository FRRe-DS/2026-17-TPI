import { createClient } from 'redis';
import type { Config } from '../config.js';

// El cliente de Redis de la caché del estado de cuenta (spec 107). Redis es solo una copia: todo fallo se convierte en
// RedisNoDisponible y quien llama sigue por la base (RF-2.6.11). Por eso este módulo:
//  - pone un tiempo máximo a cada operación (`tiempoRedisMs`) y no reintenta dentro de la solicitud (RNF-13);
//  - falla de inmediato si no está conectado, en vez de encolar el pedido para cuando vuelva (`disableOfflineQueue`);
//  - se reconecta solo en segundo plano, con espera creciente, y nunca tumba el proceso: sin un `error` atendido, Node lo haría;
//  - avisa al log solo el nombre de la operación y un código, sin clave, valor ni dirección (RNF-19).

// Una operación que no se pudo hacer: `operacion` es get, set, incr o pexpire; `codigo`, por qué (TIMEOUT, NO_CONECTADO, el
// código del sistema como ECONNRESET, o el nombre del error). El mensaje es fijo: no repite nada de lo que se pidió.
export class RedisNoDisponible extends Error {
  constructor(
    readonly operacion: string,
    readonly codigo: string,
  ) {
    super('Redis no disponible');
    this.name = 'RedisNoDisponible';
  }
}

export type AvisoRedis = { operacion: string; codigo: string };

export type OpcionesRedis = {
  // Para el log: se llama una vez por ventana, sea cual sea la cantidad de fallos.
  avisar: (aviso: AvisoRedis) => void;
  // El reloj, en milisegundos. Solo para las pruebas.
  ahora?: () => number;
};

// Lo que la caché necesita de Redis. Con `activo` en false, todo es un no-op: leer no encuentra nada.
export type Redis = {
  readonly activo: boolean;
  readonly conectado: boolean;
  get: (clave: string) => Promise<string | null>;
  set: (clave: string, valor: string, vencimientoMs: number) => Promise<void>;
  incr: (clave: string) => Promise<number>;
  pexpire: (clave: string, vencimientoMs: number) => Promise<void>;
  cerrar: () => Promise<void>;
};

// Un fallo repetido deja un solo aviso por ventana: con Redis caído, cada solicitud falla y el log se llenaría.
const VENTANA_AVISOS_MS = 5000;
// Cuánto espera un intento de conexión. Es aparte del tiempo de las operaciones: conectar por TLS tarda más que un GET.
const CONEXION_MS = 2000;
// Las órdenes enviadas sin respuesta que acepta el cliente: con un Redis que no contesta, no crecen sin límite.
const ORDENES_SIN_RESPUESTA = 200;
const ESPERA_MAXIMA_RECONEXION_MS = 2000;

const SIN_CACHE: Redis = {
  activo: false,
  conectado: false,
  get: async () => null,
  set: async () => undefined,
  incr: async () => 0,
  pexpire: async () => undefined,
  cerrar: async () => undefined,
};

// El código con el que se informa un error: el del sistema (ECONNREFUSED) o, si no tiene, el nombre de la clase. Nunca el mensaje,
// que puede traer la dirección.
function codigoDe(error: unknown): string {
  if (error instanceof RedisNoDisponible) return error.codigo;
  const codigo = (error as { code?: unknown } | null)?.code;
  if (typeof codigo === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(codigo)) return codigo;
  const nombre = error instanceof Error ? error.name : '';
  return /^[A-Za-z0-9_]{1,40}$/.test(nombre) ? nombre : 'DESCONOCIDO';
}

export function crearRedis(config: Pick<Config, 'urlRedis' | 'tiempoRedisMs'>, { avisar, ahora = Date.now }: OpcionesRedis): Redis {
  if (config.urlRedis === undefined) return SIN_CACHE;

  const cliente = createClient({
    url: config.urlRedis,
    disableOfflineQueue: true,
    commandsQueueMaxLength: ORDENES_SIN_RESPUESTA,
    socket: {
      connectTimeout: CONEXION_MS,
      reconnectStrategy: (intentos) => Math.min(2 ** intentos * 50, ESPERA_MAXIMA_RECONEXION_MS),
    },
  });

  let cerrado = false;
  let ultimoAviso = Number.NEGATIVE_INFINITY;
  const avisarUnaVez = (operacion: string, error: unknown): void => {
    const ahoraMs = ahora();
    if (ahoraMs - ultimoAviso < VENTANA_AVISOS_MS) return;
    ultimoAviso = ahoraMs;
    avisar({ operacion, codigo: codigoDe(error) });
  };

  // Sin este oyente, un error de conexión sería una excepción sin atender y el proceso se caería.
  cliente.on('error', (error: unknown) => {
    if (!cerrado) avisarUnaVez('conexion', error);
  });
  // `connect` sigue intentando según la estrategia de reconexión; solo rechaza si se cierra antes de conectar.
  cliente.connect().catch((error: unknown) => {
    if (!cerrado) avisarUnaVez('conexion', error);
  });

  async function ejecutar<T>(operacion: string, orden: () => Promise<T>): Promise<T> {
    const fallar = (codigo: string): never => {
      const error = new RedisNoDisponible(operacion, codigo);
      avisarUnaVez(operacion, error);
      throw error;
    };
    if (cerrado || !cliente.isReady) return fallar('NO_CONECTADO');

    let temporizador: NodeJS.Timeout | undefined;
    try {
      const enCurso = orden();
      // Si gana el temporizador, la orden puede rechazar más tarde: ese rechazo ya no le importa a nadie.
      enCurso.catch(() => undefined);
      const agotado = new Promise<never>((_, rechazar) => {
        temporizador = setTimeout(() => rechazar(new RedisNoDisponible(operacion, 'TIMEOUT')), config.tiempoRedisMs);
      });
      return await Promise.race([enCurso, agotado]);
    } catch (error) {
      return fallar(codigoDe(error));
    } finally {
      clearTimeout(temporizador);
    }
  }

  return {
    activo: true,
    get conectado() {
      return !cerrado && cliente.isReady;
    },
    get: (clave) => ejecutar('get', async () => (await cliente.get(clave)) as string | null),
    set: (clave, valor, vencimientoMs) =>
      ejecutar('set', async () => {
        await cliente.set(clave, valor, { expiration: { type: 'PX', value: vencimientoMs } });
      }),
    incr: (clave) => ejecutar('incr', () => cliente.incr(clave)),
    pexpire: (clave, vencimientoMs) =>
      ejecutar('pexpire', async () => {
        await cliente.pExpire(clave, vencimientoMs);
      }),
    cerrar: async () => {
      if (cerrado) return;
      cerrado = true;
      // `destroy` corta ya: no espera a las órdenes en vuelo, que con un Redis colgado no terminarían nunca.
      cliente.destroy();
    },
  };
}
