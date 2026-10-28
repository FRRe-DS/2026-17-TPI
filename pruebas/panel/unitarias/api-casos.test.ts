import { describe, expect, it } from 'vitest';
import { crearPedirDeCasos } from '../../../panel/cliente/src/api/casos.js';
import type { PedidoDelCaso } from '../../../panel/cliente/src/logica/ejecutar-caso.js';

// El `pedir` de los casos (spec 072, T12): arma el pedido al panel y devuelve cualquier respuesta, también un 4xx o un 5xx.
const pedido = (cambios: Partial<PedidoDelCaso> = {}): PedidoDelCaso => ({ metodo: 'GET', ruta: '/api/v1/clientes/c-1', identidad: null, clave: undefined, cuerpo: undefined, ...cambios });

type Llamada = { ruta: string; init: RequestInit };
function fetchDeMentira(responder: (llamada: Llamada) => Response | Promise<Response>) {
  const llamadas: Llamada[] = [];
  const falso = (async (entrada: RequestInfo | URL, init: RequestInit = {}) => {
    const llamada = { ruta: String(entrada), init };
    llamadas.push(llamada);
    return responder(llamada);
  }) as typeof fetch;
  return { falso, llamadas };
}
const encabezadosDe = (llamada: Llamada) => new Headers(llamada.init.headers);

describe('crearPedirDeCasos: el pedido', () => {
  it('manda método, ruta y la identidad en X-Panel-Rol y X-Panel-Sub', async () => {
    const { falso, llamadas } = fetchDeMentira(() => new Response('{}', { headers: { 'content-type': 'application/json' } }));

    await crearPedirDeCasos({ fetch: falso })(pedido({ identidad: { rol: 'OPERADOR', sub: 'u-1' } }));

    expect(llamadas[0]!.ruta).toBe('/api/v1/clientes/c-1');
    expect(llamadas[0]!.init.method).toBe('GET');
    expect(encabezadosDe(llamadas[0]!).get('x-panel-rol')).toBe('OPERADOR');
    expect(encabezadosDe(llamadas[0]!).get('x-panel-sub')).toBe('u-1');
    expect(llamadas[0]!.init.body).toBeUndefined();
  });

  it('sin identidad no manda encabezados de identidad (M2 responde 401)', async () => {
    const { falso, llamadas } = fetchDeMentira(() => new Response(null, { status: 204 }));

    await crearPedirDeCasos({ fetch: falso })(pedido());

    expect(encabezadosDe(llamadas[0]!).has('x-panel-rol')).toBe(false);
    expect(encabezadosDe(llamadas[0]!).has('x-panel-sub')).toBe(false);
  });

  it('con cuerpo manda JSON y Content-Type; con clave, Idempotency-Key', async () => {
    const { falso, llamadas } = fetchDeMentira(() => new Response('{}', { status: 201 }));

    await crearPedirDeCasos({ fetch: falso })(pedido({ metodo: 'POST', cuerpo: { nombre: 'Ana' }, clave: 'k-1' }));

    expect(llamadas[0]!.init.body).toBe('{"nombre":"Ana"}');
    expect(encabezadosDe(llamadas[0]!).get('content-type')).toBe('application/json');
    expect(encabezadosDe(llamadas[0]!).get('idempotency-key')).toBe('k-1');
  });
});

describe('crearPedirDeCasos: la respuesta', () => {
  it.each([200, 201, 404, 409, 422, 503])('un %i no es una excepción: se devuelve', async (estado) => {
    const { falso } = fetchDeMentira(() => new Response('{"type":"/errores/x"}', { status: estado, headers: { 'content-type': 'application/problem+json', 'Retry-After': '5' } }));

    const respuesta = await crearPedirDeCasos({ fetch: falso })(pedido());

    expect(respuesta).toEqual({ estado, encabezados: { 'content-type': 'application/problem+json', 'retry-after': '5' }, cuerpo: { type: '/errores/x' } });
  });

  it('una respuesta sin cuerpo no trae «cuerpo»', async () => {
    const { falso } = fetchDeMentira(() => new Response(null, { status: 204 }));

    expect(await crearPedirDeCasos({ fetch: falso })(pedido())).toEqual({ estado: 204, encabezados: {} });
  });

  it('un cuerpo que no es JSON se devuelve sin interpretar', async () => {
    const { falso } = fetchDeMentira(() => new Response('<html>proxy</html>', { status: 502, headers: { 'content-type': 'text/html' } }));

    const respuesta = await crearPedirDeCasos({ fetch: falso })(pedido());

    expect(respuesta.estado).toBe(502);
    expect(respuesta.cuerpo).toBeUndefined();
  });
});

describe('crearPedirDeCasos: la franja del pie (RNF-14.9)', () => {
  it('informa cada pedido a M2 con su código, su duración y su X-Request-Id', async () => {
    const { falso } = fetchDeMentira(() => new Response('{}', { status: 409, headers: { 'x-request-id': 'panel-9' } }));
    const informados: unknown[] = [];

    await crearPedirDeCasos({ fetch: falso, alTerminar: (pedido) => informados.push(pedido) })(pedido({ metodo: 'POST' }));

    expect(informados).toEqual([{ metodo: 'POST', ruta: '/api/v1/clientes/c-1', estado: 409, ms: expect.any(Number), requestId: 'panel-9' }]);
  });

  it('no informa los del canal de control del M6 simulado ni los que no tuvieron respuesta', async () => {
    const informados: unknown[] = [];
    const { falso } = fetchDeMentira(() => new Response('{}'));
    await crearPedirDeCasos({ fetch: falso, alTerminar: (p) => informados.push(p) })(pedido({ ruta: '/panel/m6/modo' }));
    const { falso: roto } = fetchDeMentira(() => {
      throw new TypeError('fetch failed');
    });
    await crearPedirDeCasos({ fetch: roto, alTerminar: (p) => informados.push(p) })(pedido()).catch(() => undefined);

    expect(informados).toEqual([]);
  });
});

describe('crearPedirDeCasos: sin respuesta', () => {
  it('si la conexión falla, lanza un mensaje corto sin la dirección', async () => {
    const { falso } = fetchDeMentira(() => {
      throw new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:8083');
    });

    await expect(crearPedirDeCasos({ fetch: falso })(pedido())).rejects.toThrow(/^no se pudo conectar$/);
  });

  it('si el tiempo se agota, lanza «no respondió en N s»', async () => {
    const { falso } = fetchDeMentira(({ init }) => new Promise<Response>((_listo, rechazar) => init.signal?.addEventListener('abort', () => rechazar(new DOMException('abortado', 'AbortError')))));

    await expect(crearPedirDeCasos({ fetch: falso, tiempoMaximoMs: 20 })(pedido())).rejects.toThrow(/^no respondió en 0 s$/);
  });

  it('el tiempo cuenta hasta tener el cuerpo entero', async () => {
    const { falso } = fetchDeMentira(({ init }) => {
      const cuerpo = new ReadableStream({
        start(control) {
          init.signal?.addEventListener('abort', () => control.error(new DOMException('abortado', 'AbortError')));
        },
      });
      return new Response(cuerpo, { status: 200 });
    });

    await expect(crearPedirDeCasos({ fetch: falso, tiempoMaximoMs: 20 })(pedido())).rejects.toThrow(/^no respondió en/);
  });
});
