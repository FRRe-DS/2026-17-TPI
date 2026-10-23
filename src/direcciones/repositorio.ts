import type { Consultar } from '../bd/transaccion.js';
import { NoEncontrado } from '../errores.js';
import {
  aDireccion,
  aPaginaDirecciones,
  type Direccion,
  type DireccionCambios,
  type DireccionNueva,
  type FilaDireccion,
  type PaginaDirecciones,
  type TipoDireccion,
} from './modelo.js';

// Las consultas de direcciones (plan, Estructura). Como las de perfiles, cada función recibe `consultar`, el del pool o el de
// una `transaccion()`, así sirve dentro de la idempotencia del alta (T5) y fuera de ella. Todo va con parámetros SQL, nunca
// interpolado (plan, Privacidad). Una dirección se busca siempre por `(cliente_id, direccion_id)`: la de otro cliente no se
// distingue de una que no existe.

// Las columnas de `FilaDireccion`.
const COLUMNAS = 'direccion_id, tipo, alias, texto, latitud, longitud, creado_en';

// Las mismas columnas, para la relación `d` del LEFT JOIN del listado.
const COLUMNAS_LISTADO = COLUMNAS.split(', ')
  .map((columna) => `d.${columna}`)
  .join(', ');

const NO_EXISTE = 'No existe la dirección pedida';
const NO_EXISTE_CLIENTE = 'No existe el cliente pedido';

// Guarda la dirección `direccionId` de `clienteId` (RF-2.2). `creado_en` lo pone la base. Los opcionales ausentes quedan en
// null; un alias vacío se guarda vacío. Que el perfil exista lo comprueba el servicio antes (plan, Lógica): sin él, la clave
// foránea de la base rechaza la fila. Un `direccionId` repetido da `Conflicto`, por la clave primaria.
export async function crearDireccion(
  consultar: Consultar,
  clienteId: string,
  direccionId: string,
  datos: DireccionNueva,
): Promise<Direccion> {
  const { rows } = await consultar<FilaDireccion>(
    `INSERT INTO direcciones_cliente (direccion_id, cliente_id, tipo, alias, texto, latitud, longitud)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNAS}`,
    [
      direccionId,
      clienteId,
      datos.tipo,
      datos.alias ?? null,
      datos.texto,
      datos.coordenadas?.latitud ?? null,
      datos.coordenadas?.longitud ?? null,
    ],
  );
  const fila = rows[0];
  // Un INSERT ... RETURNING siempre devuelve la fila que insertó.
  if (fila === undefined) throw new Error('El alta de la dirección no devolvió la fila');
  return aDireccion(fila);
}

// La dirección `direccionId` de `clienteId` (RF-2.2.2), o `NoEncontrado` si no existe o es de otro cliente (RF-2.2.2.1).
export async function obtenerDireccion(consultar: Consultar, clienteId: string, direccionId: string): Promise<Direccion> {
  const { rows } = await consultar<FilaDireccion>(
    `SELECT ${COLUMNAS} FROM direcciones_cliente WHERE cliente_id = $1 AND direccion_id = $2`,
    [clienteId, direccionId],
  );
  const fila = rows[0];
  if (fila === undefined) throw new NoEncontrado(NO_EXISTE);
  return aDireccion(fila);
}

// Lo que se pide del listado: el tipo, si lo hay, y la página (desde 0).
export type PedidoListado = { tipo?: TipoDireccion; page: number; size: number };

