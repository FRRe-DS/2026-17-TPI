import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

// La imagen de la base de las pruebas de integración: la misma, con su versión exacta, que usa docker compose (RNF-04.1).
export const IMAGEN_POSTGRES = 'postgres:18.6';

declare module 'vitest' {
  export interface ProvidedContext {
    // La URL de la base que viene con el contenedor. Cada archivo de prueba crea la suya adentro (pruebas/ayudas/bd.ts).
    urlBd: string;
  }
}

// Un solo contenedor por corrida (RNF-07.1): se levanta antes de la primera prueba de integración y se descarta al
// terminar. Vitest corre esto una vez, en su proceso, y las pruebas reciben la URL con inject('urlBd'). Si Docker no
// está, falla acá, antes de correr nada; las unitarias no pasan por este archivo.
export default async function levantarBase(proyecto: TestProject) {
  const contenedor = await new PostgreSqlContainer(IMAGEN_POSTGRES).start();
  proyecto.provide('urlBd', contenedor.getConnectionUri());
  return async () => {
    await contenedor.stop();
  };
}
