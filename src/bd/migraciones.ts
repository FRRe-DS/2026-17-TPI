import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { Client } from 'pg';

// Relativa a este archivo: vale desde src/ (pruebas) y desde dist/ (servicio), porque las dos están al lado de migraciones/.
const DIR_MIGRACIONES = fileURLToPath(new URL('../../migraciones', import.meta.url));

// La tabla donde node-pg-migrate anota cada migración que aplicó; la crea la primera vez (plan, Datos).
const TABLA_MIGRACIONES = 'migraciones_aplicadas';

// Lo que puede durar toda la fase, desde que se abre la conexión hasta que termina la última migración (RNF-05.3).
const PLAZO_MIGRACIONES_MS = 60_000;

export type OpcionesMigrar = {
  urlBd: string;
  // Lo que se espera a que la conexión con la base quede lista (M2_TIEMPO_BD_MS). Sin ese límite, pg espera para siempre
  // a una base que acepta la conexión y no contesta.
  tiempoBdMs: number;
  // Las pruebas lo acortan.
  plazoMs?: number;
  // Las pruebas usan carpetas propias, con migraciones que fallan, que tardan o que llegan fuera de orden.
  dir?: string;
  // Recibe lo que cuenta node-pg-migrate. Sin él no se escribe nada: la salida estándar solo lleva logs en JSON (RNF-14.5).
  log?: (mensaje: string) => void;
  // La señal de parada que llega durante el arranque (RNF-04.5): si se aborta, migrar() deja de esperar, como con el plazo.
  parada?: AbortSignal;
};

const interrumpidas = () => new Error('Las migraciones se interrumpieron por la parada');

// El esquema cambia solo con migraciones versionadas (RNF-05.1): aplica en orden las que faltan, cada una una sola vez,
// y devuelve el nombre de las que aplicó (ninguno si ya estaban todas). Abre su propia conexión y la cierra al terminar.
// Si la fase no termina en el plazo, o llega la parada, cierra la conexión sin esperar a la migración en curso y falla
// (RNF-05.3, RNF-04.5). Con la parada ya abortada, falla sin conectarse.
export async function migrar({
  urlBd,
  tiempoBdMs,
  plazoMs = PLAZO_MIGRACIONES_MS,
  dir = DIR_MIGRACIONES,
  log = () => {},
  parada,
}: OpcionesMigrar): Promise<string[]> {
  if (parada?.aborted) throw interrumpidas();
  const cliente = new Client({ connectionString: urlBd, connectionTimeoutMillis: tiempoBdMs });
  // Si la base corta la conexión (un reinicio, pg_terminate_backend), pg emite 'error' y, sin oyente, el proceso se cae con
  // una traza y sin la línea JSON del motivo (RNF-05.3, RNF-14.5). No hace falta hacer nada más: la consulta en curso, o la
  // siguiente, falla con el corte, y migrar() lo devuelve como cualquier otro error.
  cliente.on('error', () => {});
  const cortado = Promise.withResolvers<never>();
  // Con una consulta en curso, end() corta el socket en el acto. La base deshace la migración y suelta el bloqueo cuando
  // termina la sentencia que estaba corriendo y ve que la conexión ya no está.
  const cortar = (motivo: Error) => {
    void cliente.end();
    cortado.reject(motivo);
  };
  const plazo = setTimeout(() => cortar(new Error(`Las migraciones no terminaron en ${plazoMs} ms`)), plazoMs);
  const alAbortar = () => cortar(interrumpidas());
  parada?.addEventListener('abort', alAbortar, { once: true });
  try {
    return await Promise.race([aplicarPendientes(cliente, dir, log), cortado.promise]);
  } finally {
    clearTimeout(plazo);
    parada?.removeEventListener('abort', alAbortar);
  }
}

// Lo que cubre el plazo: conectar, esperar el bloqueo, aplicar las pendientes y cerrar la conexión.
async function aplicarPendientes(cliente: Client, dir: string, log: (mensaje: string) => void): Promise<string[]> {
  try {
    await cliente.connect();
    const aplicadas = await runner({
      dbClient: cliente,
      dir,
      migrationsTable: TABLA_MIGRACIONES,
      direction: 'up',
      // Aplica una pendiente aunque ya haya otras más nuevas aplicadas: las specs se mergean en cualquier orden (plan,
      // Decisiones). Con el valor por defecto, node-pg-migrate aborta.
      checkOrder: false,
      // Un segundo proceso espera a que el primero suelte el bloqueo (RNF-05.2). Con el valor por defecto de la versión
      // 9, 'fail', fallaría.
      advisoryLockMode: 'wait',
      log,
    });
    return aplicadas.map((migracion) => migracion.name);
  } finally {
    await cliente.end();
  }
}
