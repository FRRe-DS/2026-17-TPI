import type { components } from '../generado/contrato.js';

// Los esquemas del contrato (RNF-03): la API habla con estas formas, así que son también las del dominio.
export type Direccion = components['schemas']['Direccion'];
export type DireccionNueva = components['schemas']['DireccionNueva'];
export type TipoDireccion = components['schemas']['TipoDireccion'];
export type PaginaDirecciones = components['schemas']['PaginaDirecciones'];

// Una fila de `direcciones_cliente` como la entrega `repositorio.ts`. pg devuelve `numeric` como texto, para no perder precisión,
// así que las coordenadas llegan como texto y `aDireccion` las pasa a número. `creado_en` llega como `Date`. El `cliente_id` no
// está: la dirección se busca siempre por cliente y el contrato no lo expone.
export type FilaDireccion = {
  direccion_id: string;
  tipo: TipoDireccion;
  alias: string | null;
  texto: string;
  latitud: string | null;
  longitud: string | null;
  creado_en: Date;
};

// De la fila al esquema `Direccion` (RF-2.2.2). Sin alias o sin coordenadas, el campo no está: el contrato no admite null. Un
// alias vacío sí está: no equivale a uno ausente (spec, Casos límite). La base garantiza que las coordenadas están las dos o
// ninguna (`direcciones_cliente_coordenadas_validas`).
export function aDireccion(fila: FilaDireccion): Direccion {
  return {
    direccionId: fila.direccion_id,
    tipo: fila.tipo,
    ...(fila.alias === null ? {} : { alias: fila.alias }),
    texto: fila.texto,
    ...(fila.latitud === null || fila.longitud === null
      ? {}
      : { coordenadas: { latitud: Number(fila.latitud), longitud: Number(fila.longitud) } }),
    creadoEn: fila.creado_en.toISOString(),
  };
}

// Una página del listado (RF-2.2.1): las direcciones de la página, en el orden recibido, y los totales del filtro. `page` y `size`
// son los pedidos; una página fuera del total tiene `items` vacío.
export function aPaginaDirecciones(filas: FilaDireccion[], total: number, page: number, size: number): PaginaDirecciones {
  return { page, size, totalElementos: total, totalPaginas: Math.ceil(total / size), items: filas.map(aDireccion) };
}
