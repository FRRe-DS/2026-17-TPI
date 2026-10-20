import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { Client } from 'pg';

// Relativa a este archivo: vale desde src/ (pruebas) y desde dist/ (servicio), porque las dos están al lado de migraciones/.
const DIR_MIGRACIONES = fileURLToPath(new URL('../../migraciones', import.meta.url));

// La tabla donde node-pg-migrate anota cada migración que aplicó; la crea la primera vez (plan, Datos).
const TABLA_MIGRACIONES = 'migraciones_aplicadas';

export type OpcionesMigrar = {
  urlBd: string;
  // Recibe lo que cuenta node-pg-migrate. Sin él no se escribe nada: la salida estándar solo lleva logs en JSON (RNF-14.5).
  log?: (mensaje: string) => void;
};

// El esquema cambia solo con migraciones versionadas (RNF-05.1): aplica en orden las que faltan, cada una una sola vez,
// y devuelve el nombre de las que aplicó (ninguno si ya estaban todas). Abre su propia conexión y la cierra al terminar.
export async function migrar({ urlBd, log = () => {} }: OpcionesMigrar): Promise<string[]> {
  const cliente = new Client({ connectionString: urlBd });
  await cliente.connect();
  try {
    const aplicadas = await runner({
      dbClient: cliente,
      dir: DIR_MIGRACIONES,
      migrationsTable: TABLA_MIGRACIONES,
      direction: 'up',
      log,
    });
    return aplicadas.map((migracion) => migracion.name);
  } finally {
    await cliente.end();
  }
}
