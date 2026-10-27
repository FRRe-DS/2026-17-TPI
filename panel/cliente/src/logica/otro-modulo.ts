import type { DatosDeError } from '../api/errores.js';

// Lo que dice la vista de otro módulo (RF-2.6.7), sin React. Lo que no tiene frase propia se ve solo con el error de M2 completo.
export function mensajeDeConsulta(error: DatosDeError): string | undefined {
  if (error.estado === 404) return 'No hay un cliente con ese UUID.';
  if (error.estado === 403) return 'M2 no deja a este módulo consultar el estado de cuenta.';
  return undefined;
}
