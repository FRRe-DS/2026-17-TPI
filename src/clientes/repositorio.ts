import type { Consultar } from '../bd/transaccion.js';
import { NoEncontrado, PerfilYaExiste } from '../errores.js';
import {
  aCliente,
  aEstadoCuenta,
  type Cliente,
  type ClienteCambios,
  type ClienteNuevo,
  type EstadoCuenta,
  type FilaBloqueo,
  type FilaCliente,
} from './modelo.js';

// Las consultas de perfiles (plan, Estructura). Cada función recibe `consultar`, el del pool (`PoolBd.consultar`) o el de una
// `transaccion()`, así sirve dentro de la idempotencia de las altas (T3) y fuera de ella. Los errores de la base salen como
// los clasifica `consultar()`; lo que es del dominio, como un `Problema` (404 y 409).

// Un bloqueo vigente: sin levantar y sin vencer (plan, «Estado y vigencia»). CURRENT_TIMESTAMP es el instante de la
// transacción, así que dos lecturas de una misma consulta coinciden.
const BLOQUEO_VIGENTE = 'levantado_en IS NULL AND (hasta IS NULL OR hasta > CURRENT_TIMESTAMP)';

// Las columnas de `FilaCliente` para una relación con alias `p`. El estado no se guarda: se calcula con los bloqueos vigentes
// (plan, Datos). La fecha sale con to_char y no con `::text`, que depende del DateStyle de la sesión.
const COLUMNAS = `p.cliente_id, p.nombre, p.apellido, p.telefono, to_char(p.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
  p.creado_en, p.actualizado_en,
  EXISTS (SELECT 1 FROM bloqueos_cliente b WHERE b.cliente_id = p.cliente_id AND ${BLOQUEO_VIGENTE}) AS bloqueado`;

// Las columnas de `FilaBloqueo` para una relación con alias `b`. `vigente` se calcula con el mismo predicado y el mismo
// instante que el resto de la consulta.
const COLUMNAS_BLOQUEO = `b.bloqueo_id, b.motivo, (${BLOQUEO_VIGENTE}) AS vigente, b.hasta, b.creado_en, b.creado_por,
  b.levantado_en, b.levantado_por, b.motivo_levantamiento`;

const NO_EXISTE = 'No existe el cliente pedido';

// Crea el perfil de `clienteId` (RF-2.1). Si ya existe, `PerfilYaExiste` (RF-2.1.3): ON CONFLICT DO NOTHING y no el 23505, que
// dentro de una transacción la dejaría abortada. Dos altas a la vez para el mismo cliente: la segunda espera a la primera, y
// si esta confirma, no inserta nada (RNF-08.1).
export async function crearPerfil(consultar: Consultar, clienteId: string, datos: ClienteNuevo): Promise<Cliente> {
  const { rows } = await consultar<FilaCliente>(
    `WITH nuevo AS (
       INSERT INTO clientes (cliente_id, nombre, apellido, telefono, fecha_nacimiento) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (cliente_id) DO NOTHING RETURNING *
     ) SELECT ${COLUMNAS} FROM nuevo p`,
    [clienteId, datos.nombre, datos.apellido, datos.telefono, datos.fechaNacimiento ?? null],
  );
  const fila = rows[0];
  if (fila === undefined) throw new PerfilYaExiste();
  return aCliente(fila);
}

// El perfil de `clienteId` (RF-2.1.1), o `NoEncontrado` si no existe (RF-2.1.3.1).
export async function obtenerPerfil(consultar: Consultar, clienteId: string): Promise<Cliente> {
  const { rows } = await consultar<FilaCliente>(`SELECT ${COLUMNAS} FROM clientes p WHERE p.cliente_id = $1`, [clienteId]);
  const fila = rows[0];
  if (fila === undefined) throw new NoEncontrado(NO_EXISTE);
  return aCliente(fila);
}

// Cambia solo los campos de `cambios` y conserva los demás (RF-2.1.2). Ningún campo admite null en el contrato, así que un
// `null` es «no se envió» y COALESCE deja el valor que había. Un UPDATE es atómico: dos actualizaciones a la vez de campos
// distintos se aplican una detrás de la otra y ninguna pisa a la otra. Sin campos (el contrato pide al menos uno), devuelve el
// perfil sin tocar `actualizado_en`. Sin perfil, `NoEncontrado` (RF-2.1.3.1).
export async function actualizarPerfil(consultar: Consultar, clienteId: string, cambios: ClienteCambios): Promise<Cliente> {
  const { nombre, apellido, telefono, fechaNacimiento } = cambios;
  if ([nombre, apellido, telefono, fechaNacimiento].every((campo) => campo === undefined)) {
    return obtenerPerfil(consultar, clienteId);
  }
  const { rows } = await consultar<FilaCliente>(
    `WITH actualizado AS (
       UPDATE clientes SET nombre = COALESCE($2, nombre), apellido = COALESCE($3, apellido),
         telefono = COALESCE($4, telefono), fecha_nacimiento = COALESCE($5::date, fecha_nacimiento),
         actualizado_en = clock_timestamp()
       WHERE cliente_id = $1 RETURNING *
     ) SELECT ${COLUMNAS} FROM actualizado p`,
    [clienteId, nombre ?? null, apellido ?? null, telefono ?? null, fechaNacimiento ?? null],
  );
  const fila = rows[0];
  if (fila === undefined) throw new NoEncontrado(NO_EXISTE);
  return aCliente(fila);
}

// El estado de cuenta de `clienteId` (RF-2.6): el perfil y sus bloqueos vigentes en una sola sentencia, así que comparten
// instantánea e instante (CURRENT_TIMESTAMP), y el estado se deduce de los mismos bloqueos que se devuelven. El LEFT JOIN
// trae una fila por bloqueo vigente, del más nuevo al más antiguo, o una sola con el bloqueo en null si no tiene ninguno. Sin
// perfil, `NoEncontrado` (RF-2.1.3.1).
export async function obtenerEstadoCuenta(consultar: Consultar, clienteId: string): Promise<EstadoCuenta> {
  const { rows } = await consultar<{ cliente_id: string } & { [K in keyof FilaBloqueo]: FilaBloqueo[K] | null }>(
    `SELECT p.cliente_id, ${COLUMNAS_BLOQUEO}
     FROM clientes p
     LEFT JOIN bloqueos_cliente b ON b.cliente_id = p.cliente_id AND ${BLOQUEO_VIGENTE}
     WHERE p.cliente_id = $1
     ORDER BY b.creado_en DESC, b.bloqueo_id DESC`,
    [clienteId],
  );
  if (rows.length === 0) throw new NoEncontrado(NO_EXISTE);
  return aEstadoCuenta(clienteId, rows.filter((fila) => fila.bloqueo_id !== null) as FilaBloqueo[]);
}
