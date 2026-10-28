import type { DatosDeError } from '../api/errores.js';
import type { components } from '../generado/contrato.js';

// Lo que hace la vista del operador (RF-2.6.6), sin React: buscar un cliente por su UUID, validar y armar el bloqueo y el
// levantamiento, y dar el texto de cada rechazo de M2.

type BloqueoNuevo = components['schemas']['BloqueoNuevo'];
type LevantamientoBloqueo = components['schemas']['LevantamientoBloqueo'];

export const LARGO_MAXIMO_MOTIVO = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// El operador busca al cliente por su UUID: es lo que M2 usa en la ruta.
export function validarBusqueda(texto: string): string | undefined {
  return UUID.test(texto.trim()) ? undefined : 'Escribí el UUID del cliente (por ejemplo, el de su perfil).';
}

// `hasta` es el valor de un campo `datetime-local` (`2026-12-31T23:59`, hora de quien lo escribe), vacío si no hay fin.
export type CamposBloqueo = { motivo: string; hasta: string };
export type ErroresDeBloqueo = Partial<Record<keyof CamposBloqueo, string>>;
export const BLOQUEO_NUEVO: CamposBloqueo = { motivo: '', hasta: '' };

function validarMotivo(motivo: string): string | undefined {
  const largo = motivo.trim().length;
  if (largo === 0) return 'Escribí el motivo.';
  return largo > LARGO_MAXIMO_MOTIVO ? `Hasta ${LARGO_MAXIMO_MOTIVO} caracteres.` : undefined;
}

// Motivo de 1 a 500 y, si hay fin, una fecha válida posterior a ahora. M2 repite estas reglas y responde `422` si no se cumplen;
// acá se avisan antes, junto al campo.
export function validarBloqueo({ motivo, hasta }: CamposBloqueo, ahora: Date = new Date()): ErroresDeBloqueo {
  const errores: ErroresDeBloqueo = {};
  const errorDeMotivo = validarMotivo(motivo);
  if (errorDeMotivo !== undefined) errores.motivo = errorDeMotivo;
  if (hasta.trim() !== '') {
    const fin = new Date(hasta);
    if (Number.isNaN(fin.getTime())) errores.hasta = 'Escribí una fecha y hora válidas (con el año de cuatro cifras).';
    else if (fin.getTime() <= ahora.getTime()) errores.hasta = 'El fin tiene que ser posterior a ahora.';
  }
  return errores;
}

// El fin sale como instante UTC, como lo pide el formato `date-time` del contrato.
export function cuerpoDeBloqueo({ motivo, hasta }: CamposBloqueo): BloqueoNuevo {
  return { motivo: motivo.trim(), ...(hasta.trim() === '' ? {} : { hasta: new Date(hasta).toISOString() }) };
}

export function validarLevantamiento({ motivo }: { motivo: string }): { motivo?: string } {
  const error = validarMotivo(motivo);
  return error === undefined ? {} : { motivo: error };
}

export const cuerpoDeLevantamiento = ({ motivo }: { motivo: string }): LevantamientoBloqueo => ({ motivo: motivo.trim() });

// Lo que dice el panel de lo que M2 rechaza al bloquear o levantar. El resto no tiene texto propio y se ve el error de M2 completo.
export function mensajeDeBloqueo(error: DatosDeError): string | undefined {
  if (error.estado === 404) return 'No se encontró el cliente o el bloqueo.';
  if (error.estado === 409 && error.type === '/errores/bloqueo-ya-levantado') return 'Ese bloqueo ya estaba levantado.';
  if (error.estado === 409 && error.type === '/errores/bloqueo-no-vigente') return 'Ese bloqueo ya venció por su fecha: no hace falta levantarlo.';
  if (error.estado === 422 && error.type === '/errores/bloqueo-vencido') return 'El fin del bloqueo tiene que ser posterior a ahora.';
  if (error.estado === 422 && error.type === '/errores/bloqueo-hasta-fuera-de-rango') return 'El fin del bloqueo tiene que ser anterior al año 10000.';
  if (error.estado === 422 && error.type === '/errores/idempotencia-reutilizada') {
    return 'Este bloqueo ya se registró con otros datos. Cerrá el formulario y abrilo de nuevo para registrar otro.';
  }
  return undefined;
}
