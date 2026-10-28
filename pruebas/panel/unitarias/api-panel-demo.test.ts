import { describe, expect, it } from 'vitest';
import { ErrorDeApi } from '../../../panel/cliente/src/api/errores.js';
import { crearApiPanel, CORTE_DE_APAGAR_MS, CORTE_DE_ENCENDER_MS, CORTE_DE_INTEGRIDAD_MS } from '../../../panel/cliente/src/api/panel.js';

// Las funciones de `api/panel.ts` para las rutas `/panel/demo/…` (spec 072, T13): una por ruta, con el corte de 10 s de la 071 y
// 70 s para encender la base. Los errores son los mismos de siempre: `ErrorDeApi`. Los `POST` sin campos mandan `{}`: los esquemas
// del servidor piden un objeto.
type Llamada = { ruta: string; init: RequestInit };

function panelDeMentira(responder: (llamada: Llamada) => Response | Promise<Response> = () => json({})) {
  const llamadas: Llamada[] = [];
  const falso = (async (entrada: RequestInfo | URL, init: RequestInit = {}) => {
    const llamada = { ruta: String(entrada), init };
    llamadas.push(llamada);
    return responder(llamada);
  }) as typeof fetch;
  return { falso, llamadas };
}
const json = (cuerpo: unknown, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json' } });

describe('una función por ruta', () => {
  it.each([
    ['obtenerEstadoDemo', (api: ReturnType<typeof crearApiPanel>) => api.obtenerEstadoDemo(), 'GET', '/panel/demo/estado', undefined],
    ['consultarSaludDeM2', (api: ReturnType<typeof crearApiPanel>) => api.consultarSaludDeM2(), 'GET', '/panel/demo/salud', undefined],
    ['lanzarAltasSimultaneas', (api: ReturnType<typeof crearApiPanel>) => api.lanzarAltasSimultaneas(12, 'misma-clave'), 'POST', '/panel/demo/altas-simultaneas', { n: 12, modo: 'misma-clave' }],
    ['lanzarAltasSimultaneas (claves distintas)', (api: ReturnType<typeof crearApiPanel>) => api.lanzarAltasSimultaneas(2, 'claves-distintas'), 'POST', '/panel/demo/altas-simultaneas', { n: 2, modo: 'claves-distintas' }],
    ['lanzarCalificacionesSimultaneas', (api: ReturnType<typeof crearApiPanel>) => api.lanzarCalificacionesSimultaneas(50), 'POST', '/panel/demo/calificaciones-simultaneas', { n: 50 }],
    ['probarRestriccionDelPuntaje', (api: ReturnType<typeof crearApiPanel>) => api.probarRestriccionDelPuntaje(), 'POST', '/panel/demo/restriccion-puntaje', {}],
    ['apagarBase', (api: ReturnType<typeof crearApiPanel>) => api.apagarBase(), 'POST', '/panel/demo/base/apagar', {}],
    ['encenderBase', (api: ReturnType<typeof crearApiPanel>) => api.encenderBase(), 'POST', '/panel/demo/base/encender', {}],
  ] as const)('%s pide %s %s', async (_nombre, llamar, metodo, ruta, cuerpo) => {
    const { falso, llamadas } = panelDeMentira();

    await llamar(crearApiPanel({ fetch: falso }));

    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]!.ruta).toBe(ruta);
    expect(llamadas[0]!.init.method).toBe(metodo);
    expect(llamadas[0]!.init.body).toBe(cuerpo === undefined ? undefined : JSON.stringify(cuerpo));
  });

  it('devuelve el JSON del panel tal cual', async () => {
    const resultado = { clienteId: 'c', n: 2, porCodigo: { 201: 1, 409: 1 }, filas: 1, esperado: { porCodigo: { 201: 1, 409: 1 }, filas: 1 }, cumple: true, prefijoRequestId: 'p-' };
    const { falso } = panelDeMentira(() => json(resultado));

    expect(await crearApiPanel({ fetch: falso }).lanzarAltasSimultaneas(2, 'claves-distintas')).toEqual(resultado);
  });
});

