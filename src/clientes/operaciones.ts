import type { FastifyRequest } from 'fastify';
import type { Identidad } from '../auth/tokens.js';
import type { Manejador } from '../contrato/operaciones.js';
import type { BloqueoNuevo, ClienteCambios, ClienteNuevo } from './modelo.js';
import type { PedidoHistorial } from './repositorio.js';
import * as servicio from './servicio.js';

// Los manejadores HTTP de las operaciones de perfil (plan, Estructura). Llegan con el token, el rol, los parámetros, los
// encabezados y el cuerpo ya validados contra el contrato (RNF-03): leen la solicitud, llaman al servicio y arman la
// respuesta. Los errores son `Problema` y los responde el manejador de errores en problem+json. No escriben logs: los datos
// del perfil y la Idempotency-Key no salen de acá (RNF-19).

// Quién llama. Estas operaciones exigen token, así que `registrarPermisos` ya la dejó; si faltara, es un error del servicio.
function identidadDe(request: FastifyRequest): Identidad {
  if (request.identidad === null) throw new Error('Una operación protegida llegó sin identidad');
  return request.identidad;
}

// Los roles que admite la operación, según su security en el contrato (`registrarOperaciones`).
const rolesDe = (request: FastifyRequest): readonly string[] => request.routeOptions.config.permisos?.roles ?? [];

const clienteIdDe = (request: FastifyRequest): string => (request.params as { clienteId: string }).clienteId;

// POST /api/v1/clientes: 201 con el perfil y Location, o la respuesta guardada de la misma Idempotency-Key.
export const crearCliente: Manejador = async (request, reply) => {
  const clave = request.headers['idempotency-key'] as string;
  const respuesta = await servicio.crearCliente(request.server.pool, identidadDe(request), clave, request.body as ClienteNuevo);
  if (respuesta.ubicacion !== null) reply.header('Location', respuesta.ubicacion);
  return reply.code(respuesta.estado).send(respuesta.cuerpo);
};

// GET /api/v1/clientes/{clienteId}: 200 con el perfil.
export const obtenerCliente: Manejador = async (request) =>
  servicio.obtenerCliente(request.server.pool, identidadDe(request), rolesDe(request), clienteIdDe(request));

// PATCH /api/v1/clientes/{clienteId}: 200 con el perfil actualizado.
export const actualizarCliente: Manejador = async (request) =>
  servicio.actualizarCliente(
    request.server.pool,
    identidadDe(request),
    rolesDe(request),
    clienteIdDe(request),
    request.body as ClienteCambios,
  );

// GET /api/v1/clientes/{clienteId}/estado-cuenta: 200 con el estado y los bloqueos vigentes.
export const obtenerEstadoCuenta: Manejador = async (request) =>
  servicio.obtenerEstadoCuenta(request.server.pool, identidadDe(request), rolesDe(request), clienteIdDe(request));

// POST /api/v1/clientes/{clienteId}/bloqueos: 201 con el bloqueo y Location, o la respuesta guardada de la misma
// Idempotency-Key.
export const crearBloqueo: Manejador = async (request, reply) => {
  const clave = request.headers['idempotency-key'] as string;
  const respuesta = await servicio.crearBloqueo(
    request.server.pool,
    identidadDe(request),
    clienteIdDe(request),
    clave,
    request.body as BloqueoNuevo,
  );
  if (respuesta.ubicacion !== null) reply.header('Location', respuesta.ubicacion);
  return reply.code(respuesta.estado).send(respuesta.cuerpo);
};

// GET /api/v1/clientes/{clienteId}/bloqueos: 200 con una página del historial. `page` y `size` llegan siempre: si faltan,
// el validador pone los valores por defecto del contrato.
export const listarBloqueos: Manejador = async (request) =>
  servicio.listarBloqueos(request.server.pool, clienteIdDe(request), request.query as PedidoHistorial);

// GET /api/v1/clientes/{clienteId}/bloqueos/{bloqueoId}: 200 con el bloqueo.
export const obtenerBloqueo: Manejador = async (request) =>
  servicio.obtenerBloqueo(
    request.server.pool,
    clienteIdDe(request),
    (request.params as { bloqueoId: string }).bloqueoId,
  );
