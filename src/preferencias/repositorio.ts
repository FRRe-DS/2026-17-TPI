import type { Consultar } from '../bd/transaccion.js';
import { NoEncontrado } from '../errores.js';
import { aPreferencias, preferenciasPredeterminadas, type FilaPreferencias, type Preferencias } from './modelo.js';

// Una sola instantánea distingue perfil inexistente de perfil sin preferencias.
// El LEFT JOIN nunca escribe para fabricar los valores predeterminados.
export async function obtenerPreferencias(consultar: Consultar, clienteId: string): Promise<Preferencias> {
  const { rows } = await consultar<FilaPreferencias & { cliente_preferencias: string | null }>(
    `SELECT p.cliente_id AS cliente_preferencias, p.tipos_vehiculo, p.canales, p.accesibilidad, p.observaciones_accesibilidad
     FROM clientes c LEFT JOIN preferencias_cliente p ON p.cliente_id = c.cliente_id WHERE c.cliente_id = $1`,
    [clienteId],
  );
  const fila = rows[0];
  if (fila === undefined) throw new NoEncontrado('No existe el cliente pedido');
  return fila.cliente_preferencias === null ? preferenciasPredeterminadas() : aPreferencias(fila);
}

// PUT reemplaza las cuatro columnas en una sola sentencia. PostgreSQL serializa
// los conflictos por la PK: nunca hay una mezcla de solicitudes ni un 23505 por competir.
// El SELECT exige perfil en la misma sentencia; sin él no se intenta insertar una FK inválida.
export async function guardarPreferencias(consultar: Consultar, clienteId: string, datos: Preferencias): Promise<Preferencias> {
  const { rows } = await consultar<FilaPreferencias>(
    `INSERT INTO preferencias_cliente (cliente_id, tipos_vehiculo, canales, accesibilidad, observaciones_accesibilidad)
     SELECT c.cliente_id, $2::text[], $3::text[], $4::text[], $5::text FROM clientes c WHERE c.cliente_id = $1
     ON CONFLICT (cliente_id) DO UPDATE SET
       tipos_vehiculo = EXCLUDED.tipos_vehiculo,
       canales = EXCLUDED.canales,
       accesibilidad = EXCLUDED.accesibilidad,
       observaciones_accesibilidad = EXCLUDED.observaciones_accesibilidad
     RETURNING tipos_vehiculo, canales, accesibilidad, observaciones_accesibilidad`,
    [clienteId, datos.tiposVehiculo, datos.canales, datos.accesibilidad, datos.observacionesAccesibilidad ?? null],
  );
  const fila = rows[0];
  if (fila === undefined) throw new NoEncontrado('No existe el cliente pedido');
  return aPreferencias(fila);
}
