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
  huella: unknown;
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
  const identidad = [operacion, sujeto, clienteId, clave];

  return transaccion(pool, async (consultar) => {
    const reserva = await consultar(
      `INSERT INTO idempotencias (operacion, sujeto, cliente_id, clave, hash_solicitud) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ON CONSTRAINT idempotencias_unica DO NOTHING`,
      [...identidad, hash],
    );
    if (reserva.rowCount === 0) return repetida(consultar, identidad, hash);

    const respuesta = await alta(consultar);
    // Se devuelve lo guardado y no `respuesta`: jsonb reordena las claves, y así la primera respuesta y las repetidas son
    // idénticas. jsonb explícito: pg convertiría una lista de JS en un arreglo de PostgreSQL.
    const { rows } = await consultar<Guardada>(
      `UPDATE idempotencias SET estado = $5, ubicacion = $6, respuesta = $7::jsonb
       WHERE operacion = $1 AND sujeto = $2 AND cliente_id IS NOT DISTINCT FROM $3 AND clave = $4
       RETURNING hash_solicitud, estado, ubicacion, respuesta`,
      [...identidad, respuesta.estado, respuesta.ubicacion, JSON.stringify(respuesta.cuerpo)],
    );
    return aRespuesta(rows[0]);
  });
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
async function repetida(consultar: Consultar, identidad: unknown[], hash: string): Promise<RespuestaIdempotente> {
  const { rows } = await consultar<Guardada>(
    `SELECT hash_solicitud, estado, ubicacion, respuesta FROM idempotencias
     WHERE operacion = $1 AND sujeto = $2 AND cliente_id IS NOT DISTINCT FROM $3 AND clave = $4 FOR UPDATE`,
    identidad,
  );
  if (rows[0] !== undefined && rows[0].hash_solicitud !== hash) throw new IdempotenciaReutilizada();
  return aRespuesta(rows[0]);
}

// SHA-256 del JSON de `valor` con las claves de cada objeto ordenadas: el mismo cuerpo con los campos en otro orden da la
// misma huella.
function huella(valor: unknown): string {
  const canonico = JSON.stringify(valor, (_clave, dato: unknown) =>
    dato !== null && typeof dato === 'object' && !Array.isArray(dato)
      ? Object.fromEntries(Object.entries(dato).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : dato,
  );
  return createHash('sha256').update(canonico).digest('hex');
}
