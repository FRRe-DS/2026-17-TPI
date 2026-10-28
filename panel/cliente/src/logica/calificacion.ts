import type { components } from '../generado/contrato.js';

// El formulario de calificación (RF-2.5.15), sin React: lo que se ofrece, qué se valida y qué se manda en `calificarConductor`.

type CalificacionNueva = components['schemas']['CalificacionNueva'];

export const LARGO_MAXIMO_COMENTARIO = 500;

// El puntaje de 1 a 5 del contrato, como opciones de un selector de una sola elección.
export const PUNTAJES = [1, 2, 3, 4, 5].map((n) => ({ valor: String(n), etiqueta: String(n) }));

export type CamposCalificacion = { puntaje: string; comentario: string };
export type ErroresDeCalificacion = Partial<Record<keyof CamposCalificacion, string>>;

export const CALIFICACION_NUEVA: CamposCalificacion = { puntaje: '', comentario: '' };

export function validarCalificacion({ puntaje, comentario }: CamposCalificacion): ErroresDeCalificacion {
  const errores: ErroresDeCalificacion = {};
  if (!PUNTAJES.some((opcion) => opcion.valor === puntaje)) errores.puntaje = 'Elegí un puntaje de 1 a 5.';
  if (comentario.trim().length > LARGO_MAXIMO_COMENTARIO) errores.comentario = `Hasta ${LARGO_MAXIMO_COMENTARIO} caracteres.`;
  return errores;
}

// El cuerpo de `calificarConductor`: el comentario solo si se escribió.
export function cuerpoDeCalificacion(viajeId: string, { puntaje, comentario }: CamposCalificacion): CalificacionNueva {
  const texto = comentario.trim();
  return { viajeId, puntaje: Number(puntaje), ...(texto === '' ? {} : { comentario: texto }) };
}
