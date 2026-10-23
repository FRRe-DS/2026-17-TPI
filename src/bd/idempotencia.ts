import { createHash } from 'node:crypto';
import { IdempotenciaReutilizada } from '../errores.js';
import { type Consultar, type PoolTransaccional, transaccion } from './transaccion.js';

// Lo que identifica un alta con Idempotency-Key (ADR 004). `operacion` es el operationId; `sujeto`, el `sub` del token;
// `clienteId`, el de la ruta, o `null` si la ruta no lo lleva (crearCliente); `clave`, la Idempotency-Key. `huella` es lo que
// tiene que repetirse para que sea la misma solicitud: el cuerpo y los parámetros de la ruta, ya validados.
export type SolicitudIdempotente = {
  operacion: string;
  sujeto: string;
  clienteId: string | null;
  clave: string;
  huella: Record<string, unknown>;
};

// La respuesta de un alta, tal como se guarda y se repite: el código, el `Location` si lo hay y el cuerpo. El cuerpo vuelve
// de la base como JSON: tiene que estar ya en la forma del contrato (fechas como texto, sin `undefined`).
export type RespuestaIdempotente = { estado: number; ubicacion: string | null; cuerpo: unknown };

type Guardada = { hash_solicitud: string; estado: number | null; ubicacion: string | null; respuesta: unknown };

// Ejecuta `alta` una sola vez por solicitud idempotente (plan, «Crear perfil o bloqueo con idempotencia»; RNF-08). Todo pasa
// en una `transaccion()`: se reserva la clave, se hace el alta y se guarda su respuesta, o no queda nada. Con la clave ya
// usada, devuelve la respuesta guardada si la huella es la misma, sin ejecutar `alta`, y si no, `IdempotenciaReutilizada`
// (422). Una solicitud igual que llega mientras otra está en curso espera a que esa termine, en la restricción única de
// `idempotencias`: si la otra confirma, recibe su respuesta; si falla, hace el alta. Un alta que falla no deja la reserva, así
// que la misma clave la vuelve a intentar. Los errores de `transaccion()` salen tal cual.
export async function conIdempotencia(
  pool: PoolTransaccional,
  solicitud: SolicitudIdempotente,
  alta: (consultar: Consultar) => Promise<RespuestaIdempotente>,
): Promise<RespuestaIdempotente> {
  const { operacion, sujeto, clienteId, clave } = solicitud;
  const hash = huella(solicitud.huella);

  return transaccion(pool, async (consultar) => {
    const reserva = await consultar(
      `INSERT INTO idempotencias (operacion, sujeto, cliente_id, clave, hash_solicitud) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ON CONSTRAINT idempotencias_unica DO NOTHING`,
      [operacion, sujeto, clienteId, clave, hash],
    );
    if (reserva.rowCount === 0) return repetida(consultar, solicitud, hash);

    const respuesta = await alta(consultar);
    // Se devuelve lo guardado y no `respuesta`: jsonb reordena las claves, y así la primera respuesta y las repetidas son
    // idénticas. jsonb explícito: pg convertiría una lista de JS en un arreglo de PostgreSQL.
    const { condicion, valores } = laFila(solicitud, 4);
    const { rows } = await consultar<Guardada>(
      `UPDATE idempotencias SET estado = $1, ubicacion = $2, respuesta = $3::jsonb WHERE ${condicion}
       RETURNING hash_solicitud, estado, ubicacion, respuesta`,
      [respuesta.estado, respuesta.ubicacion, JSON.stringify(respuesta.cuerpo), ...valores],
    );
    return aRespuesta(rows[0]);
  });
}

// La condición que encuentra la fila de `solicitud` en `idempotencias`, con sus parámetros numerados desde `$desde`. El
// cliente se compara según el caso, con `IS NULL` o con `=`: con `IS NOT DISTINCT FROM`, PostgreSQL no usa el índice de la
// restricción única y recorre la tabla entera, que crece con cada alta.
function laFila({ operacion, sujeto, clienteId, clave }: SolicitudIdempotente, desde: number) {
  const [op, suj, cla, cli] = [desde, desde + 1, desde + 2, desde + 3];
  const comun = `operacion = $${op} AND sujeto = $${suj} AND clave = $${cla}`;
  return clienteId === null
    ? { condicion: `${comun} AND cliente_id IS NULL`, valores: [operacion, sujeto, clave] }
    : { condicion: `${comun} AND cliente_id = $${cli}`, valores: [operacion, sujeto, clave, clienteId] };
}

// La respuesta de una fila de `idempotencias` ya completa.
function aRespuesta(guardada: Guardada | undefined): RespuestaIdempotente {
  if (guardada === undefined || guardada.estado === null) {
    throw new Error('La reserva de idempotencia no tiene respuesta guardada');
  }
  return { estado: guardada.estado, ubicacion: guardada.ubicacion, cuerpo: guardada.respuesta };
}

// La respuesta guardada de una clave ya usada. La fila la confirmó otra transacción (la reserva esperó a que terminara), así
// que ya tiene la respuesta. Se bloquea, como pide el plan, para leerla sin que cambie.
async function repetida(
  consultar: Consultar,
  solicitud: SolicitudIdempotente,
  hash: string,
): Promise<RespuestaIdempotente> {
  const { condicion, valores } = laFila(solicitud, 1);
  const { rows } = await consultar<Guardada>(
    `SELECT hash_solicitud, estado, ubicacion, respuesta FROM idempotencias WHERE ${condicion} FOR UPDATE`,
    valores,
  );
  if (rows[0] !== undefined && rows[0].hash_solicitud !== hash) throw new IdempotenciaReutilizada();
  return aRespuesta(rows[0]);
}

// SHA-256 del JSON de `valor` con las claves de cada objeto ordenadas: el mismo cuerpo con los campos en otro orden da la
// misma huella.
function huella(valor: Record<string, unknown>): string {
  const canonico = JSON.stringify(valor, (_clave, dato: unknown) =>
    dato !== null && typeof dato === 'object' && !Array.isArray(dato)
      ? Object.fromEntries(Object.entries(dato).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : dato,
  );
  return createHash('sha256').update(canonico).digest('hex');
}
