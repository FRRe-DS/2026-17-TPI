import type { Consultar } from '../bd/transaccion.js';
import { CalificacionDuplicada, Conflicto, NoEncontrado } from '../errores.js';
import {
  aCalificacion,
  aPaginaCalificaciones,
  type Calificacion,
  type FilaCalificacion,
  type PaginaCalificaciones,
} from './modelo.js';

// Las consultas de calificaciones (plan, Estructura). Como las de perfiles y direcciones, cada función recibe `consultar`, el del
// pool o el de una `transaccion()`, así sirve dentro de la idempotencia del alta (T6) y fuera de ella. Todo va con parámetros
// SQL, nunca interpolado. Una calificación se busca siempre por `(cliente_id, calificacion_id)`: la de otro cliente no se
// distingue de una que no existe.

// Las columnas de `FilaCalificacion`.
const COLUMNAS = 'calificacion_id, viaje_id, conductor_id, puntaje, comentario, creado_en';

// Las mismas columnas, para la relación `c` del LEFT JOIN del listado.
const COLUMNAS_LISTADO = COLUMNAS.split(', ')
  .map((columna) => `c.${columna}`)
  .join(', ');

const NO_EXISTE = 'No existe la calificación pedida';
const NO_EXISTE_CLIENTE = 'No existe el cliente pedido';

// Lo que el servicio guarda de una calificación: el viaje, el conductor que informó M6 y lo que mandó el cliente.
export type CalificacionAGuardar = { viajeId: string; conductorId: string; puntaje: number; comentario?: string };

// Guarda la calificación `calificacionId` de `clienteId` (RF-2.5). `creado_en` lo pone la base. Sin comentario, queda en null; uno
// vacío se guarda vacío. Que el perfil exista lo comprueba el servicio antes: sin él, la clave foránea de la base rechaza la fila.
// Si el cliente ya calificó ese viaje, la restricción única `calificaciones_cliente_viaje_unica` rechaza la fila y sale
// `CalificacionDuplicada` (409, RF-2.5.3, RNF-08), también con altas a la vez: una gana y las demás reciben el conflicto. El
// `Conflicto` de `consultar()` solo puede venir de esa restricción o de la clave primaria, que es un UUID nuevo en cada alta.
export async function crearCalificacion(
  consultar: Consultar,
  clienteId: string,
  calificacionId: string,
  { viajeId, conductorId, puntaje, comentario }: CalificacionAGuardar,
): Promise<Calificacion> {
  try {
    const { rows } = await consultar<FilaCalificacion>(
      `INSERT INTO calificaciones (calificacion_id, cliente_id, viaje_id, conductor_id, puntaje, comentario)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNAS}`,
      [calificacionId, clienteId, viajeId, conductorId, puntaje, comentario ?? null],
    );
    const fila = rows[0];
    // Un INSERT ... RETURNING siempre devuelve la fila que insertó.
    if (fila === undefined) throw new Error('El alta de la calificación no devolvió la fila');
    return aCalificacion(fila);
  } catch (error) {
    if (error instanceof Conflicto) throw new CalificacionDuplicada();
    throw error;
  }
}

// Si `clienteId` ya calificó el viaje `viajeId` (RF-2.5.3). Usa el índice de la restricción única. Un UUID no distingue
// mayúsculas, y PostgreSQL lo compara como valor, no como texto.
export async function existeCalificacion(consultar: Consultar, clienteId: string, viajeId: string): Promise<boolean> {
  const { rowCount } = await consultar('SELECT 1 FROM calificaciones WHERE cliente_id = $1 AND viaje_id = $2', [clienteId, viajeId]);
  return rowCount === 1;
}

// La calificación `calificacionId` de `clienteId` (RF-2.5.10), o `NoEncontrado` si no existe o es de otro cliente.
export async function obtenerCalificacion(consultar: Consultar, clienteId: string, calificacionId: string): Promise<Calificacion> {
  const { rows } = await consultar<FilaCalificacion>(
    `SELECT ${COLUMNAS} FROM calificaciones WHERE cliente_id = $1 AND calificacion_id = $2`,
    [clienteId, calificacionId],
  );
  const fila = rows[0];
  if (fila === undefined) throw new NoEncontrado(NO_EXISTE);
  return aCalificacion(fila);
}

// Lo que se pide del listado: la página (desde 0) y su tamaño.
export type PedidoListado = { page: number; size: number };

// Una página de las calificaciones de `clienteId` (RF-2.5.8), de la más nueva a la más antigua y, a igual creación, por
// `calificacion_id`, para que el orden sea estable entre páginas; es el orden del índice `calificaciones_listado`. Una sola
// sentencia trae el perfil, el total y la página: comparten instantánea, así que el total coincide con lo que se pagina. Sin
// perfil, `NoEncontrado` (RF-2.5.11); sin calificaciones, items vacío (RF-2.5.9). La página va desde `page * size`, con un tope:
// una página enorme desbordaría el bigint de OFFSET, y cualquier valor por encima del tope ya queda fuera del total.
export async function listarCalificaciones(
  consultar: Consultar,
  clienteId: string,
  { page, size }: PedidoListado,
): Promise<PaginaCalificaciones> {
  const desde = Math.min(page * size, Number.MAX_SAFE_INTEGER);
  const { rows } = await consultar<{ total: number } & { [K in keyof FilaCalificacion]: FilaCalificacion[K] | null }>(
    `SELECT t.total, ${COLUMNAS_LISTADO}
     FROM clientes p
     CROSS JOIN LATERAL (
       SELECT count(*)::integer AS total FROM calificaciones WHERE cliente_id = p.cliente_id
     ) t
     LEFT JOIN LATERAL (
       SELECT ${COLUMNAS} FROM calificaciones WHERE cliente_id = p.cliente_id
       ORDER BY creado_en DESC, calificacion_id DESC LIMIT $2 OFFSET $3
     ) c ON TRUE
     WHERE p.cliente_id = $1
     ORDER BY c.creado_en DESC, c.calificacion_id DESC`,
    [clienteId, size, desde],
  );
  const primera = rows[0];
  if (primera === undefined) throw new NoEncontrado(NO_EXISTE_CLIENTE);
  const filas = rows.filter((fila) => fila.calificacion_id !== null) as FilaCalificacion[];
  return aPaginaCalificaciones(filas, primera.total, page, size);
}

// De los viajes `viajeIds`, los que `clienteId` calificó (RF-2.5.14), con una sola consulta que usa el índice de la restricción
// única. Los ids vuelven como los guarda PostgreSQL, en minúsculas, aunque lleguen en mayúsculas. Sin viajes, no consulta.
export async function viajesCalificados(consultar: Consultar, clienteId: string, viajeIds: readonly string[]): Promise<Set<string>> {
  if (viajeIds.length === 0) return new Set();
  const { rows } = await consultar<{ viaje_id: string }>(
    'SELECT viaje_id FROM calificaciones WHERE cliente_id = $1 AND viaje_id = ANY($2::uuid[])',
    [clienteId, viajeIds],
  );
  return new Set(rows.map((fila) => fila.viaje_id));
}
