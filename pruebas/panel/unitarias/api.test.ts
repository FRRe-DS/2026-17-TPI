import { afterEach, describe, expect, it, vi } from 'vitest';
import { cargarContrato } from '../../../src/contrato/cargar.js';
import { ErrorDeApi } from '../../../panel/cliente/src/api/errores.js';
import { crearApiM2, OPERACIONES, TIEMPO_MAXIMO_MS, type ApiM2 } from '../../../panel/cliente/src/api/m2.js';

const CLIENTE = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const OTRO = '9e8d7c6b-5a49-4382-9716-0f1e2d3c4b5a';
const CLAVE = '7d444840-9dc0-41e5-b7b2-5a9f2f6e1c10';
const PROBLEMA = 'application/problem+json';

type Pedido = { url: string; init: RequestInit & { headers: Record<string, string> } };

// Un `fetch` de mentira: guarda lo que recibe y responde lo que se le indique.
function crearFetch(respuesta: () => Response | Promise<Response> = () => json({})) {
  const pedidos: Pedido[] = [];
  const fetchFalso = vi.fn((url: string, init: Pedido['init']) => {
    pedidos.push({ url, init });
    return Promise.resolve(respuesta());
  });
  return { fetch: fetchFalso as unknown as typeof fetch, pedidos };
}

const json = (cuerpo: unknown, estado = 200, encabezados: Record<string, string> = {}) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json', ...encabezados } });
const problema = (cuerpo: unknown, estado: number, encabezados: Record<string, string> = {}) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': PROBLEMA, ...encabezados } });

const IDENTIDAD = { rol: 'CLIENTE' as const, sub: CLIENTE };
const apiCon = (respuesta?: () => Response | Promise<Response>, opciones: Parameters<typeof crearApiM2>[0] = {}) => {
  const falso = crearFetch(respuesta);
  return { ...falso, api: crearApiM2({ fetch: falso.fetch, identidad: () => IDENTIDAD, ...opciones }) };
};

// Cada operación del cliente con un llamado de ejemplo. La clave de la tabla es el operationId del contrato.
const LLAMADOS: Record<string, (api: ApiM2) => Promise<unknown>> = {
  verificarSalud: (api) => api.verificarSalud(),
  crearCliente: (api) => api.crearCliente({ nombre: 'Ana', apellido: 'Pérez', telefono: '+5491122334455' }, CLAVE),
  obtenerCliente: (api) => api.obtenerCliente(CLIENTE),
  actualizarCliente: (api) => api.actualizarCliente(CLIENTE, { nombre: 'Ana' }),
  listarDirecciones: (api) => api.listarDirecciones(CLIENTE),
  crearDireccion: (api) => api.crearDireccion(CLIENTE, { tipo: 'FAVORITA', alias: 'Casa', texto: 'Calle 1' }, CLAVE),
  obtenerDireccion: (api) => api.obtenerDireccion(CLIENTE, OTRO),
  actualizarDireccion: (api) => api.actualizarDireccion(CLIENTE, OTRO, { alias: 'Trabajo' }),
  eliminarDireccion: (api) => api.eliminarDireccion(CLIENTE, OTRO),
  obtenerPreferencias: (api) => api.obtenerPreferencias(CLIENTE),
  guardarPreferencias: (api) => api.guardarPreferencias(CLIENTE, { tiposVehiculo: [], canales: [], accesibilidad: [] }),
  listarHistorialViajes: (api) => api.listarHistorialViajes(CLIENTE),
  listarCalificaciones: (api) => api.listarCalificaciones(CLIENTE),
  calificarConductor: (api) => api.calificarConductor(CLIENTE, { viajeId: OTRO, puntaje: 5 }, CLAVE),
  obtenerCalificacion: (api) => api.obtenerCalificacion(CLIENTE, OTRO),
  obtenerEstadoCuenta: (api) => api.obtenerEstadoCuenta(CLIENTE),
  listarBloqueos: (api) => api.listarBloqueos(CLIENTE),
  crearBloqueo: (api) => api.crearBloqueo(CLIENTE, { motivo: 'Fraude' }, CLAVE),
  obtenerBloqueo: (api) => api.obtenerBloqueo(CLIENTE, OTRO),
  levantarBloqueo: (api) => api.levantarBloqueo(CLIENTE, OTRO, { motivo: 'Resuelto' }),
};
const CON_CLAVE = ['crearCliente', 'crearDireccion', 'calificarConductor', 'crearBloqueo'];

// La ruta del contrato (`/api/v1/clientes/{clienteId}/…`) como expresión regular sobre el camino pedido.
const comoExpresion = (ruta: string) => new RegExp(`^${ruta.replace(/\{[^}]+\}/g, '[^/?]+')}$`);

