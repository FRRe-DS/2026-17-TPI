import type { FastifyInstance } from 'fastify';
import type { BaseDeDatos } from './bd/pool.js';
import type { Manejador, Operacion } from './contrato/operaciones.js';

declare module 'fastify' {
  interface FastifyInstance {
    // La base de datos del servicio, para los manejadores: `request.server.pool.consultar(…)`. La pasa `construirApp`.
    pool: BaseDeDatos;
  }
}

const METODO_SALUD = 'GET';
const RUTA_SALUD = '/health';

// El manejador de verificarSalud (RNF-14.1): comprueba que la base responde con una consulta mínima y contesta que está bien.
// Si la base no responde en el tiempo configurado, `consultar()` lanza BaseNoDisponible y el manejador de errores contesta el
// 503 (RNF-14.2). Es el mismo cuando la ruta sale del contrato y cuando se registra a mano.
export const verificarSalud: Manejador = async (request) => {
  await request.server.pool.consultar('SELECT 1');
  return { estado: 'ok' };
};

// GET /health es una excepción temporal fuera del contrato (RNF-03.4, ADR de la base): si el contrato la tiene y la operación
// tiene manejador, `registrarOperaciones` ya la registró y no se hace nada; si no, se registra acá, pública (RNF-12.1) y con
// `verificarSalud`. Va después de `registrarPermisos`, para que el hook vea que declara sus permisos, y antes de las rutas 405,
// para que `POST /health` dé 405 con `Allow: GET`.
export function registrarSaludAMano(app: FastifyInstance, implementadas: readonly Operacion[]): void {
  if (implementadas.some(({ metodo, ruta }) => metodo === METODO_SALUD && ruta === RUTA_SALUD)) return;
  app.route({
    method: METODO_SALUD,
    url: RUTA_SALUD,
    config: { permisos: { publica: true, roles: [] } },
    handler: verificarSalud,
  });
}
