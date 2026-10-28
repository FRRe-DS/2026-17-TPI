import type { DatosDeError } from '../api/errores.js';

// Los textos de lo que M2 rechaza al calificar (RF-2.5.16), sin React: uno distinto según el código y el `type`. Lo que no está acá
// no tiene texto propio y la pantalla muestra solo el error de M2 completo (RNF-03.6), que de todos modos va siempre debajo.

const TYPE_DUPLICADA = '/errores/calificacion-duplicada';
const TYPE_NO_COMPLETADO = '/errores/viaje-no-completado';
const TYPE_CLAVE_REUTILIZADA = '/errores/idempotencia-reutilizada';

// El `503` de una pantalla que pide a M6 a través de M2 (RF-2.4.13, RF-2.5.16): de quién depende `que` y que no contestó.
export const dependeDeViajes = (que: string): string => `${que} depende del módulo de viajes (M6), que no contestó.`;

export function mensajeDeCalificacion(error: DatosDeError): string | undefined {
  if (error.sinRespuesta) return undefined;
  if (error.estado === 404) return 'Viaje no encontrado.';
  if (error.estado === 409 && error.type === TYPE_DUPLICADA) return 'Ya calificaste este viaje.';
  if (error.estado === 422 && error.type === TYPE_NO_COMPLETADO) return 'El viaje todavía no está completado.';
  if (error.estado === 422 && error.type === TYPE_CLAVE_REUTILIZADA) {
    return 'Esta calificación ya se envió con otros datos. Cerrá el formulario y abrilo de nuevo para enviar otra.';
  }
  if (error.estado === 503) return dependeDeViajes('Calificar');
  return undefined;
}
