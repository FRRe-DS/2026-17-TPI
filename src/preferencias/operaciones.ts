import type { FastifyRequest } from 'fastify';
import type { Identidad } from '../auth/tokens.js';
import type { Manejador } from '../contrato/operaciones.js';
import type { Preferencias } from './modelo.js';
import * as servicio from './servicio.js';

function identidadDe(request: FastifyRequest): Identidad {
  if (request.identidad === null) throw new Error('Una operación protegida llegó sin identidad');
  return request.identidad;
}
const rolesDe = (request: FastifyRequest): readonly string[] => request.routeOptions.config.permisos?.roles ?? [];
const clienteDe = (request: FastifyRequest) => (request.params as { clienteId: string }).clienteId;

// El OpenAPI valida cuerpo y ruta. Los manejadores no registran preferencias ni tokens.
export const obtenerPreferencias: Manejador = async (request) =>
  servicio.obtenerPreferencias(request.server.pool, identidadDe(request), rolesDe(request), clienteDe(request));

export const guardarPreferencias: Manejador = async (request) =>
  servicio.guardarPreferencias(request.server.pool, identidadDe(request), rolesDe(request), clienteDe(request), request.body as Preferencias);
