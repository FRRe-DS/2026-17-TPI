import type { components } from '../generado/contrato.js';

// Los esquemas del contrato (RNF-03): la API habla con estas formas, así que son también las del dominio.
export type Cliente = components['schemas']['Cliente'];
export type ClienteNuevo = components['schemas']['ClienteNuevo'];
export type ClienteCambios = components['schemas']['ClienteCambios'];

// Una fila del perfil como la entrega `repositorio.ts`: `fecha_nacimiento` ya como texto AAAA-MM-DD (pg lo daría como un
// `Date` a medianoche de la zona del proceso, y la fecha podría correrse un día), y `bloqueado`, si el cliente tiene al menos
// un bloqueo vigente. Las marcas de tiempo llegan como `Date`.
export type FilaCliente = {
  cliente_id: string;
  nombre: string;
  apellido: string;
  telefono: string;
  fecha_nacimiento: string | null;
  creado_en: Date;
  actualizado_en: Date;
  bloqueado: boolean;
};

// De la fila al esquema `Cliente`. Sin fecha de nacimiento, el campo no está: el contrato no admite null.
export function aCliente(fila: FilaCliente): Cliente {
  return {
    clienteId: fila.cliente_id,
    nombre: fila.nombre,
    apellido: fila.apellido,
    telefono: fila.telefono,
    ...(fila.fecha_nacimiento === null ? {} : { fechaNacimiento: fila.fecha_nacimiento }),
    estado: fila.bloqueado ? 'BLOQUEADO' : 'ACTIVO',
    creadoEn: fila.creado_en.toISOString(),
    actualizadoEn: fila.actualizado_en.toISOString(),
  };
}
