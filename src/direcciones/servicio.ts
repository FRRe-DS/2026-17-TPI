import { randomUUID } from 'node:crypto';
import type { Identidad } from '../auth/tokens.js';
import { conIdempotencia, type RespuestaIdempotente } from '../bd/idempotencia.js';
import type { BaseDeDatos } from '../bd/pool.js';
import type { Consultar } from '../bd/transaccion.js';
import { exigirPerfil } from '../clientes/repositorio.js';
import { exigirPropietario, normalizarUuid } from '../clientes/servicio.js';
import type { Direccion, DireccionCambios, DireccionNueva, PaginaDirecciones } from './modelo.js';
import * as repositorio from './repositorio.js';
import type { PedidoListado } from './repositorio.js';

// Las reglas de las direcciones que el contrato no expresa (plan, Estructura): el rol efectivo, la propiedad, la existencia del
// perfil y la idempotencia del alta. No sabe de HTTP: lo llamará `operaciones.ts`. La propiedad es la de la spec 004
// (`exigirPropietario`): solo si el único rol efectivo es CLIENTE se exige que el sub sea el clienteId. Las lecturas admiten
// CLIENTE y OPERADOR, así que CLIENTE+OPERADOR lee las de otro cliente; las escrituras solo admiten CLIENTE, así que tiene que
// ser el dueño (RF-2.2.5). Va siempre antes de la base: un CLIENTE no puede averiguar nada del perfil de otro. Los ids de la
// ruta se normalizan como los devuelve PostgreSQL. Nada de esto escribe logs (RNF-19).

// `consultar` del pool, para el repositorio: es un método y necesita su `this`.
const delPool =
  (pool: BaseDeDatos): Consultar =>
  (sql, parametros) =>
    pool.consultar(sql, parametros);

// Registra una dirección en el perfil de `clienteId` (RF-2.2) con la Idempotency-Key `clave` (RNF-08): 201 con Location, o la
// respuesta guardada si la solicitud se repite. El direccionId lo genera M2. El orden es el del plan (Lógica, Crear): la
// propiedad, la reserva de la clave y, dentro de la misma transacción, el perfil y el alta. Sin perfil, `NoEncontrado` (404):
// la transacción se deshace, no queda reserva y la misma clave sirve cuando el perfil exista; comprobarlo antes del INSERT
// evita que la clave foránea lo convierta en un 500. Con la misma clave y otro cuerpo, `IdempotenciaReutilizada` (422).
// El sujeto es el sub normalizado, que por la propiedad es el mismo cliente de la ruta, y la fila de `idempotencias` guarda
// siempre ese cliente, nunca null. La huella lleva el cuerpo tal como llegó y el cliente de la ruta.
export async function crearDireccion(
  pool: BaseDeDatos,
  identidad: Identidad,
  rolesOperacion: readonly string[],
  clienteId: string,
  clave: string,
  datos: DireccionNueva,
): Promise<RespuestaIdempotente> {
  exigirPropietario(identidad, clienteId, rolesOperacion);
  const cliente = normalizarUuid(clienteId);
  const solicitud = {
    operacion: 'crearDireccion',
    sujeto: normalizarUuid(identidad.sub),
    clienteId: cliente,
    clave,
    huella: { cuerpo: datos, ruta: { clienteId: cliente } },
  };
  return conIdempotencia(pool, solicitud, async (consultar) => {
    await exigirPerfil(consultar, cliente);
    const direccion = await repositorio.crearDireccion(consultar, cliente, randomUUID(), datos);
    return { estado: 201, ubicacion: `/api/v1/clientes/${cliente}/direcciones/${direccion.direccionId}`, cuerpo: direccion };
  });
}

// Una página de las direcciones de `clienteId` (RF-2.2.1), si quien llama puede verlas. 404 si no existe el perfil.
export async function listarDirecciones(
  pool: BaseDeDatos,
  identidad: Identidad,
  rolesOperacion: readonly string[],
  clienteId: string,
  pedido: PedidoListado,
): Promise<PaginaDirecciones> {
  exigirPropietario(identidad, clienteId, rolesOperacion);
  return repositorio.listarDirecciones(delPool(pool), normalizarUuid(clienteId), pedido);
}

// La dirección `direccionId` de `clienteId` (RF-2.2.2), si quien llama puede verla. 404 si no es de ese cliente, no existe o
// no existe el perfil, que no puede tener direcciones (RF-2.2.2.1).
export async function obtenerDireccion(
  pool: BaseDeDatos,
  identidad: Identidad,
  rolesOperacion: readonly string[],
  clienteId: string,
  direccionId: string,
): Promise<Direccion> {
  exigirPropietario(identidad, clienteId, rolesOperacion);
  return repositorio.obtenerDireccion(delPool(pool), normalizarUuid(clienteId), normalizarUuid(direccionId));
}

// Cambia los campos enviados de la dirección `direccionId` de `clienteId` (RF-2.2.3), si quien llama es su dueño. 404 como en
// `obtenerDireccion`.
export async function actualizarDireccion(
  pool: BaseDeDatos,
  identidad: Identidad,
  rolesOperacion: readonly string[],
  clienteId: string,
  direccionId: string,
  cambios: DireccionCambios,
): Promise<Direccion> {
  exigirPropietario(identidad, clienteId, rolesOperacion);
  return repositorio.actualizarDireccion(delPool(pool), normalizarUuid(clienteId), normalizarUuid(direccionId), cambios);
}

// Borra la dirección `direccionId` de `clienteId` (RF-2.2.4), si quien llama es su dueño. 404 como en `obtenerDireccion`, y
// también si ya se borró (RF-2.2.4.1).
export async function eliminarDireccion(
  pool: BaseDeDatos,
  identidad: Identidad,
  rolesOperacion: readonly string[],
  clienteId: string,
  direccionId: string,
): Promise<void> {
  exigirPropietario(identidad, clienteId, rolesOperacion);
  await repositorio.eliminarDireccion(delPool(pool), normalizarUuid(clienteId), normalizarUuid(direccionId));
}
