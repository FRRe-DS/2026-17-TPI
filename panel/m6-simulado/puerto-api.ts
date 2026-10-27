import type { FastifyInstance } from 'fastify';

// El puerto de la API del M6 simulado, que el modo caído cierra y el modo normal vuelve a abrir. Una app de Fastify no se puede
// volver a abrir después de `close()`, así que cada apertura arma una nueva con `construir`; los viajes viven en el estado, que
// es de afuera, y no se pierden.

export type PuertoApi = { abrir(): Promise<void>; cerrar(): Promise<void> };

export type OpcionesPuertoApi = { puerto: number; escucha: string; construir: () => FastifyInstance };

export function crearPuertoApi({ puerto, escucha, construir }: OpcionesPuertoApi): PuertoApi {
  let abierta: FastifyInstance | undefined;

  return {
    // Abrirlo estando abierto no hace nada.
    async abrir() {
      if (abierta !== undefined) return;
      const app = construir();
      try {
        await app.listen({ port: puerto, host: escucha });
      } catch (error) {
        await app.close();
        throw error;
      }
      abierta = app;
    },
    // Cerrarlo estando cerrado no hace nada. Corta también los pedidos en espera (la API se arma con `forceCloseConnections`).
    async cerrar() {
      const app = abierta;
      abierta = undefined;
      await app?.close();
    },
  };
}
