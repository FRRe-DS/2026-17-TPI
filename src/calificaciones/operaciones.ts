import type { FastifyRequest } from 'fastify';
import type { Identidad } from '../auth/tokens.js';
import type { Manejador } from '../contrato/operaciones.js';
import type { CalificacionNueva } from './modelo.js';
import type { PedidoListado } from './repositorio.js';
import * as servicio from './servicio.js';

// Los manejadores HTTP de las operaciones de calificaciones (plan 008, Estructura). Llegan con el token, el rol, los parámetros,
// los encabezados y el cuerpo ya validados contra el contrato (RNF-03): leen la solicitud, llaman al servicio y arman la
// respuesta. Los errores son `Problema` y los responde el manejador de errores en problem+json. No escriben logs: el token, el
// comentario, la Idempotency-Key y los identificadores de viajes, conductores y calificaciones no salen de acá (RNF-19).

// Quién llama. Estas operaciones exigen token, así que `registrarPermisos` ya la dejó; si faltara, es un error del servicio.
function identidadDe(request: FastifyRequest): Identidad {
  if (request.identidad === null) throw new Error('Una operación protegida llegó sin identidad');
  return request.identidad;
}

// Los roles que admite la operación, según su security en el contrato (`registrarOperaciones`).
const rolesDe = (request: FastifyRequest): readonly string[] => request.routeOptions.config.permisos?.roles ?? [];

const parametrosDe = (request: FastifyRequest) => request.params as { clienteId: string; calificacionId: string };

// GET /api/v1/clientes/{clienteId}/calificaciones: 200 con una página. `page` y `size` llegan siempre: si faltan, el validador
// pone los valores por defecto del contrato.
export const listarCalificaciones: Manejador = async (request) =>
  servicio.listarCalificaciones(
    request.server.pool,
    identidadDe(request),
    rolesDe(request),
    parametrosDe(request).clienteId,
    request.query as PedidoListado,
  );

// POST /api/v1/clientes/{clienteId}/calificaciones: 201 con la calificación y Location, o la respuesta guardada de la misma
// Idempotency-Key. El id de correlación es el de la solicitud: llega a M6 en la misma cabecera (RNF-14).
export const calificarConductor: Manejador = async (request, reply) => {
  const clave = request.headers['idempotency-key'] as string;
  const respuesta = await servicio.calificarConductor(
    request.server.pool,
    request.server.m6,
    identidadDe(request),
    rolesDe(request),
    parametrosDe(request).clienteId,
    clave,
    request.body as CalificacionNueva,
    request.id,
  );
  if (respuesta.ubicacion !== null) reply.header('Location', respuesta.ubicacion);
  return reply.code(respuesta.estado).send(respuesta.cuerpo);
};

// GET /api/v1/clientes/{clienteId}/calificaciones/{calificacionId}: 200 con la calificación.
export const obtenerCalificacion: Manejador = async (request) => {
  const { clienteId, calificacionId } = parametrosDe(request);
  return servicio.obtenerCalificacion(request.server.pool, identidadDe(request), rolesDe(request), clienteId, calificacionId);
};
