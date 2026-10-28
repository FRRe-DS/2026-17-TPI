import type { DatosDeError } from '../api/errores.js';

// Lo que dice «Mis calificaciones» (RF-2.5.17), sin React.

export const textoDePuntaje = (puntaje: number): string => `${puntaje} de 5`;

// El detalle de una calificación que no es de quien la pide o no existe: M2 responde `404` en los dos casos para no revelar cuál es,
// y el panel dice lo mismo. Lo demás se muestra solo con el error de M2 completo (RNF-03.6).
export function mensajeDeDetalle(error: DatosDeError): string | undefined {
  return error.estado === 404 ? 'Calificación no encontrada.' : undefined;
}
