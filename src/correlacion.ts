import { randomUUID } from 'node:crypto';

// RNF-14.3: de 1 a 128 caracteres de letras, números, punto, guion bajo y guion.
const ID_VALIDO = /^[A-Za-z0-9._-]{1,128}$/;

// El identificador de correlación de una solicitud: el valor del encabezado si cumple el patrón; si no (ausente, vacío,
// largo, con otros caracteres o repetido, que Node entrega unido con «, »), un UUID nuevo. Lo que llega se valida porque
// vuelve en las respuestas y llega a los logs.
export function idCorrelacion(valor: string | string[] | undefined): string {
  return typeof valor === 'string' && ID_VALIDO.test(valor) ? valor : randomUUID();
}
