import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import type { Config } from '../config.js';
import { BaseNoDisponible, Conflicto } from '../errores.js';

// Cuántas conexiones abre el pool como máximo (plan, Datos).
const CONEXIONES_MAXIMAS = 10;

// SQLSTATE de unique_violation.
const UNIQUE_VIOLATION = '23505';

// Cuando falla con uno de estos códigos, la base no está: los de red de Node, y los SQLSTATE 57P01 (admin_shutdown, la base
// se está apagando o cortó la sesión) y 57P03 (cannot_connect_now, todavía está arrancando). Además, todo el que empieza con
// 08 (connection_exception), que se mira aparte.
const CODIGOS_SIN_BASE: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  '57P01',
  '57P03',
]);

// Los mensajes con los que el cliente de pg informa que no pudo conectar o que la base no contestó: no traen código. Se
// busca el comienzo y no cualquier parte del texto, para que un mensaje ajeno que los mencione no pase por una falta de base.
const MENSAJES_SIN_BASE = ['timeout exceeded when trying to connect', 'Query read timeout', 'Connection terminated'];

// Quien registra los errores del pool y de `consultar()` que no se devuelven como respuesta: recibe el error y un texto que
// dice dónde ocurrió. La app lo conecta a su logger; sin él, no se escribe nada (la salida estándar solo lleva logs en
// JSON, RNF-14.5). Un error tiene que registrarse con el serializador del logger, que le saca los secretos (RNF-19.1).
export type RegistrarError = (error: unknown, mensaje: string) => void;

// Lo que lanza `conTiempoMaximo` cuando se cumple el tiempo.
export class TiempoAgotado extends Error {
  constructor(ms: number) {
    super(`La base de datos no respondió en ${ms} ms`);
    this.name = new.target.name;
  }
}

// Espera a `promesa` hasta `ms` y, si no terminó, falla con `TiempoAgotado`. Los límites de pg (conexión y consulta) valen
// cada uno por separado: una conexión lenta seguida de una consulta lenta pasaría de largo. Este corte vale para el total
// (RNF-14.2). Lo que `promesa` haga después del corte no tiene a quién llegar: `Promise.race` la sigue atendiendo, y un
// rechazo tardío no llega a ser un rechazo sin atender.
export async function conTiempoMaximo<T>(promesa: Promise<T>, ms: number): Promise<T> {
  let temporizador: NodeJS.Timeout | undefined;
  const corte = new Promise<never>((_resolver, rechazar) => {
    temporizador = setTimeout(() => rechazar(new TiempoAgotado(ms)), ms);
  });
  try {
    return await Promise.race([promesa, corte]);
  } finally {
    clearTimeout(temporizador);
  }
}

// Qué le corresponde a un error de la base: el `Conflicto` del 409 (RNF-08.1) o `BaseNoDisponible`, el del 503
// (RNF-14.2). Cualquier otro devuelve `undefined`: queda como está para que el manejador de errores lo responda con un 500 y
// lo registre entero (RNF-03.3). Los errores nuevos no llevan ni la restricción ni la consulta, que sí tiene el original.
export function clasificarError(error: unknown): Conflicto | BaseNoDisponible | undefined {
  if (!(error instanceof Error)) return undefined;
  if (error instanceof TiempoAgotado) return new BaseNoDisponible();
  // En un error de pg, `code` es el SQLSTATE si lo contestó la base, y el código de Node si falló el socket.
  const { code } = error as { code?: unknown };
  if (code === UNIQUE_VIOLATION) return new Conflicto();
  if (typeof code === 'string' && (CODIGOS_SIN_BASE.has(code) || code.startsWith('08'))) return new BaseNoDisponible();
  if (MENSAJES_SIN_BASE.some((texto) => error.message.startsWith(texto))) return new BaseNoDisponible();
  return undefined;
}

// El pool de conexiones de la base de este módulo. Todo acceso a la base de esta spec y de las siguientes pasa por
// `consultar()`, no por `query()`, que no corta a tiempo ni traduce los errores.
export class PoolBd extends Pool {
  readonly #tiempoBdMs: number;
  readonly #registrar: RegistrarError;

  constructor({ urlBd, tiempoBdMs }: Pick<Config, 'urlBd' | 'tiempoBdMs'>, registrar: RegistrarError = () => {}) {
    // Sin connectionTimeoutMillis, pg espera para siempre una conexión a una base colgada; sin query_timeout, una consulta
    // cortada por `consultar()` seguiría ocupando su conexión hasta que la base termine, y el pool se quedaría sin ellas.
    super({ connectionString: urlBd, max: CONEXIONES_MAXIMAS, connectionTimeoutMillis: tiempoBdMs, query_timeout: tiempoBdMs });
    this.#tiempoBdMs = tiempoBdMs;
    this.#registrar = registrar;
    // Una conexión inactiva que la base corta (un reinicio, un apagado) emite 'error' en el pool, y sin oyente tira el
    // proceso. El pool descarta esa conexión y abre otra cuando haga falta.
    this.on('error', (error) => registrar(error, 'Falló una conexión inactiva del pool de la base de datos'));
  }

  // Ejecuta una consulta con parámetros ($1, $2, …) sin esperar más del tiempo de base (RNF-14.2). Si choca con una restricción
  // única lanza `Conflicto`, y si la base no está o no contesta, `BaseNoDisponible` después de registrar la causa: el
  // manejador de errores no registra los 503. Cualquier otro error sale como llegó.
  async consultar<Fila extends QueryResultRow = QueryResultRow>(
    sql: string,
    parametros?: unknown[],
  ): Promise<QueryResult<Fila>> {
    try {
      return await conTiempoMaximo(this.query<Fila>(sql, parametros), this.#tiempoBdMs);
    } catch (error) {
      const problema = clasificarError(error);
      if (problema === undefined) throw error;
      if (problema instanceof BaseNoDisponible) this.#registrar(error, 'La base de datos no está disponible');
      throw problema;
    }
  }
}

// Lo único que necesitan los manejadores de la base: consultar. El `PoolBd` lo cumple, y las pruebas HTTP le pasan un pool
// falso cuando no hace falta la base. Cerrar el pool no les toca: lo hace quien lo crea.
export type BaseDeDatos = Pick<PoolBd, 'consultar'>;

// El pool de la configuración. No se conecta hasta la primera consulta, y hay que cerrarlo con `end()` al detenerse.
export function crearPool(config: Pick<Config, 'urlBd' | 'tiempoBdMs'>, registrar?: RegistrarError): PoolBd {
  return new PoolBd(config, registrar);
}
