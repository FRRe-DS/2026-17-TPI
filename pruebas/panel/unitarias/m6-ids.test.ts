import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { derivarUuid, idsDeEjemplo } from '../../../panel/m6-simulado/ids.js';
import { CLIENTE, OTRO_CLIENTE } from '../ayudas/m6.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('ids de los viajes de ejemplo (RF-2.1.11)', () => {
  it('son UUID v4 y salen del sha256 del texto, para que cargar el ejemplo dos veces dé los mismos', () => {
    const id = derivarUuid('ejemplo|texto');

    expect(id).toMatch(UUID_V4);
    // Todo menos los 4 bits de versión y los 2 de variante es el sha256, sin cambios.
    const hash = createHash('sha256').update('ejemplo|texto').digest('hex');
    expect(id.replaceAll('-', '').slice(0, 12)).toBe(hash.slice(0, 12));
    expect(id.replaceAll('-', '').slice(13, 16)).toBe(hash.slice(13, 16));
    expect(id.replaceAll('-', '').slice(17)).toBe(hash.slice(17, 32));
    expect(derivarUuid('ejemplo|texto')).toBe(id);
  });

  it('son fijos para un cliente y distintos entre clientes y entre sí', () => {
    const uno = idsDeEjemplo(CLIENTE);
    const otro = idsDeEjemplo(OTRO_CLIENTE);

    expect(idsDeEjemplo(CLIENTE)).toEqual(uno);
    expect(new Set([uno.completado, uno.enCurso, otro.completado, otro.enCurso]).size).toBe(4);
    expect(uno.completado).toMatch(UUID_V4);
    expect(uno.enCurso).toMatch(UUID_V4);
  });

  it('un UUID no distingue mayúsculas: el mismo cliente en mayúsculas tiene los mismos viajes', () => {
    expect(idsDeEjemplo(CLIENTE.toUpperCase())).toEqual(idsDeEjemplo(CLIENTE));
  });
});
