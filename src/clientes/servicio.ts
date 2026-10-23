import type { Identidad } from '../auth/tokens.js';
import { conIdempotencia, type RespuestaIdempotente } from '../bd/idempotencia.js';
import type { BaseDeDatos } from '../bd/pool.js';
import type { Consultar } from '../bd/transaccion.js';
import { SinPermiso, SolicitudInvalida } from '../errores.js';
import type { Cliente, ClienteCambios, ClienteNuevo } from './modelo.js';
import { actualizarPerfil, crearPerfil, obtenerPerfil } from './repositorio.js';

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
