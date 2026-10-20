import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

// Amplía el contexto compartido con la URL de la base del contenedor de integración.
declare module 'vitest' {
  export interface ProvidedContext {
    urlBd: string;
  }
}

let contenedor: StartedPostgreSqlContainer;

export async function setup(project: TestProject): Promise<void> {
  contenedor = await new PostgreSqlContainer('postgres:18.6').start();
  project.provide('urlBd', contenedor.getConnectionUri());
}

export async function teardown(): Promise<void> {
  await contenedor.stop();
}