describe('toda ruta que arma el cliente existe en el contrato con ese método (RNF-02.3)', () => {
  const contrato = cargarContrato();
  const paths = contrato.paths as Record<string, Record<string, { operationId?: string }>>;

  it.each(Object.entries(OPERACIONES))('%s', (nombre, { metodo, ruta }) => {
    expect(paths[ruta]?.[metodo.toLowerCase()]?.operationId).toBe(nombre);
  });

  it('el ejemplo de llamado cubre cada operación del cliente', () => {
    expect(Object.keys(LLAMADOS).sort()).toEqual(Object.keys(OPERACIONES).sort());
  });

  it.each(Object.keys(LLAMADOS))('%s pide al panel el método y el camino de su operación', async (nombre) => {
    const { api, pedidos } = apiCon(() => json({}));

    await LLAMADOS[nombre]!(api);

    const { metodo, ruta } = OPERACIONES[nombre as keyof typeof OPERACIONES];
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]!.init.method).toBe(metodo);
    expect(new URL(pedidos[0]!.url, 'http://panel.test').pathname).toMatch(comoExpresion(ruta));
  });

  it.each(Object.keys(LLAMADOS))('%s %s la clave de idempotencia', async (nombre) => {
    const { api, pedidos } = apiCon(() => json({}));

    await LLAMADOS[nombre]!(api);

    const clave = pedidos[0]!.init.headers['Idempotency-Key'];
    expect(clave).toBe(CON_CLAVE.includes(nombre) ? CLAVE : undefined);
  });
});

describe('cómo se arma el pedido (RNF-12.6)', () => {
  it('lleva la identidad de prueba, JSON en ambos sentidos y el cuerpo tal cual', async () => {
    const { api, pedidos } = apiCon(() => json({}, 201));

    await api.crearCliente({ nombre: 'Ana', apellido: 'Pérez', telefono: '+5491122334455' }, CLAVE);

    const { url, init } = pedidos[0]!;
    expect(url).toBe('/api/v1/clientes');
    expect(init.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Panel-Rol': 'CLIENTE',
      'X-Panel-Sub': CLIENTE,
      'Idempotency-Key': CLAVE,
    });
    expect(JSON.parse(init.body as string)).toEqual({ nombre: 'Ana', apellido: 'Pérez', telefono: '+5491122334455' });
  });

  it('un pedido sin cuerpo no lleva Content-Type', async () => {
    const { api, pedidos } = apiCon();

    await api.obtenerCliente(CLIENTE);

    expect(pedidos[0]!.init.headers['Content-Type']).toBeUndefined();
    expect(pedidos[0]!.init.body).toBeUndefined();
  });

  it('sin identidad no manda las cabeceras X-Panel-* (el panel no firma token y M2 responde 401)', async () => {
    const { api, pedidos } = apiCon(() => json({}), { identidad: () => undefined });

    await api.obtenerCliente(CLIENTE);

    expect(Object.keys(pedidos[0]!.init.headers).filter((nombre) => nombre.startsWith('X-Panel'))).toEqual([]);
  });

  it('lee la identidad en cada pedido, no al crear el cliente', async () => {
    let identidad: { rol: 'CLIENTE' | 'OPERADOR'; sub: string } = { rol: 'CLIENTE', sub: CLIENTE };
    const falso = crearFetch();
    const api = crearApiM2({ fetch: falso.fetch, identidad: () => identidad });

    await api.verificarSalud();
    identidad = { rol: 'OPERADOR', sub: OTRO };
    await api.verificarSalud();

    expect(falso.pedidos.map((p) => p.init.headers['X-Panel-Rol'])).toEqual(['CLIENTE', 'OPERADOR']);
    expect(falso.pedidos.map((p) => p.init.headers['X-Panel-Sub'])).toEqual([CLIENTE, OTRO]);
  });

  it('la paginación y el filtro van en la query, y lo que no se indicó no va', async () => {
    const { api, pedidos } = apiCon();

    await api.listarDirecciones(CLIENTE, { tipo: 'FAVORITA', page: 0, size: 100 });
    await api.listarHistorialViajes(CLIENTE, { page: 2 });
    await api.listarBloqueos(CLIENTE, {});

    expect(pedidos.map((p) => p.url)).toEqual([
      `/api/v1/clientes/${CLIENTE}/direcciones?tipo=FAVORITA&page=0&size=100`,
      `/api/v1/clientes/${CLIENTE}/viajes?page=2`,
      `/api/v1/clientes/${CLIENTE}/bloqueos`,
    ]);
  });

  it('un identificador raro no sale del camino: se codifica', async () => {
    const { api, pedidos } = apiCon();

    await api.obtenerCliente('../../health?x=1#');

    expect(pedidos[0]!.url).toBe('/api/v1/clientes/..%2F..%2Fhealth%3Fx%3D1%23');
  });
});

