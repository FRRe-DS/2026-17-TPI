import { randomUUID } from 'node:crypto';
import type { Identidad } from '../auth/tokens.js';
import { conIdempotencia, type RespuestaIdempotente } from '../bd/idempotencia.js';
import type { BaseDeDatos } from '../bd/pool.js';
import type { Consultar } from '../bd/transaccion.js';
import { BloqueoVencido, SinPermiso, SolicitudInvalida } from '../errores.js';
import type {
  Bloqueo,
  BloqueoNuevo,
  Cliente,
  ClienteCambios,
  ClienteNuevo,
  EstadoCuenta,
  LevantamientoBloqueo,
  PaginaBloqueos,
} from './modelo.js';
import * as repositorio from './repositorio.js';
import { actualizarPerfil, crearPerfil, obtenerPerfil, type PedidoHistorial } from './repositorio.js';

// Las reglas de las operaciones de perfil que el contrato no expresa (plan, Estructura): el rol efectivo, la propiedad, el
// clienteId que sale del token y la idempotencia del alta. No sabe de HTTP: lo llama `operaciones.ts`.

// Un UUID en su forma canónica, la que devuelve PostgreSQL.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// La forma en que PostgreSQL devuelve un uuid: en minúsculas y sin el prefijo urn:uuid:, que el formato uuid del contrato
// (Ajv) admite y PostgreSQL no. Así se compara con el sub, se pone en la huella y se pasa a la base.
export const normalizarUuid = (valor: string): string => valor.toLowerCase().replace(/^urn:uuid:/, '');

// El clienteId de quien crea su perfil: su sub (RF-2.1). Un sub que no es UUID no puede serlo, y da 400 (spec 004, Casos
// límite). El mensaje no lleva el sub (RNF-19).
export function clienteDelToken(identidad: Identidad): string {
  const clienteId = normalizarUuid(identidad.sub);
  if (!UUID.test(clienteId)) {
    throw new SolicitudInvalida('El sub del token no es un UUID: no puede ser el clienteId de un perfil');
  }
  return clienteId;
}

// Si quien llama puede operar sobre el perfil de `clienteId` (plan, «Propiedad»). Los roles efectivos son los del token que la
// operación admite, sin repetidos. Solo cuando son exactamente [CLIENTE] se exige que el sub sea el clienteId: así
// CLIENTE+OPERADOR lee otro perfil con su rol de OPERADOR, pero no lo actualiza, porque esa operación solo admite CLIENTE
// (RF-2.1.1.1, RF-2.1.2.1). Va antes de buscar el perfil: un CLIENTE no puede averiguar si existe el de otro.
export function exigirPropietario(identidad: Identidad, clienteId: string, rolesOperacion: readonly string[]): void {
  const efectivos = new Set(identidad.roles.filter((rol) => rolesOperacion.includes(rol)));
  const soloCliente = efectivos.size === 1 && efectivos.has('CLIENTE');
  if (soloCliente && normalizarUuid(identidad.sub) !== normalizarUuid(clienteId)) {
    throw new SinPermiso('El perfil pedido es de otro cliente');
  }
}

// `consultar` del pool, para el repositorio: es un método y necesita su `this`.
const delPool =
  (pool: BaseDeDatos): Consultar =>
  (sql, parametros) =>
    pool.consultar(sql, parametros);

// Crea el perfil de quien llama (RF-2.1) con la Idempotency-Key `clave` (RNF-08): la respuesta, 201 con Location, o la
// guardada si la solicitud se repite. 409 si ya tiene perfil (RF-2.1.3) y 422 si la clave se usó con otro cuerpo.
export async function crearCliente(
  pool: BaseDeDatos,
  identidad: Identidad,
  clave: string,
  datos: ClienteNuevo,
): Promise<RespuestaIdempotente> {
  const clienteId = clienteDelToken(identidad);
  const solicitud = { operacion: 'crearCliente', sujeto: clienteId, clienteId: null, clave, huella: { cuerpo: datos } };
  return conIdempotencia(pool, solicitud, async (consultar) => {
    const perfil = await crearPerfil(consultar, clienteId, datos);
    return { estado: 201, ubicacion: `/api/v1/clientes/${perfil.clienteId}`, cuerpo: perfil };
  });
}

// El perfil de `clienteId` (RF-2.1.1), si quien llama puede verlo. 404 si no existe (RF-2.1.3.1).
export async function obtenerCliente(
  pool: BaseDeDatos,
  identidad: Identidad,
  rolesOperacion: readonly string[],
  clienteId: string,
): Promise<Cliente> {
  exigirPropietario(identidad, clienteId, rolesOperacion);
  return obtenerPerfil(delPool(pool), normalizarUuid(clienteId));
}

