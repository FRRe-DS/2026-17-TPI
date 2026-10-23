import type { components } from '../generado/contrato.js';

// Los esquemas del contrato (RNF-03): la API habla con estas formas, así que son también las del dominio.
export type Cliente = components['schemas']['Cliente'];
export type ClienteNuevo = components['schemas']['ClienteNuevo'];
export type ClienteCambios = components['schemas']['ClienteCambios'];
export type Bloqueo = components['schemas']['Bloqueo'];
export type EstadoCuenta = components['schemas']['EstadoCuenta'];
export type BloqueoNuevo = components['schemas']['BloqueoNuevo'];
export type LevantamientoBloqueo = components['schemas']['LevantamientoBloqueo'];
export type PaginaBloqueos = components['schemas']['PaginaBloqueos'];

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

// Una fila de bloqueo como la entrega `repositorio.ts`: `vigente` ya calculado por la base con el mismo instante que el resto
// de la consulta (RF-2.6.4), y las columnas opcionales en null. Las marcas de tiempo llegan como `Date`.
export type FilaBloqueo = {
  bloqueo_id: string;
  motivo: string;
  vigente: boolean;
  hasta: Date | null;
  creado_en: Date;
  creado_por: string;
  levantado_en: Date | null;
  levantado_por: string | null;
  motivo_levantamiento: string | null;
};

// De la fila al esquema `Bloqueo`. `desde` es `creado_en`: no se guarda otra marca (plan, Datos). Los campos opcionales sin
// valor no están: el contrato no admite null. Un bloqueo vencido por su fecha no lleva campos de levantamiento.
export function aBloqueo(fila: FilaBloqueo): Bloqueo {
  const creadoEn = fila.creado_en.toISOString();
  return {
    bloqueoId: fila.bloqueo_id,
    motivo: fila.motivo,
    vigente: fila.vigente,
    desde: creadoEn,
    ...(fila.hasta === null ? {} : { hasta: fila.hasta.toISOString() }),
    creadoEn,
    creadoPor: fila.creado_por,
    ...(fila.levantado_en === null ? {} : { levantadoEn: fila.levantado_en.toISOString() }),
    ...(fila.levantado_por === null ? {} : { levantadoPor: fila.levantado_por }),
    ...(fila.motivo_levantamiento === null ? {} : { motivoLevantamiento: fila.motivo_levantamiento }),
  };
}

// El estado de cuenta (RF-2.6): el estado sale de los mismos bloqueos vigentes que se devuelven, así que no pueden
// contradecirse. Con al menos uno es BLOQUEADO; sin ninguno, ACTIVO.
export function aEstadoCuenta(clienteId: string, vigentes: FilaBloqueo[]): EstadoCuenta {
  return {
    clienteId,
    estado: vigentes.length > 0 ? 'BLOQUEADO' : 'ACTIVO',
    bloqueosVigentes: vigentes.map(aBloqueo),
  };
}

// Una página del historial (RF-2.6.2): los bloqueos de la página, en el orden recibido, y los totales del filtro. `page` y
// `size` son los pedidos; una página fuera del total tiene `items` vacío.
export function aPaginaBloqueos(filas: FilaBloqueo[], total: number, page: number, size: number): PaginaBloqueos {
  return { page, size, totalElementos: total, totalPaginas: Math.ceil(total / size), items: filas.map(aBloqueo) };
}
