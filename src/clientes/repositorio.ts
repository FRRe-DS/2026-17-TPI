import type { Consultar } from '../bd/transaccion.js';
import { BloqueoNoVigente, BloqueoVencido, BloqueoYaLevantado, NoEncontrado, PerfilYaExiste } from '../errores.js';
import {
  aBloqueo,
  aCliente,
  aEstadoCuenta,
  aPaginaBloqueos,
  type Bloqueo,
  type BloqueoNuevo,
  type Cliente,
  type ClienteCambios,
  type ClienteNuevo,
  type EstadoCuenta,
  type FilaBloqueo,
  type FilaCliente,
  type PaginaBloqueos,
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
const NO_EXISTE_BLOQUEO = 'No existe el bloqueo pedido';

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

// Si existe el perfil de `clienteId`; si no, `NoEncontrado`. También lo usa el alta de direcciones (spec 005).
export async function exigirPerfil(consultar: Consultar, clienteId: string): Promise<void> {
  const { rowCount } = await consultar('SELECT 1 FROM clientes WHERE cliente_id = $1', [clienteId]);
  if (rowCount === 0) throw new NoEncontrado(NO_EXISTE);
}

// Crea el bloqueo `bloqueoId` de `clienteId` (RF-2.6.1), con `autor` (el sub del operador) como `creado_por`. Sin perfil,
// `NoEncontrado` (404), antes de mirar la fecha. `hasta` tiene que ser posterior al instante de creación: el mismo
// clock_timestamp() es `creado_en` y la referencia de la comparación, así que `desde` (= `creadoEn`) nunca queda después de
// `hasta`; si no lo es, no inserta y da `BloqueoVencido` (422, RF-2.6.1.1). `hasta` llega como texto: el servicio ya lo pasó a
// UTC, porque PostgreSQL no lee todos los desplazamientos que admite el contrato, o es `-infinity` si es anterior al año 0001. Ninguno de los dos rechazos es un error de la base, así
// que dentro de una transacción no la abortan.
export async function crearBloqueo(
  consultar: Consultar,
  clienteId: string,
  bloqueoId: string,
  datos: BloqueoNuevo,
  autor: string,
): Promise<Bloqueo> {
  await exigirPerfil(consultar, clienteId);
  const { rows } = await consultar<FilaBloqueo>(
    `WITH nuevo AS (
       INSERT INTO bloqueos_cliente (bloqueo_id, cliente_id, motivo, hasta, creado_en, creado_por)
       SELECT $1, $2, $3, $4::timestamptz, ahora.t, $5 FROM (SELECT clock_timestamp() AS t) ahora
       WHERE $4::timestamptz IS NULL OR $4::timestamptz > ahora.t
       RETURNING *
     ) SELECT ${COLUMNAS_BLOQUEO} FROM nuevo b`,
    [bloqueoId, clienteId, datos.motivo, datos.hasta ?? null, autor],
  );
  const fila = rows[0];
  if (fila === undefined) throw new BloqueoVencido();
  return aBloqueo(fila);
}

// El bloqueo `bloqueoId` de `clienteId` (RF-2.6.2), vigente o no. Uno de otro cliente es `NoEncontrado`, igual que uno que no
// existe (spec 004, Casos límite).
export async function obtenerBloqueo(consultar: Consultar, clienteId: string, bloqueoId: string): Promise<Bloqueo> {
  const { rows } = await consultar<FilaBloqueo>(
    `SELECT ${COLUMNAS_BLOQUEO} FROM bloqueos_cliente b WHERE b.cliente_id = $1 AND b.bloqueo_id = $2`,
    [clienteId, bloqueoId],
  );
  const fila = rows[0];
  if (fila === undefined) throw new NoEncontrado(NO_EXISTE_BLOQUEO);
  return aBloqueo(fila);
}

// Levanta el bloqueo `bloqueoId` de `clienteId` (RF-2.6.3): guarda juntos, en una sola sentencia, el autor (el sub del
// operador), el instante y el motivo, y no toca nada más ni borra la fila. Solo cambia uno vigente en ese instante, el mismo
// CURRENT_TIMESTAMP que queda como `levantado_en`. Dos levantamientos a la vez: el segundo espera el bloqueo de la fila y, si
// el primero confirma, vuelve a evaluar la condición sobre la fila nueva y no cambia nada (RNF-08). Si no cambió nada, otra
// sentencia, con su propia instantánea, dice por qué (RF-2.6.3.1): no existe o es de otro cliente (`NoEncontrado`), ya fue
// levantado (`BloqueoYaLevantado`) o venció (`BloqueoNoVigente`). En la misma sentencia la lectura vería la instantánea de
// antes del otro levantamiento, y lo tomaría por vencido. Ninguno de los tres estados se deshace, así que la lectura no puede
// contradecir al UPDATE. Ningún rechazo es un error de la base: dentro de una transacción no la aborta.
export async function levantarBloqueo(
  consultar: Consultar,
  clienteId: string,
  bloqueoId: string,
  motivo: string,
  autor: string,
): Promise<Bloqueo> {
  const { rows } = await consultar<FilaBloqueo>(
    `WITH levantado AS (
       UPDATE bloqueos_cliente
       SET levantado_en = CURRENT_TIMESTAMP, levantado_por = $3, motivo_levantamiento = $4
       WHERE cliente_id = $1 AND bloqueo_id = $2 AND ${BLOQUEO_VIGENTE}
       RETURNING *
     ) SELECT ${COLUMNAS_BLOQUEO} FROM levantado b`,
    [clienteId, bloqueoId, autor, motivo],
  );
  const fila = rows[0];
  if (fila !== undefined) return aBloqueo(fila);
  const { rows: estado } = await consultar<{ levantado: boolean }>(
    'SELECT levantado_en IS NOT NULL AS levantado FROM bloqueos_cliente WHERE cliente_id = $1 AND bloqueo_id = $2',
    [clienteId, bloqueoId],
  );
  const actual = estado[0];
  if (actual === undefined) throw new NoEncontrado(NO_EXISTE_BLOQUEO);
  throw actual.levantado ? new BloqueoYaLevantado() : new BloqueoNoVigente();
}

// Lo que se pide del historial: el filtro de vigencia, si lo hay, y la página (desde 0).
export type PedidoHistorial = { vigente?: boolean; page: number; size: number };

// Una página del historial de `clienteId` (RF-2.6.2), del más nuevo al más antiguo y, a igual creación, por `bloqueo_id`, para
// que el orden sea estable entre páginas. Una sola sentencia trae el perfil, el total del filtro y la página: comparten
// instantánea e instante, y el total coincide con lo que se pagina. Sin perfil, `NoEncontrado`. La página va desde
// `page * size`, con un tope: una página enorme desbordaría el bigint de OFFSET, y cualquier valor por encima del tope ya
// queda fuera del total.
export async function listarBloqueos(
  consultar: Consultar,
  clienteId: string,
  { vigente, page, size }: PedidoHistorial,
): Promise<PaginaBloqueos> {
  const filtro = vigente === undefined ? 'TRUE' : vigente ? BLOQUEO_VIGENTE : `NOT (${BLOQUEO_VIGENTE})`;
  const desde = Math.min(page * size, Number.MAX_SAFE_INTEGER);
  const { rows } = await consultar<{ total: number } & { [K in keyof FilaBloqueo]: FilaBloqueo[K] | null }>(
    `SELECT t.total, ${COLUMNAS_BLOQUEO}
     FROM clientes p
     CROSS JOIN LATERAL (
       SELECT count(*)::integer AS total FROM bloqueos_cliente WHERE cliente_id = p.cliente_id AND ${filtro}
     ) t
     LEFT JOIN LATERAL (
       SELECT * FROM bloqueos_cliente WHERE cliente_id = p.cliente_id AND ${filtro}
       ORDER BY creado_en DESC, bloqueo_id DESC LIMIT $2 OFFSET $3
     ) b ON TRUE
     WHERE p.cliente_id = $1
     ORDER BY b.creado_en DESC, b.bloqueo_id DESC`,
    [clienteId, size, desde],
  );
  const primera = rows[0];
  if (primera === undefined) throw new NoEncontrado(NO_EXISTE);
  const filas = rows.filter((fila) => fila.bloqueo_id !== null) as FilaBloqueo[];
  return aPaginaBloqueos(filas, primera.total, page, size);
}