describe('qué devuelve en cada respuesta', () => {
  it('el cuerpo JSON de un 200 y de un 201', async () => {
    expect(await apiCon(() => json({ clienteId: CLIENTE })).api.obtenerCliente(CLIENTE)).toEqual({ clienteId: CLIENTE });
    expect(await apiCon(() => json({ clienteId: CLIENTE }, 201)).api.crearCliente({} as never, CLAVE)).toEqual({ clienteId: CLIENTE });
  });

  it('un 204 devuelve undefined', async () => {
    const { api } = apiCon(() => new Response(null, { status: 204 }));

    expect(await api.eliminarDireccion(CLIENTE, OTRO)).toBeUndefined();
  });

  it('un 200 que no es JSON es un error y no un éxito', async () => {
    const { api } = apiCon(() => new Response('<html>no soy M2</html>', { status: 200, headers: { 'content-type': 'text/html' } }));

    const error = await api.obtenerCliente(CLIENTE).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ErrorDeApi);
    expect(error).toMatchObject({ sinRespuesta: false, estado: 200, type: 'about:blank' });
  });
});

describe('un problem+json llega completo (RNF-03.6)', () => {
  const CUERPO = {
    type: '/errores/calificacion-duplicada',
    title: 'El viaje ya fue calificado',
    status: 409,
    detail: 'Ya existe una calificación para el viaje 7d44…',
    instance: '/api/v1/clientes/x/calificaciones',
  };

  it('con código, type, title, detail, instance, Retry-After y X-Request-Id', async () => {
    const { api } = apiCon(() => problema(CUERPO, 409, { 'retry-after': '5', 'x-request-id': 'panel-123' }));

    const error = (await api.calificarConductor(CLIENTE, {} as never, CLAVE).catch((e: unknown) => e)) as ErrorDeApi;

    expect(error).toBeInstanceOf(ErrorDeApi);
    expect(error).toMatchObject({
      sinRespuesta: false,
      estado: 409,
      type: CUERPO.type,
      title: CUERPO.title,
      detail: CUERPO.detail,
      instance: CUERPO.instance,
      reintentarEnS: 5,
      requestId: 'panel-123',
    });
    expect(error.message).toContain(CUERPO.title);
  });

  it('el código es el de la respuesta, no el del cuerpo', async () => {
    const { api } = apiCon(() => problema({ ...CUERPO, status: 200 }, 409));

    expect(await api.obtenerCliente(CLIENTE).catch((e: unknown) => e)).toMatchObject({ estado: 409 });
  });

  it.each([['abc'], ['0'], ['-3'], ['3601'], ['1.5'], ['Wed, 21 Oct 2026 07:28:00 GMT'], ['']])('Retry-After «%s» no es una cuenta regresiva', async (valor) => {
    const { api } = apiCon(() => problema({ ...CUERPO, status: 503 }, 503, { 'retry-after': valor }));

    expect(await api.obtenerCliente(CLIENTE).catch((e: unknown) => e)).toMatchObject({ estado: 503, reintentarEnS: undefined });
  });

  it.each([['1', 1], ['3600', 3600], ['5', 5]])('Retry-After «%s» son %i segundos', async (valor, segundos) => {
    const { api } = apiCon(() => problema({ ...CUERPO, status: 503 }, 503, { 'retry-after': valor }));

    expect(await api.obtenerCliente(CLIENTE).catch((e: unknown) => e)).toMatchObject({ reintentarEnS: segundos });
  });

  it('un error sin problem+json (HTML, texto o vacío) conserva el código y no inventa un type de M2', async () => {
    for (const respuesta of [
      new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
      new Response('', { status: 500 }),
      new Response('{no es json', { status: 500, headers: { 'content-type': PROBLEMA } }),
    ]) {
      const { api } = apiCon(() => respuesta);

      const error = (await api.obtenerCliente(CLIENTE).catch((e: unknown) => e)) as ErrorDeApi;

      expect(error).toBeInstanceOf(ErrorDeApi);
      expect(error).toMatchObject({ sinRespuesta: false, estado: respuesta.status, type: 'about:blank' });
      expect(error.title).not.toBe('');
    }
  });

  it('un cuerpo con campos del tipo equivocado no rompe: se usan los de reemplazo', async () => {
    const { api } = apiCon(() => problema({ type: 5, title: null, detail: { a: 1 } }, 422));

    const error = (await api.obtenerCliente(CLIENTE).catch((e: unknown) => e)) as ErrorDeApi;

    expect(error).toMatchObject({ estado: 422, type: 'about:blank', detail: undefined });
    expect(typeof error.title).toBe('string');
  });
});

