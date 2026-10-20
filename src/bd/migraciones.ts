// src/bd/migraciones.ts
// Aplica las migraciones pendientes con node-pg-migrate (RNF-05.1, RNF-05.2, RNF-05.3).
import pg from 'pg';
import { runner } from 'node-pg-migrate';

export type OpcionesMigrar = {
  urlBd: string;
  tiempoBdMs: number;
  plazoMs?: number;
  log?: (msg: string) => void;
};

// Aplica las migraciones pendientes de la carpeta `migraciones/` sobre la base indicada.
//
// Abre su propio pg.Client (con connectionTimeoutMillis = tiempoBdMs) y lo cierra al terminar.
// Si toda la fase no termina en plazoMs (por defecto 60 s), cierra el cliente de inmediato y
// lanza un error. La base deshace la migración en curso y libera el bloqueo de asesoría porque
// ambos dependen de esa conexión (RNF-05.3).
//
// Opciones de runner usadas deliberadamente:
//   advisoryLockMode: 'wait'  — el valor por defecto en v9 es 'fail'; con 'wait' un segundo
//                               proceso espera en vez de fallar (RNF-05.2).
//   checkOrder: false         — aplica las pendientes aunque haya migraciones más nuevas ya
//                               aplicadas (ver Decisiones del plan).
//   singleTransaction: false  — cada migración corre en su propia transacción; si una falla,
//                               no deja cambios a medias (RNF-05.2).
export async function migrar({ urlBd, tiempoBdMs, plazoMs = 60000, log }: OpcionesMigrar): Promise<void> {
  const cliente = new pg.Client({ connectionString: urlBd, connectionTimeoutMillis: tiempoBdMs });
  await cliente.connect();

  const plazo = new Promise<never>((_res, rej) =>
    setTimeout(() => {
      void cliente.end();
      rej(new Error(`migrar(): plazo de ${plazoMs} ms superado`));
    }, plazoMs),
  );

  try {
    await Promise.race([
      runner({
        dbClient: cliente,
        dir: 'migraciones',
        migrationsTable: 'migraciones_aplicadas',
        direction: 'up',
        checkOrder: false,
        advisoryLockMode: 'wait',
        log: log ?? (() => {}),
      }),
      plazo,
    ]);
  } finally {
    await cliente.end().catch(() => {
      // Ya fue cerrado por el plazo.
    });
  }
}
