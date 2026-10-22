import type { BaseDeDatos } from './bd/pool.js';
import type { Manejador } from './contrato/operaciones.js';

declare module 'fastify' {
  interface FastifyInstance {
    // La base de datos del servicio, para los manejadores: `request.server.pool.consultar(…)`. La pasa `construirApp`.
    pool: BaseDeDatos;
  }
}

// El manejador de verificarSalud (RNF-14.1): comprueba que la base responde con una consulta mínima y contesta que está bien.
// Si la base no responde en el tiempo configurado, `consultar()` lanza BaseNoDisponible y el manejador de errores contesta el
// 503 (RNF-14.2). La ruta sale solo del contrato (RNF-03.4): si no declara GET /health como verificarSalud, no existe.
export const verificarSalud: Manejador = async (request) => {
  await request.server.pool.consultar('SELECT 1');
  return { estado: 'ok' };
};
