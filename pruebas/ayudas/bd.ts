import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { inject } from 'vitest';

export type BaseDePrueba = { urlBd: string; borrar: () => Promise<void> };

// Ejecuta una sentencia con la conexión del contenedor (la base que trae por defecto), que puede crear y borrar bases.
async function comoAdministrador(sql: string): Promise<void> {
  const cliente = new Client({ connectionString: inject('urlBd') });
  await cliente.connect();
  try {
    await cliente.query(sql);
  } finally {
    await cliente.end();
  }
}

// Una base nueva y vacía dentro del contenedor de la corrida. Los archivos de prueba corren en paralelo y comparten el
// contenedor, pero no la base: así cada uno (o cada prueba) parte sin los rastros de las demás. Hay que llamar a
// `borrar()` al terminar.
export async function crearBaseDePrueba(): Promise<BaseDePrueba> {
  const nombre = `prueba_${randomBytes(8).toString('hex')}`;
  await comoAdministrador(`CREATE DATABASE "${nombre}"`);
  const url = new URL(inject('urlBd'));
  url.pathname = `/${nombre}`;
  return {
    urlBd: url.toString(),
    // FORCE corta las conexiones que la prueba haya dejado abiertas.
    borrar: () => comoAdministrador(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`),
  };
}
