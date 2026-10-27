import { describe, expect, it, vi } from 'vitest';
import { crearApiM2 } from '../../../panel/cliente/src/api/m2.js';
import { crearUltimoPedido, type UltimoPedido } from '../../../panel/cliente/src/logica/ultimo-pedido.js';

// El último pedido a M2 que muestra la franja del pie (T31, RNF-14.9): lo publica el cliente de M2 al terminar cada pedido.

const CLIENTE = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const respuesta = (estado: number, cuerpo: unknown, encabezados: Record<string, string> = {}) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': estado >= 400 ? 'application/problem+json' : 'application/json', ...encabezados } });

function apiCon(responder: () => Response | Promise<Response>) {
  const publicados: UltimoPedido[] = [];
  const api = crearApiM2({
    fetch: (() => Promise.resolve(responder())) as unknown as typeof fetch,
    identidad: () => ({ rol: 'CLIENTE', sub: CLIENTE }),
    alTerminar: (pedido) => publicados.push(pedido),
  });
  return { api, publicados };
}

describe('crearUltimoPedido', () => {
  it('empieza sin pedido y guarda el último que se publica', () => {
    const ultimo = crearUltimoPedido();
    expect(ultimo.actual()).toBeUndefined();

    ultimo.publicar({ metodo: 'GET', ruta: '/a', estado: 200, ms: 5, requestId: 'x' });
    ultimo.publicar({ metodo: 'POST', ruta: '/b', estado: 201, ms: 7, requestId: 'y' });

    expect(ultimo.actual()).toEqual({ metodo: 'POST', ruta: '/b', estado: 201, ms: 7, requestId: 'y' });
  });

  it('avisa a quien escucha, y deja de avisar a quien se da de baja', () => {
    const ultimo = crearUltimoPedido();
    const oyente = vi.fn();
    const baja = ultimo.suscribir(oyente);

    ultimo.publicar({ metodo: 'GET', ruta: '/a', estado: 200, ms: 1, requestId: 'x' });
    baja();
    ultimo.publicar({ metodo: 'GET', ruta: '/b', estado: 200, ms: 1, requestId: 'y' });

    expect(oyente).toHaveBeenCalledTimes(1);
  });
});

describe('el cliente de M2 informa cada pedido que termina', () => {
  it('un éxito: método, ruta con su query, código, duración y el folio de la respuesta', async () => {
    const { api, publicados } = apiCon(() => respuesta(200, { items: [], page: 0, size: 5, totalElementos: 0, totalPaginas: 0 }, { 'x-request-id': 'panel-123' }));

    await api.listarDirecciones(CLIENTE, { page: 0, size: 5 });

    expect(publicados).toHaveLength(1);
    expect(publicados[0]).toMatchObject({ metodo: 'GET', ruta: `/api/v1/clientes/${CLIENTE}/direcciones?page=0&size=5`, estado: 200, requestId: 'panel-123' });
    expect(publicados[0]!.ms).toBeGreaterThanOrEqual(0);
  });

  it('un rechazo de M2 también: con su código y su folio', async () => {
    const { api, publicados } = apiCon(() => respuesta(404, { type: 'about:blank', title: 'No encontrado', status: 404 }, { 'x-request-id': 'panel-404' }));

    await expect(api.obtenerCliente(CLIENTE)).rejects.toMatchObject({ estado: 404 });

    expect(publicados).toEqual([expect.objectContaining({ metodo: 'GET', estado: 404, requestId: 'panel-404' })]);
  });

  it('«M2 no responde» (504 del panel): se informa con el 504', async () => {
    const { api, publicados } = apiCon(() => respuesta(504, { type: '/panel/errores/m2-no-responde', title: 'M2 no responde', status: 504 }, { 'x-request-id': 'panel-504' }));

    await expect(api.obtenerCliente(CLIENTE)).rejects.toMatchObject({ sinRespuesta: true });

    expect(publicados).toEqual([expect.objectContaining({ estado: 504, requestId: 'panel-504' })]);
  });

  it('un pedido que nunca llegó al panel se informa como 504 y sin folio', async () => {
    const publicados: UltimoPedido[] = [];
    const api = crearApiM2({ fetch: (() => Promise.reject(new TypeError('fallo de red'))) as unknown as typeof fetch, alTerminar: (p) => publicados.push(p) });

    await expect(api.obtenerCliente(CLIENTE)).rejects.toMatchObject({ sinRespuesta: true });

    expect(publicados).toEqual([expect.objectContaining({ estado: 504 })]);
    expect(publicados[0]!.requestId).toBeUndefined();
  });

  it('un pedido que la persona cancela no se informa: no es un pedido que terminó', async () => {
    const control = new AbortController();
    const publicados: UltimoPedido[] = [];
    const api = crearApiM2({
      fetch: ((_: string, init: RequestInit) => new Promise((_, rechazar) => init.signal!.addEventListener('abort', () => rechazar(new DOMException('abortado', 'AbortError'))))) as unknown as typeof fetch,
      alTerminar: (p) => publicados.push(p),
    });

    const pedido = api.obtenerCliente(CLIENTE, { senal: control.signal });
    control.abort();
    await pedido.catch(() => undefined);

    expect(publicados).toEqual([]);
  });
});
