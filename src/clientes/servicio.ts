import { randomUUID } from 'node:crypto';
import type { Identidad } from '../auth/tokens.js';
import { conIdempotencia, type RespuestaIdempotente } from '../bd/idempotencia.js';
import type { BaseDeDatos } from '../bd/pool.js';
import type { Consultar } from '../bd/transaccion.js';
import { BloqueoHastaFueraDeRango, SinPermiso, SolicitudInvalida } from '../errores.js';
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

// Un date-time como lo admite el validador del contrato (Ajv, RFC 3339): separador `T`, `t` o espacio; segundo 60 solo en el
// último minuto UTC del día; fracción de cualquier largo; y `Z`, `z` o un desplazamiento ±HH, ±HHMM o ±HH:MM de hasta 23:59.
const FECHA_HORA = /^(\d{4})-(\d\d)-(\d\d)[Tt\s](\d\d):(\d\d):(\d\d)(?:\.(\d+))?(?:[Zz]|([+-])(\d\d)(?::?(\d\d))?)$/;

// El primer y el último milisegundo que se pueden escribir con el año en cuatro cifras, como pide el formato del contrato. Antes
// del primero hay que usar setUTCFullYear: Date.UTC tomaría el año 1 como 1901.
const PRIMER_INSTANTE = new Date(0).setUTCFullYear(1, 0, 1);
const ULTIMO_INSTANTE = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

// El instante de `texto`, un date-time ya validado contra el contrato, en milisegundos UTC. No se le deja a PostgreSQL, que
// rechaza los desplazamientos de más de ±15:59 que el contrato admite (sería un 500), ni a Date.parse, que no lee el
// separador en minúscula ni el segundo 60. La fracción se corta al milisegundo, la precisión con la que se responde. El año va
// con setUTCFullYear: Date.UTC tomaría 0099 como 1999. El segundo 60 pasa al minuto siguiente, como en PostgreSQL.
export function instanteUtc(texto: string): number {
  const partes = FECHA_HORA.exec(texto);
  if (partes === null) throw new Error('Un date-time llegó sin pasar por el validador del contrato');
  const [, año, mes, dia, hora, minuto, segundo, fraccion = '', signo, horasDesp = '0', minutosDesp = '0'] = partes;
  const instante = new Date(0);
  instante.setUTCFullYear(Number(año), Number(mes) - 1, Number(dia));
  instante.setUTCHours(Number(hora), Number(minuto), Number(segundo), Number(fraccion.slice(0, 3).padEnd(3, '0')));
  const desplazamiento = (Number(horasDesp) * 60 + Number(minutosDesp)) * 60_000;
  return instante.getTime() - (signo === '-' ? -desplazamiento : signo === '+' ? desplazamiento : 0);
}

// Que la fecha de nacimiento enviada, si la hay, se pueda guardar (RF-2.1.4). El formato `date` del contrato admite el año
// 0000 y PostgreSQL no (sería un 500 con la fecha en el log). Basta mirar el año: el formato ya garantiza AAAA-MM-DD, y del
// 0001 al 9999 PostgreSQL los acepta todos. Va antes que todo lo demás, como una validación más del contrato. El mensaje
// no lleva la fecha (RNF-19).
function exigirFechaGuardable(fechaNacimiento: string | undefined): void {
  if (fechaNacimiento?.startsWith('0000')) {
    throw new SolicitudInvalida('La fecha de nacimiento tiene que ser del año 0001 o posterior');
  }
}

// `consultar` del pool, para el repositorio: es un método y necesita su `this`.
const delPool =
  (pool: BaseDeDatos): Consultar =>
  (sql, parametros) =>
    pool.consultar(sql, parametros);

// Crea el perfil de quien llama (RF-2.1) con la Idempotency-Key `clave` (RNF-08): la respuesta, 201 con Location, o la
// guardada si la solicitud se repite. 409 si ya tiene perfil (RF-2.1.3) y 422 si la clave se usó con otro cuerpo. Una
// fecha de nacimiento que no se puede guardar es un 400 antes de la idempotencia: nunca pudo crearse (RF-2.1.4).
export async function crearCliente(
  pool: BaseDeDatos,
  identidad: Identidad,
  clave: string,
  datos: ClienteNuevo,
): Promise<RespuestaIdempotente> {
  const clienteId = clienteDelToken(identidad);
  exigirFechaGuardable(datos.fechaNacimiento);
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

// Cambia los campos enviados del perfil de `clienteId` (RF-2.1.2), si quien llama es su dueño. 404 si no existe. Una
// fecha de nacimiento que no se puede guardar es un 400 antes de mirar la propiedad, como las validaciones del contrato
// (RF-2.1.4).
export async function actualizarCliente(
  pool: BaseDeDatos,
  identidad: Identidad,
  rolesOperacion: readonly string[],
  clienteId: string,
  cambios: ClienteCambios,
): Promise<Cliente> {
  exigirFechaGuardable(cambios.fechaNacimiento);
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
// `hasta` se pasa a UTC (`instanteUtc`). Antes de la idempotencia solo se rechaza lo que nunca pudo crearse: un `hasta` después
// del año 9999 en UTC (RF-2.6.1.2). Que ya haya pasado no se mira acá: si no, repetir un alta ya hecha daría 422 en vez de su
// 201 (RF-2.6.1.3), y un cliente sin perfil, 422 en vez de 404. Lo decide el repositorio, después del perfil, contra el
// instante de creación de la base (RF-2.6.1.1). Uno anterior al año 0001, que el contrato admite y PostgreSQL no lee, va como
// `-infinity`, anterior a cualquier instante. La huella guarda el cuerpo tal como llegó.
export async function crearBloqueo(
  pool: BaseDeDatos,
  identidad: Identidad,
  clienteId: string,
  clave: string,
  datos: BloqueoNuevo,
): Promise<RespuestaIdempotente> {
  const hasta = datos.hasta === undefined ? undefined : instanteUtc(datos.hasta);
  if (hasta !== undefined && hasta > ULTIMO_INSTANTE) throw new BloqueoHastaFueraDeRango();
  const enBase = hasta === undefined ? undefined : hasta < PRIMER_INSTANTE ? '-infinity' : new Date(hasta).toISOString();
  const enUtc = enBase === undefined ? datos : { ...datos, hasta: enBase };
  const cliente = normalizarUuid(clienteId);
  const solicitud = {
    operacion: 'crearBloqueo',
    sujeto: identidad.sub,
    clienteId: cliente,
    clave,
    huella: { cuerpo: datos, ruta: { clienteId: cliente } },
  };
  return conIdempotencia(pool, solicitud, async (consultar) => {
    const bloqueo = await repositorio.crearBloqueo(consultar, cliente, randomUUID(), enUtc, identidad.sub);
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
