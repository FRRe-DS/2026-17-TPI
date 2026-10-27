import { describe, expect, it, vi } from 'vitest';
import { CAPACIDAD_DE_PEDIDOS, copiarAlPortapapeles, esFalla, horaDelPedido, textoDelCuerpo } from '../../../panel/cliente/src/logica/pedidos.js';

// Lo que dice el detalle técnico de cada pedido (T31, RNF-14.9), sin React.

describe('lo que muestra la lista', () => {
  it('son los últimos 50', () => {
    expect(CAPACIDAD_DE_PEDIDOS).toBe(50);
  });

  it('la hora, sin la fecha ni los milisegundos', () => {
    expect(horaDelPedido('2026-10-27T12:34:56.789Z')).toBe('12:34:56');
  });

  it('400 o más es falla, incluido el 504 de «M2 no responde»; menos, no', () => {
    expect([200, 201, 204, 302, 399].map(esFalla)).toEqual([false, false, false, false, false]);
    expect([400, 404, 422, 500, 503, 504].map(esFalla)).toEqual([true, true, true, true, true, true]);
  });

  it('el cuerpo: tal cual, sin cuerpo o demasiado grande', () => {
    expect(textoDelCuerpo({ cuerpo: '{"a":1}' })).toBe('{"a":1}');
    expect(textoDelCuerpo({})).toBe('Sin cuerpo.');
    expect(textoDelCuerpo({ cuerpoOmitido: true })).toContain('@cuerpo.json');
  });
});

describe('copiarAlPortapapeles', () => {
  it('escribe el texto en el portapapeles', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    await copiarAlPortapapeles("curl -X GET 'http://x'", { writeText });

    expect(writeText).toHaveBeenCalledExactlyOnceWith("curl -X GET 'http://x'");
  });

  it('si el navegador lo rechaza, el error llega: no se cree copiado lo que no se copió', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));

    await expect(copiarAlPortapapeles('x', { writeText })).rejects.toThrow('NotAllowedError');
  });

  it('sin portapapeles, dice cómo copiar a mano', async () => {
    await expect(copiarAlPortapapeles('x', undefined)).rejects.toThrow('copialo a mano');
  });
});
