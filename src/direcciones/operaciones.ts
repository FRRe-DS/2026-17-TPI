import type { FastifyRequest } from 'fastify';
import type { Identidad } from '../auth/tokens.js';
import type { Manejador } from '../contrato/operaciones.js';
import type { DireccionCambios, DireccionNueva } from './modelo.js';
import type { PedidoListado } from './repositorio.js';
import * as servicio from './servicio.js';

// Los manejadores HTTP de las operaciones de direcciones (plan, Estructura). Llegan con el token, el rol, los parámetros, los
// encabezados y el cuerpo ya validados contra el contrato (RNF-03): leen la solicitud, llaman al servicio y arman la
// respuesta. Los errores son `Problema` y los responde el manejador de errores en problem+json. No escriben logs: el texto, el
// alias, las coordenadas y la Idempotency-Key no salen de acá (RNF-19).

// Quién llama. Estas operaciones exigen token, así que `registrarPermisos` ya la dejó; si faltara, es un error del servicio.
function identidadDe(request: FastifyRequest): Identidad {
  if (request.identidad === null) throw new Error('Una operación protegida llegó sin identidad');
  return request.identidad;
}

// Los roles que admite la operación, según su security en el contrato (`registrarOperaciones`).
const rolesDe = (request: FastifyRequest): readonly string[] => request.routeOptions.config.permisos?.roles ?? [];

const parametrosDe = (request: FastifyRequest) => request.params as { clienteId: string; direccionId: string };

// GET /api/v1/clientes/{clienteId}/direcciones: 200 con una página. `page` y `size` llegan siempre: si faltan, el validador pone
// los valores por defecto del contrato; `tipo` es opcional.
export const listarDirecciones: Manejador = async (request) =>
  servicio.listarDirecciones(
    request.server.pool,
    identidadDe(request),
    rolesDe(request),
    parametrosDe(request).clienteId,
    request.query as PedidoListado,
  );

// POST /api/v1/clientes/{clienteId}/direcciones: 201 con la dirección y Location, o la respuesta guardada de la misma
// Idempotency-Key.
export const crearDireccion: Manejador = async (request, reply) => {
  const clave = request.headers['idempotency-key'] as string;
  const respuesta = await servicio.crearDireccion(
    request.server.pool,
    identidadDe(request),
    rolesDe(request),
    parametrosDe(request).clienteId,
    clave,
    request.body as DireccionNueva,
  );
  if (respuesta.ubicacion !== null) reply.header('Location', respuesta.ubicacion);
  return reply.code(respuesta.estado).send(respuesta.cuerpo);
};

// GET /api/v1/clientes/{clienteId}/direcciones/{direccionId}: 200 con la dirección.
export const obtenerDireccion: Manejador = async (request) => {
  const { clienteId, direccionId } = parametrosDe(request);
  return servicio.obtenerDireccion(request.server.pool, identidadDe(request), rolesDe(request), clienteId, direccionId);
};

// PATCH /api/v1/clientes/{clienteId}/direcciones/{direccionId}: 200 con la dirección actualizada.
export const actualizarDireccion: Manejador = async (request) => {
  const { clienteId, direccionId } = parametrosDe(request);
  return servicio.actualizarDireccion(
    request.server.pool,
    identidadDe(request),
    rolesDe(request),
    clienteId,
    direccionId,
    request.body as DireccionCambios,
  );
};

// DELETE /api/v1/clientes/{clienteId}/direcciones/{direccionId}: 204 sin cuerpo.
export const eliminarDireccion: Manejador = async (request, reply) => {
  const { clienteId, direccionId } = parametrosDe(request);
  await servicio.eliminarDireccion(request.server.pool, identidadDe(request), rolesDe(request), clienteId, direccionId);
  return reply.code(204).send();
};