// Una página de las direcciones de `clienteId` (RF-2.2.1), de la más nueva a la más antigua y, a igual creación, por
// `direccion_id`, para que el orden sea estable entre páginas; es el orden de los dos índices de la migración. Una sola
// sentencia trae el perfil, el total del filtro y la página: comparten instantánea, así que el total coincide con lo que se
// pagina. Sin perfil, `NoEncontrado` (spec, Contrato y dependencias). La página va desde `page * size`, con un tope: una página
// enorme desbordaría el bigint de OFFSET, y cualquier valor por encima del tope ya queda fuera del total. El filtro es una
// condición fija con el tipo como parámetro, no texto interpolado.
export async function listarDirecciones(
  consultar: Consultar,
  clienteId: string,
  { tipo, page, size }: PedidoListado,
): Promise<PaginaDirecciones> {
  const filtro = tipo === undefined ? 'TRUE' : 'tipo = $4';
  const desde = Math.min(page * size, Number.MAX_SAFE_INTEGER);
  const { rows } = await consultar<{ total: number } & { [K in keyof FilaDireccion]: FilaDireccion[K] | null }>(
    `SELECT t.total, ${COLUMNAS_LISTADO}
     FROM clientes p
     CROSS JOIN LATERAL (
       SELECT count(*)::integer AS total FROM direcciones_cliente WHERE cliente_id = p.cliente_id AND ${filtro}
     ) t
     LEFT JOIN LATERAL (
       SELECT ${COLUMNAS} FROM direcciones_cliente WHERE cliente_id = p.cliente_id AND ${filtro}
       ORDER BY creado_en DESC, direccion_id DESC LIMIT $2 OFFSET $3
     ) d ON TRUE
     WHERE p.cliente_id = $1
     ORDER BY d.creado_en DESC, d.direccion_id DESC`,
    tipo === undefined ? [clienteId, size, desde] : [clienteId, size, desde, tipo],
  );
  const primera = rows[0];
  if (primera === undefined) throw new NoEncontrado(NO_EXISTE_CLIENTE);
  const filas = rows.filter((fila) => fila.direccion_id !== null) as FilaDireccion[];
  return aPaginaDirecciones(filas, primera.total, page, size);
}

// Cambia solo los campos de `cambios` y conserva los demás, también `creado_en` (RF-2.2.3). Ningún campo admite null en el
// contrato, así que un `null` es «no se envió» y COALESCE deja el valor que había; un alias vacío no es null y sí reemplaza.
// Las coordenadas se reemplazan juntas: llegan las dos o ninguna, como pide el check de la base. Un UPDATE es atómico: dos
// actualizaciones a la vez de campos distintos se aplican una detrás de la otra y ninguna pisa a la otra. Sin campos (el
// contrato pide al menos uno), devuelve la dirección sin tocarla. Sin dirección bajo ese cliente, `NoEncontrado`.
export async function actualizarDireccion(
  consultar: Consultar,
  clienteId: string,
  direccionId: string,
  cambios: DireccionCambios,
): Promise<Direccion> {
  const { tipo, alias, texto, coordenadas } = cambios;
  if ([tipo, alias, texto, coordenadas].every((campo) => campo === undefined)) {
    return obtenerDireccion(consultar, clienteId, direccionId);
  }
  const { rows } = await consultar<FilaDireccion>(
    `UPDATE direcciones_cliente SET tipo = COALESCE($3, tipo), alias = COALESCE($4, alias), texto = COALESCE($5, texto),
       latitud = COALESCE($6, latitud), longitud = COALESCE($7, longitud)
     WHERE cliente_id = $1 AND direccion_id = $2 RETURNING ${COLUMNAS}`,
    [
      clienteId,
      direccionId,
      tipo ?? null,
      alias ?? null,
      texto ?? null,
      coordenadas?.latitud ?? null,
      coordenadas?.longitud ?? null,
    ],
  );
  const fila = rows[0];
  if (fila === undefined) throw new NoEncontrado(NO_EXISTE);
  return aDireccion(fila);
}

// Borra la dirección `direccionId` de `clienteId` (RF-2.2.4): la fila desaparece, sin historial (spec, Decisiones). Sin
// dirección bajo ese cliente, o ya borrada, `NoEncontrado` (RF-2.2.4.1). Dos borrados a la vez: el segundo espera a la fila,
// y si el primero confirma, no encuentra nada.
export async function eliminarDireccion(consultar: Consultar, clienteId: string, direccionId: string): Promise<void> {
  const { rowCount } = await consultar(
    'DELETE FROM direcciones_cliente WHERE cliente_id = $1 AND direccion_id = $2 RETURNING direccion_id',
    [clienteId, direccionId],
  );
  if (rowCount === 0) throw new NoEncontrado(NO_EXISTE);
}
