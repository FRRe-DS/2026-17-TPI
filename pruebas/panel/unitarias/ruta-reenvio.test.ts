import { describe, expect, it } from 'vitest';
import { rutaPermitida } from '../../../panel/servidor/proxy.js';

const ID = '3f2a1c4e-8b7d-4e2f-9a1b-6c5d4e3f2a1b';

// Solo se reenvía lo de M2 que usa el panel, y nada que al armar la URL de destino pueda salir de esa lista (plan, Reenvío).
describe('rutaPermitida (RNF-12.8)', () => {
  it.each([
    '/health',
    '/api/v1/clientes',
    '/api/v1/clientes/',
    `/api/v1/clientes/${ID}`,
    `/api/v1/clientes/${ID}/direcciones?limite=20&cursor=abc_-123`,
    `/api/v1/clientes/${ID}/calificaciones/${ID}`,
    `/api/v1/clientes/${ID}/estado-cuenta`,
    `/api/v1/clientes/${ID}/calificaciones?desde=2026-10-01T00:00:00.000Z`,
    '/api/v1/clientes/nombre.con.puntos',
    '/api/v1/clientes?email=ana%40ejemplo.test',
    '/api/v1/clientes?nombre=Ana%20Mar%C3%ADa',
  ])('permite %s', (ruta) => {
    expect(rutaPermitida(ruta)).toBe(true);
  });

  it.each([
    ['otra API', '/api/v1/conductores'],
    ['un prefijo que solo se parece', '/api/v1/clientesX'],
    ['otra versión', '/api/v2/clientes'],
    ['la raíz', '/'],
    ['la API sin recurso', '/api/v1'],
    ['algo debajo de health', '/health/detalle'],
    ['health con query', '/health?x=1'],
    ['el panel', '/salud-panel'],
    ['sin barra inicial', 'api/v1/clientes'],
    ['una URL absoluta', 'http://evil.test/api/v1/clientes'],
    ['de protocolo relativo', '//evil.test/api/v1/clientes'],
    ['con ..', '/api/v1/clientes/../../admin'],
    ['con .. al final', '/api/v1/clientes/..'],
    ['con .. en la query', '/api/v1/clientes?x=a..b'],
    ['con //', '/api/v1/clientes//x'],
    ['con @', '/api/v1/clientes/a@evil.test'],
    ['con barra invertida', '/api/v1/clientes/a\\..\\x'],
    ['con un punto codificado', '/api/v1/clientes/%2e%2e/x'],
    ['con un punto codificado en mayúscula', '/api/v1/clientes/%2E%2E/x'],
    ['con un punto codificado suelto', '/api/v1/clientes/%2e'],
    ['con un segmento .', '/api/v1/clientes/./x'],
    ['terminada en un segmento .', '/api/v1/clientes/.'],
    ['con una barra codificada', `/api/v1/clientes/${ID}%2f..%2fx`],
    ['con una barra invertida codificada', '/api/v1/clientes/a%5Cb'],
    ['con espacio', '/api/v1/clientes/a b'],
    ['con tabulación', '/api/v1/clientes/a\tb'],
    ['con salto de línea', '/api/v1/clientes/a\r\nHost: evil.test'],
    ['con #', '/api/v1/clientes#x'],
    ['con caracteres no ASCII', '/api/v1/clientes/ñ'],
    ['vacía', ''],
  ])('rechaza %s', (_caso, ruta) => {
    expect(rutaPermitida(ruta)).toBe(false);
  });
});
