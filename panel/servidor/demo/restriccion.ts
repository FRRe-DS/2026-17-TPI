import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { motivoDeFalla, type ConteoFilas } from './base.js';

// La prueba de la restricción del puntaje (spec 072, T3; RNF-05.5): se intenta guardar una calificación con puntaje 9 y se espera
// que la base la rechace con su propio CHECK, `calificaciones_puntaje_valido`, aunque M2 ya valide el puntaje antes. La
// transacción nunca se confirma: se deshace siempre, así que la prueba no deja nada. Si el proceso cae a mitad, PostgreSQL la
// descarta al cerrarse la conexión (plan, Lógica).

export const RESTRICCION_ESPERADA = 'calificaciones_puntaje_valido';

export type ResultadoRestriccion = {
  clienteId: string;
  // Las calificaciones del cliente antes y después. `null`: no se pudo contar (la base no responde o no está configurada).
  filasAntes: number | null;
  filasDespues: number | null;
  // Lo que informó PostgreSQL al rechazar la inserción: su restricción, su código y su mensaje.
  restriccion?: string;
  codigo?: string;
  mensaje?: string;
  cumple: boolean;
};

// Lo que necesita: una conexión y el conteo. `crearBaseDemo` lo cumple; una prueba pasa un pool de mentira.
export type AccesoRestriccion = {
  pool: Pick<pg.Pool, 'connect'> | undefined;
  contarCalificaciones: (clienteId: string) => Promise<ConteoFilas>;
};

type Intento = Pick<ResultadoRestriccion, 'restriccion' | 'codigo' | 'mensaje'>;

// Un puntaje fuera del 1 a 5. La clave foránea exige un cliente que exista: lo crea quien llama, por M2.
const INSERTAR_PUNTAJE_INVALIDO = `INSERT INTO calificaciones (calificacion_id, cliente_id, viaje_id, conductor_id, puntaje)
  VALUES ($1, $2, $3, $4, 9)`;

async function intentar(pool: Pick<pg.Pool, 'connect'>, clienteId: string): Promise<Intento> {
  let conexion: pg.PoolClient;
  try {
    conexion = await pool.connect();
  } catch (error) {
    return { mensaje: motivoDeFalla(error) };
  }

  let descartarConexion = false;
  try {
    await conexion.query('BEGIN');
    await conexion.query(INSERTAR_PUNTAJE_INVALIDO, [randomUUID(), clienteId, randomUUID(), randomUUID()]);
    return { mensaje: 'la base aceptó el puntaje 9: falta la restricción' };
  } catch (error) {
    // El mensaje de PostgreSQL ("violates check constraint …") es lo que se quiere mostrar. Cualquier otro error (de red, de
    // tiempo) se informa solo por su código, porque su mensaje puede traer la dirección de la base (RNF-19.4).
    if (error instanceof pg.DatabaseError) return { codigo: error.code, restriccion: error.constraint, mensaje: error.message };
    return { mensaje: motivoDeFalla(error) };
  } finally {
    // Siempre se deshace. Si ni eso se pudo, la conexión no se devuelve al pool: podría tener la transacción abierta.
    try {
      await conexion.query('ROLLBACK');
    } catch {
      descartarConexion = true;
    }
    conexion.release(descartarConexion);
  }
}

export async function probarRestriccion(base: AccesoRestriccion, clienteId: string): Promise<ResultadoRestriccion> {
  const antes = await base.contarCalificaciones(clienteId);
  if (base.pool === undefined || antes.filas === null) {
    return { clienteId, filasAntes: null, filasDespues: null, mensaje: antes.motivo ?? 'la base no está disponible', cumple: false };
  }

  const intento = await intentar(base.pool, clienteId);
  const despues = await base.contarCalificaciones(clienteId);

  return {
    clienteId,
    filasAntes: antes.filas,
    filasDespues: despues.filas,
    ...intento,
    cumple: intento.restriccion === RESTRICCION_ESPERADA && despues.filas === antes.filas,
  };
}