// Cambia los campos enviados del perfil de `clienteId` (RF-2.1.2), si quien llama es su dueño. 404 si no existe.
export async function actualizarCliente(
  pool: BaseDeDatos,
  identidad: Identidad,
  rolesOperacion: readonly string[],
  clienteId: string,
  cambios: ClienteCambios,
): Promise<Cliente> {
  exigirPropietario(identidad, clienteId, rolesOperacion);
  return actualizarPerfil(delPool(pool), normalizarUuid(clienteId), cambios);
}

// El estado de cuenta de `clienteId` (RF-2.6), si quien llama puede verlo: su dueño, un OPERADOR o un SERVICIO (M5 y M9). La
// propiedad se exige solo si el único rol efectivo es CLIENTE. 404 si no existe el perfil.
export async function obtenerEstadoCuenta(
  pool: BaseDeDatos,
  identidad: Identidad,
  rolesOperacion: readonly string[],
  clienteId: string,
): Promise<EstadoCuenta> {
  exigirPropietario(identidad, clienteId, rolesOperacion);
  return repositorio.obtenerEstadoCuenta(delPool(pool), normalizarUuid(clienteId));
}

// Bloquea a `clienteId` (RF-2.6.1) con la Idempotency-Key `clave` (RNF-08): 201 con Location, o la respuesta guardada si la
// solicitud se repite. Solo llega OPERADOR (el contrato), y su sub queda como autor. El sujeto de la idempotencia es ese sub y
// el cliente es el de la ruta, que también va en la huella: la misma clave sirve para otro cliente. El bloqueoId lo genera M2.
// Un `hasta` ya pasado según el reloj del servicio da 422 sin ir a la base: entre otras, cubre el año 0000, que el contrato
// admite y PostgreSQL no. La comparación exacta, con el instante de creación, la hace el repositorio.
export async function crearBloqueo(
  pool: BaseDeDatos,
  identidad: Identidad,
  clienteId: string,
  clave: string,
  datos: BloqueoNuevo,
): Promise<RespuestaIdempotente> {
  if (datos.hasta !== undefined && Date.parse(datos.hasta) <= Date.now()) throw new BloqueoVencido();
  const cliente = normalizarUuid(clienteId);
  const solicitud = {
    operacion: 'crearBloqueo',
    sujeto: identidad.sub,
    clienteId: cliente,
    clave,
    huella: { cuerpo: datos, ruta: { clienteId: cliente } },
  };
  return conIdempotencia(pool, solicitud, async (consultar) => {
    const bloqueo = await repositorio.crearBloqueo(consultar, cliente, randomUUID(), datos, identidad.sub);
    return { estado: 201, ubicacion: `/api/v1/clientes/${cliente}/bloqueos/${bloqueo.bloqueoId}`, cuerpo: bloqueo };
  });
}

// Una página del historial de bloqueos de `clienteId` (RF-2.6.2). Solo llega OPERADOR. 404 si no existe el perfil.
export async function listarBloqueos(
  pool: BaseDeDatos,
  clienteId: string,
  pedido: PedidoHistorial,
): Promise<PaginaBloqueos> {
  return repositorio.listarBloqueos(delPool(pool), normalizarUuid(clienteId), pedido);
}

// El bloqueo `bloqueoId` de `clienteId` (RF-2.6.2). Solo llega OPERADOR. 404 si no es de ese cliente.
export async function obtenerBloqueo(pool: BaseDeDatos, clienteId: string, bloqueoId: string): Promise<Bloqueo> {
  return repositorio.obtenerBloqueo(delPool(pool), normalizarUuid(clienteId), normalizarUuid(bloqueoId));
}

// Levanta el bloqueo `bloqueoId` de `clienteId` (RF-2.6.3). Solo llega OPERADOR (el contrato), y su sub queda como autor. 404
// si no es de ese cliente; 409 si ya fue levantado o venció (RF-2.6.3.1).
export async function levantarBloqueo(
  pool: BaseDeDatos,
  identidad: Identidad,
  clienteId: string,
  bloqueoId: string,
  { motivo }: LevantamientoBloqueo,
): Promise<Bloqueo> {
  return repositorio.levantarBloqueo(
    delPool(pool),
    normalizarUuid(clienteId),
    normalizarUuid(bloqueoId),
    motivo,
    identidad.sub,
  );
}
