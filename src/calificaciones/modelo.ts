import type { components } from '../generado/contrato.js';

// Los esquemas del contrato (RNF-03): la API habla con estas formas, así que son también las del dominio.
export type Calificacion = components['schemas']['Calificacion'];
export type CalificacionNueva = components['schemas']['CalificacionNueva'];
export type PaginaCalificaciones = components['schemas']['PaginaCalificaciones'];

// Una fila de `calificaciones` como la entrega `repositorio.ts`. `creado_en` llega como `Date` y el puntaje (smallint), como
// número. El `cliente_id` no está: la calificación se busca siempre por cliente y el contrato no lo expone.
export type FilaCalificacion = {
  calificacion_id: string;
  viaje_id: string;
  conductor_id: string;
  puntaje: number;
  comentario: string | null;
  creado_en: Date;
};

// De la fila al esquema `Calificacion` (RF-2.5, RF-2.5.10). Sin comentario, el campo no está: el contrato no admite null. Un
// comentario vacío sí está: no equivale a uno ausente (spec, Casos límite).
export function aCalificacion(fila: FilaCalificacion): Calificacion {
  return {
    calificacionId: fila.calificacion_id,
    viajeId: fila.viaje_id,
    conductorId: fila.conductor_id,
    puntaje: fila.puntaje,
    ...(fila.comentario === null ? {} : { comentario: fila.comentario }),
    creadoEn: fila.creado_en.toISOString(),
  };
}

// Una página del listado (RF-2.5.8): las calificaciones de la página, en el orden recibido, y el total del cliente. `page` y
// `size` son los pedidos; una página fuera del total tiene `items` vacío (RF-2.5.9).
export function aPaginaCalificaciones(filas: FilaCalificacion[], total: number, page: number, size: number): PaginaCalificaciones {
  return { page, size, totalElementos: total, totalPaginas: Math.ceil(total / size), items: filas.map(aCalificacion) };
}
