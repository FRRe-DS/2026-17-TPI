import { createHash } from 'node:crypto';

// Los ids de los viajes de ejemplo. Se derivan del cliente y no se sortean, para que «Cargar ejemplo» repetido reponga los mismos
// viajes y no agregue otros (RF-2.1.11). Los dos primeros son fijos para todos los clientes: el viaje de otro cliente y uno que
// nunca se guarda.

export const ID_AJENO = '33333333-3333-4333-8333-333333333333';
export const ID_INEXISTENTE = '44444444-4444-4444-8444-444444444444';
// De quien es el viaje ajeno y quien conduce los de ejemplo: ninguno es un cliente de ejemplo.
export const CLIENTE_DEL_AJENO = '55555555-5555-4555-8555-555555555555';
export const CONDUCTOR_DE_EJEMPLO = '66666666-6666-4666-8666-666666666666';

// Los primeros 16 bytes del sha256 del texto con la forma de un UUID v4: versión 4 y variante RFC 4122.
export function derivarUuid(texto: string): string {
  const bytes = createHash('sha256').update(texto).digest().subarray(0, 16);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x40, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  return bytes.toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}

// Un UUID no distingue mayúsculas: el cliente se pasa a minúscula antes de derivar, y es el mismo en cualquiera de las dos.
export function idsDeEjemplo(clienteId: string): { completado: string; enCurso: string } {
  const cliente = clienteId.toLowerCase();
  return {
    completado: derivarUuid(`ejemplo|${cliente}|completado`),
    enCurso: derivarUuid(`ejemplo|${cliente}|encurso`),
  };
}