describe('«M2 no responde» (RNF-15.4)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Un fetch que no contesta nunca y se corta cuando se aborta la señal, como el de verdad.
  const colgado = () => {
    const falso = crearFetch();
    const cuelga = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolver, rechazar) => {
        init.signal?.addEventListener('abort', () => rechazar(init.signal?.reason));
      });
    });
    return { ...falso, fetch: cuelga as unknown as typeof fetch };
  };

  it('el tiempo máximo es de 10 segundos', () => {
    expect(TIEMPO_MAXIMO_MS).toBe(10_000);
  });

  it('corta a los 10 segundos justos y no antes', async () => {
    vi.useFakeTimers();
    const { fetch } = colgado();
    const api = crearApiM2({ fetch, identidad: () => IDENTIDAD });
    let resultado: unknown;
    void api.obtenerCliente(CLIENTE).catch((e: unknown) => (resultado = e));

    await vi.advanceTimersByTimeAsync(9_999);
    expect(resultado).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);

    expect(resultado).toBeInstanceOf(ErrorDeApi);
    expect(resultado).toMatchObject({ sinRespuesta: true, title: 'M2 no responde' });
  });

  it('también cuenta el tiempo que tarda el cuerpo en llegar', async () => {
    vi.useFakeTimers();
    const lento = vi.fn((_url: string, init: RequestInit) => {
      const cuerpo = new ReadableStream({
        start(controlador) {
          init.signal?.addEventListener('abort', () => controlador.error(init.signal?.reason));
        },
      });
      return Promise.resolve(new Response(cuerpo, { status: 200, headers: { 'content-type': 'application/json' } }));
    });
    const api = crearApiM2({ fetch: lento as unknown as typeof fetch, identidad: () => IDENTIDAD });
    let resultado: unknown;
    void api.obtenerCliente(CLIENTE).catch((e: unknown) => (resultado = e));

    await vi.advanceTimersByTimeAsync(10_000);

    expect(resultado).toMatchObject({ sinRespuesta: true });
  });

  it('una respuesta a tiempo no deja el temporizador andando', async () => {
    vi.useFakeTimers();
    const { api } = apiCon(() => json({}));

    await api.obtenerCliente(CLIENTE);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('el tiempo máximo se puede cambiar solo para las pruebas', async () => {
    vi.useFakeTimers();
    const { fetch } = colgado();
    const api = crearApiM2({ fetch, identidad: () => IDENTIDAD, tiempoMaximoMs: 50 });
    let resultado: unknown;
    void api.obtenerCliente(CLIENTE).catch((e: unknown) => (resultado = e));

    await vi.advanceTimersByTimeAsync(50);

    expect(resultado).toMatchObject({ sinRespuesta: true });
  });

  it('el 504 del panel, el tiempo agotado y una conexión caída dan el mismo error', async () => {
    vi.useFakeTimers();
    const del504 = await apiCon(() =>
      problema({ type: '/panel/errores/m2-no-responde', title: 'M2 no responde', status: 504 }, 504),
    ).api.obtenerCliente(CLIENTE).catch((e: unknown) => e);
    const sinConexion = await crearApiM2({
      fetch: (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch,
      identidad: () => IDENTIDAD,
    }).obtenerCliente(CLIENTE).catch((e: unknown) => e);
    const { fetch } = colgado();
    let agotado: unknown;
    void crearApiM2({ fetch, identidad: () => IDENTIDAD }).obtenerCliente(CLIENTE).catch((e: unknown) => (agotado = e));
    await vi.advanceTimersByTimeAsync(10_000);

    expect(del504).toBeInstanceOf(ErrorDeApi);
    expect(del504).toMatchObject({ sinRespuesta: true, estado: 504, type: '/panel/errores/m2-no-responde', title: 'M2 no responde' });
    expect(sinConexion).toEqual(del504);
    expect(agotado).toEqual(del504);
    expect((del504 as ErrorDeApi).message).toBe('M2 no responde');
  });

  it('si la persona cancela, el error es el de cancelar y no «M2 no responde»', async () => {
    const control = new AbortController();
    const { fetch } = colgado();
    const api = crearApiM2({ fetch, identidad: () => IDENTIDAD });

    const pendiente = api.obtenerCliente(CLIENTE, { senal: control.signal }).catch((e: unknown) => e);
    control.abort();

    const error = await pendiente;
    expect(error).not.toBeInstanceOf(ErrorDeApi);
    expect(error).toMatchObject({ name: 'AbortError' });
  });
});
