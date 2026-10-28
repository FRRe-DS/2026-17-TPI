import pg from 'pg';

// El acceso del panel a la base de M2, solo para la vista de demostración (spec 072, plan «Datos», ADR 072). Son dos conteos fijos
// y la prueba de la restricción (T3): SQL escrito acá, siempre con parámetros, nunca armado con texto del navegador (RNF-05.4).
// El panel no guarda nada en esa base.

// Una cosa que está o no está, con el motivo y qué hacer cuando no está. Es lo que la vista muestra junto al botón (RNF-13.6).
export type Disponibilidad = { disponible: boolean; motivo?: string; comoActivar?: string };

// Un conteo de filas. `filas: null` quiere decir que no se pudo contar, y `motivo` por qué.
export type ConteoFilas = { filas: number | null; motivo?: string };

// Como el pool de M2, chico y con cortes: una base que no contesta no deja colgada la vista (plan, Datos).
const CONEXIONES_MAXIMAS = 2;
const ESPERA_CONEXION_MS = 2000;
const CORTE_SENTENCIA_MS = 2000;
const CORTE_CONSULTA_MS = 2500;

const NO_CONFIGURADA: Disponibilidad = {
  disponible: false,
  motivo: 'no configurada (PANEL_URL_BD)',
  comoActivar: 'Definí PANEL_URL_BD con la conexión a la base de M2; con el perfil panel de compose, el panel en la máquina la toma de ejemplo.env.',
};

// Los mensajes con los que pg informa que se agotó el tiempo y que no traen código.
const MENSAJES_DE_TIEMPO = ['timeout exceeded when trying to connect', 'Query read timeout', 'Connection terminated due to connection timeout'];

// Por qué falló, sin lo que puede traer un secreto. El mensaje de un error de red de Node trae la dirección (`connect ECONNREFUSED
// 127.0.0.1:5433`) y el de la base puede traer el usuario: no se usa nunca. Solo el código (`ECONNREFUSED`, el SQLSTATE `28P01`)
// o, si no lo tiene, que se agotó el tiempo (RNF-19.4).
export function motivoDeFalla(error: unknown): string {
  const codigo = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (typeof codigo === 'string' && codigo !== '') return `la base no responde (${codigo})`;
  if (error instanceof Error && MENSAJES_DE_TIEMPO.some((mensaje) => error.message.startsWith(mensaje))) return 'la base no responde (tiempo agotado)';
  return 'la base no responde (sin código)';
}

// Con `urlBd` indefinida no se crea ningún pool: no hay a qué conectarse.
export function crearBaseDemo(urlBd: string | undefined) {
  const pool =
    urlBd === undefined
      ? undefined
      : new pg.Pool({
          connectionString: urlBd,
          max: CONEXIONES_MAXIMAS,
          connectionTimeoutMillis: ESPERA_CONEXION_MS,
          statement_timeout: CORTE_SENTENCIA_MS,
          query_timeout: CORTE_CONSULTA_MS,
        });
  // Una conexión inactiva que se corta (la base se apagó) emite 'error' y, sin quien lo atienda, tumba el proceso. Se descarta:
  // el próximo pedido lo informa con su motivo.
  pool?.on('error', () => {});

  async function contar(sql: string, clienteId: string): Promise<ConteoFilas> {
    if (pool === undefined) return { filas: null, motivo: NO_CONFIGURADA.motivo };
    try {
      const resultado = await pool.query<{ filas: number }>(sql, [clienteId]);
      return { filas: resultado.rows[0]?.filas ?? 0 };
    } catch (error) {
      return { filas: null, motivo: motivoDeFalla(error) };
    }
  }

  return {
    // Solo lectura y para los resultados de T3 en adelante: la prueba de la restricción necesita su propia conexión.
    pool,

    contarClientes: (clienteId: string) => contar('SELECT count(*)::int AS filas FROM clientes WHERE cliente_id = $1', clienteId),

    contarCalificaciones: (clienteId: string) =>
      contar('SELECT count(*)::int AS filas FROM calificaciones WHERE cliente_id = $1', clienteId),

    async disponibilidad(): Promise<Disponibilidad> {
      if (pool === undefined) return NO_CONFIGURADA;
      try {
        await pool.query('SELECT 1');
        return { disponible: true };
      } catch (error) {
        return { disponible: false, motivo: motivoDeFalla(error) };
      }
    },

    async cerrar(): Promise<void> {
      await pool?.end();
    },
  };
}
