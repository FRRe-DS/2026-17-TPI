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
