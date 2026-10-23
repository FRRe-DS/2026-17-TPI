import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { BaseNoDisponible } from '../errores.js';
import { clasificarError, conTiempoMaximo, type PoolBd } from './pool.js';

// Lo que recibe la función de una transacción para consultar dentro de ella: lo mismo que `consultar()` del pool, pero sobre
// la conexión de la transacción.
export type Consultar = <Fila extends QueryResultRow = QueryResultRow>(
  sql: string,
  parametros?: unknown[],
) => Promise<QueryResult<Fila>>;

// Lo que usa `transaccion()` del pool.
export type PoolTransaccional = Pick<PoolBd, 'connect' | 'tiempoBdMs'>;

// Ejecuta `fn` dentro de una transacción (plan, «Transacciones»): BEGIN, lo que haga `fn` y COMMIT, o ROLLBACK si algo
// falla, y entonces relanza el error. Cada sentencia, también BEGIN, COMMIT y ROLLBACK, tiene el tope del tiempo de base y la
// clasificación de `consultar()`: una restricción única da `Conflicto` (409, RNF-08.1), una base que no está o no contesta,
// `BaseNoDisponible` (503, RNF-14.2), y cualquier otro error sale tal cual, para el 500. Un error propio de `fn` también sale
// tal cual. `fn` no debe dejar consultas sin esperar: al terminar, la conexión vuelve al pool.
export async function transaccion<T>(pool: PoolTransaccional, fn: (consultar: Consultar) => Promise<T>): Promise<T> {
  const cliente = await conectar(pool);
  // Mientras la conexión está prestada, el pool no escucha sus errores: si la base la corta entre dos sentencias, pg emite
  // 'error' y, sin oyente, se cae el proceso. Se guarda el primero: es la causa del 503 de la sentencia siguiente, que si no
  // fallaría con un mensaje que `clasificarError` no reconoce.
  let corte: Error | undefined;
  const alCortarse = (error: Error) => {
    corte ??= error;
  };
  cliente.on('error', alCortarse);

  const consultar: Consultar = async (sql, parametros) => {
    try {
      return await conTiempoMaximo(cliente.query(sql, parametros), pool.tiempoBdMs);
    } catch (error) {
      throw clasificarError(error) ?? (corte ? new BaseNoDisponible({ cause: corte }) : error);
    }
  };

  // Devuelve la conexión al pool o, si ya no sirve, la descarta. A una descartada se le deja el oyente: pg todavía puede
  // emitir el error del corte.
  const soltar = (sirve: boolean) => {
    if (!sirve) return cliente.release(true);
    cliente.off('error', alCortarse);
    cliente.release();
  };

  let resultado: T;
  try {
    await consultar('BEGIN');
    resultado = await fn(consultar);
    await consultar('COMMIT');
  } catch (error) {
    soltar(await deshacer(consultar, error));
    throw error;
  }
  soltar(true);
  return resultado;
}

// Una conexión del pool, con el mismo tope y la misma clasificación que las sentencias.
async function conectar(pool: PoolTransaccional): Promise<PoolClient> {
  const conexion = pool.connect();
  try {
    return await conTiempoMaximo(conexion, pool.tiempoBdMs);
  } catch (error) {
    // Si el corte llegó antes que la conexión, la que llegue después vuelve al pool.
    conexion.then(
      (tardia) => tardia.release(),
      () => {},
    );
    throw clasificarError(error) ?? error;
  }
}

// Deshace la transacción después de `error` y dice si la conexión sigue sirviendo. Con `BaseNoDisponible` no sirve: la base
// la cortó, o una sentencia cortada por tiempo la sigue ocupando y un ROLLBACK esperaría detrás de ella. Se descarta sin
// ROLLBACK, y la base deshace la transacción al perder la sesión. Si el ROLLBACK falla, también se descarta.
async function deshacer(consultar: Consultar, error: unknown): Promise<boolean> {
  if (error instanceof BaseNoDisponible) return false;
  try {
    await consultar('ROLLBACK');
    return true;
  } catch {
    return false;
  }
}
