import type { FastifyRequest } from 'fastify';
import type { Identidad } from '../auth/tokens.js';
import type { Manejador } from '../contrato/operaciones.js';
import type { PedidoHistorial } from './servicio.js';
import * as servicio from './servicio.js';

// El manejador HTTP de listarHistorialViajes (plan 007, Estructura). Llega con el token, el rol y los parámetros ya validados
// contra el contrato (RNF-03): lee la solicitud, llama al servicio y devuelve la página. Los errores son `Problema` y los
// responde el manejador de errores en problem+json. No escribe logs: lo que registra el servicio no trae identificadores
// de viajes, de clientes ni de conductores, y el token no sale de acá (RNF-19).

// Quién llama. Esta operación exige token, así que `registrarPermisos` ya la dejó; si faltara, es un error del servicio.
function identidadDe(request: FastifyRequest): Identidad {
  if (request.identidad === null) throw new Error('Una operación protegida llegó sin identidad');
  return request.identidad;
}

// Los roles que admite la operación, según su security en el contrato (`registrarOperaciones`).
const rolesDe = (request: FastifyRequest): readonly string[] => request.routeOptions.config.permisos?.roles ?? [];

// GET /api/v1/clientes/{clienteId}/viajes: 200 con una página. `page` y `size` llegan siempre: si faltan, el validador pone los
// valores por defecto del contrato.
export const listarHistorialViajes: Manejador = async (request) => {
  const { clienteId } = request.params as { clienteId: string };
  return servicio.listarHistorialViajes(
    request.server.pool,
    request.server.m6,
    request.log,
    identidadDe(request),
    rolesDe(request),
    clienteId,
    request.query as PedidoHistorial,
    request.id,
  );
};