describe('los errores del panel', () => {
  it('un 409 de Docker no disponible es un ErrorDeApi con su type y su detalle', async () => {
    const { falso } = panelDeMentira(
      () =>
        new Response(JSON.stringify({ type: '/panel/errores/docker-no-disponible', title: 'Docker no disponible', status: 409, detail: 'Docker no está instalado en esta máquina' }), {
          status: 409,
          headers: { 'content-type': 'application/problem+json' },
        }),
    );

    const error = await crearApiPanel({ fetch: falso }).apagarBase().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ErrorDeApi);
    expect(error).toMatchObject({ estado: 409, type: '/panel/errores/docker-no-disponible', detail: 'Docker no está instalado en esta máquina', sinRespuesta: false });
  });

  it('un 400 de cuerpo inválido y un 502 de preparación también', async () => {
    for (const [estado, type] of [[400, '/panel/errores/pedido-invalido'], [502, '/panel/errores/preparacion-fallida']] as const) {
      const { falso } = panelDeMentira(() => new Response(JSON.stringify({ type, title: 'x', status: estado }), { status: estado, headers: { 'content-type': 'application/problem+json' } }));

      await expect(crearApiPanel({ fetch: falso }).lanzarCalificacionesSimultaneas(10)).rejects.toMatchObject({ estado, type });
    }
  });

  it('si el panel no responde, es «M2 no responde»', async () => {
    const { falso } = panelDeMentira(() => {
      throw new TypeError('fetch failed');
    });

    await expect(crearApiPanel({ fetch: falso }).obtenerEstadoDemo()).rejects.toMatchObject({ sinRespuesta: true, estado: 504 });
  });
});

describe('los cortes de tiempo', () => {
  const colgado = ({ init }: Llamada) => new Promise<Response>((_listo, rechazar) => init.signal?.addEventListener('abort', () => rechazar(new DOMException('abortado', 'AbortError'))));

  it('encender espera hasta 70 s y apagar hasta 40 s (el panel espera 60 s y 30 s a docker compose); el resto, el corte de siempre', () => {
    expect(CORTE_DE_ENCENDER_MS).toBe(70_000);
    expect(CORTE_DE_APAGAR_MS).toBe(40_000);
  });

  // El peor caso del servidor en las calificaciones simultáneas son unos 36,5 s (crear el cliente 10 s, tres pedidos al canal del M6
  // de 3 s, cargar el ejemplo 3 s, los N pedidos 10 s y contar 4,5 s): el navegador espera más, para ver el resultado con su
  // «sin respuesta» y no soltar el cerrojo con el servidor todavía trabajando.
  it('las pruebas de integridad esperan 45 s, más que el peor caso del servidor', () => {
    expect(CORTE_DE_INTEGRIDAD_MS).toBe(45_000);
    expect(CORTE_DE_INTEGRIDAD_MS).toBeGreaterThan(36_500);
  });

  it.each([
    ['lanzarAltasSimultaneas', (api: ReturnType<typeof crearApiPanel>) => api.lanzarAltasSimultaneas(10, 'misma-clave')],
    ['lanzarCalificacionesSimultaneas', (api: ReturnType<typeof crearApiPanel>) => api.lanzarCalificacionesSimultaneas(10)],
    ['probarRestriccionDelPuntaje', (api: ReturnType<typeof crearApiPanel>) => api.probarRestriccionDelPuntaje()],
  ])('%s no se corta con el tiempo de las demás: usa el de integridad', async (_nombre, llamar) => {
    let cortado = false;
    const { falso } = panelDeMentira(async ({ init }) => {
      init.signal?.addEventListener('abort', () => (cortado = true));
      await new Promise((listo) => setTimeout(listo, 60));
      return json({ clienteId: 'c-1' });
    });

    await llamar(crearApiPanel({ fetch: falso, tiempoMaximoMs: 20 }));

    expect(cortado).toBe(false);
  });

  it('las demás rutas se cortan con el tiempo de la API (10 s por defecto)', async () => {
    const { falso } = panelDeMentira(colgado);

    await expect(crearApiPanel({ fetch: falso, tiempoMaximoMs: 20 }).consultarSaludDeM2()).rejects.toMatchObject({ sinRespuesta: true });
  });

  it.each([
    ['encender', (api: ReturnType<typeof crearApiPanel>) => api.encenderBase()],
    ['apagar', (api: ReturnType<typeof crearApiPanel>) => api.apagarBase()],
  ])('%s no se corta con el tiempo de las demás: usa el suyo', async (_nombre, llamar) => {
    let cortado = false;
    const { falso } = panelDeMentira(async ({ init }) => {
      init.signal?.addEventListener('abort', () => (cortado = true));
      await new Promise((listo) => setTimeout(listo, 60));
      return json({ ejecutado: true });
    });

    const resultado = await llamar(crearApiPanel({ fetch: falso, tiempoMaximoMs: 20 }));

    expect(resultado).toEqual({ ejecutado: true });
    expect(cortado).toBe(false);
  });

  it('la persona puede cancelar un pedido con la señal', async () => {
    const { falso } = panelDeMentira(colgado);
    const control = new AbortController();

    const pedido = crearApiPanel({ fetch: falso }).consultarSaludDeM2(control.signal);
    control.abort();

    await expect(pedido).rejects.not.toBeInstanceOf(ErrorDeApi);
  });
});
