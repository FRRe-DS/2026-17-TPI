import { createServer } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { construirAppControl } from '../../../panel/m6-simulado/app-control.js';
import { crearEstadoM6 } from '../../../panel/m6-simulado/estado.js';
import { idsDeEjemplo } from '../../../panel/m6-simulado/ids.js';
import { ESPERA_CONTROL_MS } from '../../../panel/servidor/m6-control.js';
import { capturarLogs, descartarLogs } from '../../ayudas/logs.js';
import { crearServidorModulo } from '../../ayudas/servidor-modulo.js';
import { leerRespuesta, porSocket, escuchar } from '../../ayudas/socket.js';
import { CLIENTE } from '../ayudas/m6.js';
import { CONFIG_M6 } from '../ayudas/m6.js';
import { crearAppPanel, DESDE_EL_PANEL, DESDE_EL_PANEL_CON_ORIGEN, PUERTO_PANEL } from '../ayudas/app.js';

const PROBLEMA = 'application/problem+json';
const JSON_ = { 'content-type': 'application/json' };

// El canal de control de mentira en un puerto real: el panel le llega con fetch, como al de verdad.
const canal = crearServidorModulo();
beforeAll(async () => {
  await canal.levantar();
});
afterAll(async () => {
  await canal.cerrar();
});

const abiertas: ReturnType<typeof crearAppPanel>[] = [];
function panel(opciones: Parameters<typeof crearAppPanel>[0] = {}) {
  const app = crearAppPanel({ ...opciones, config: { urlM6Control: canal.url, ...opciones.config } });
  abiertas.push(app);
  return app;
}
afterEach(async () => {
  await Promise.all(abiertas.splice(0).map((app) => app.close()));
  canal.responderCon({ tipo: 'ok' });
});

async function puertoCerrado(): Promise<number> {
  const servidor = createServer();
  await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
  const { port } = servidor.address() as { port: number };
  await new Promise<void>((listo) => servidor.close(() => listo()));
  return port;
}

describe('qué llega al canal de control (RNF-13.5, RF-2.1.10)', () => {
  it('GET /panel/m6/estado llega como GET /control/estado y vuelve la respuesta tal cual', async () => {
    canal.responderCon({ tipo: 'ok', cuerpo: { modo: 'lento', retardoLentoMs: 5000 } });

    const respuesta = await panel().inject({ method: 'GET', url: '/panel/m6/estado', headers: DESDE_EL_PANEL });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({ modo: 'lento', retardoLentoMs: 5000 });
    expect(respuesta.headers['content-type']).toContain('application/json');
    expect(canal.metodoRecibido).toBe('GET');
    expect(canal.rutaRecibida).toBe('/control/estado');
    expect(canal.llamadas).toBe(1);
  });

  it('PUT /panel/m6/modo llega como PUT /control/modo con el cuerpo y el tipo tal como vinieron', async () => {
    canal.responderCon({ tipo: 'ok', cuerpo: { modo: 'caido', retardoLentoMs: 5000 } });

    const respuesta = await panel().inject({
      method: 'PUT',
      url: '/panel/m6/modo',
      headers: { ...DESDE_EL_PANEL_CON_ORIGEN, ...JSON_ },
      payload: '{"modo":"caido"}',
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({ modo: 'caido', retardoLentoMs: 5000 });
    expect(canal.metodoRecibido).toBe('PUT');
    expect(canal.rutaRecibida).toBe('/control/modo');
    expect(canal.cuerpoRecibido.toString('utf8')).toBe('{"modo":"caido"}');
    expect(canal.encabezadosRecibidos.get('content-type')).toBe('application/json');
  });

  it('POST /panel/m6/clientes/{id}/ejemplo llega como POST /control/clientes/{id}/ejemplo, sin el cuerpo', async () => {
    const cuerpo = { clienteId: CLIENTE, escenarios: [{ nombre: 'completado', viajeId: 'x', respuestaDeM2: 201 }] };
    canal.responderCon({ tipo: 'ok', cuerpo });

    const respuesta = await panel().inject({
      method: 'POST',
      url: `/panel/m6/clientes/${CLIENTE}/ejemplo`,
      headers: { ...DESDE_EL_PANEL_CON_ORIGEN, ...JSON_ },
      payload: '{"cualquier":"cosa"}',
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual(cuerpo);
    expect(canal.metodoRecibido).toBe('POST');
    expect(canal.rutaRecibida).toBe(`/control/clientes/${CLIENTE}/ejemplo`);
    expect(canal.cuerpoRecibido.length).toBe(0);
  });

  it('el clienteId en mayúsculas es válido y llega como vino', async () => {
    const mayusculas = CLIENTE.toUpperCase();

    const respuesta = await panel().inject({ method: 'POST', url: `/panel/m6/clientes/${mayusculas}/ejemplo`, headers: DESDE_EL_PANEL_CON_ORIGEN });

    expect(respuesta.statusCode).toBe(200);
    expect(canal.rutaRecibida).toBe(`/control/clientes/${mayusculas}/ejemplo`);
  });

  it('la query string no llega', async () => {
    await panel().inject({ method: 'GET', url: '/panel/m6/estado?x=1&token=abc', headers: DESDE_EL_PANEL });

    expect(canal.rutaRecibida).toBe('/control/estado');
  });

  it('el pedido lleva el mismo X-Request-Id que la respuesta del panel, y nada más del navegador: ni token, ni Origin, ni identidad', async () => {
    const respuesta = await panel().inject({
      method: 'POST',
      url: `/panel/m6/clientes/${CLIENTE}/ejemplo`,
      headers: { ...DESDE_EL_PANEL_CON_ORIGEN, 'x-request-id': 'prueba-m6-1', 'x-panel-rol': 'OPERADOR', 'x-panel-sub': CLIENTE, cookie: 'a=b', authorization: 'Bearer x' },
    });

    expect(respuesta.headers['x-request-id']).toBe('prueba-m6-1');
    expect(canal.encabezadosRecibidos.get('x-request-id')).toBe('prueba-m6-1');
    for (const nombre of ['origin', 'authorization', 'cookie', 'x-panel-rol', 'x-panel-sub']) {
      expect(canal.encabezadosRecibidos.has(nombre), nombre).toBe(false);
    }
  });

  it('lo que contesta el canal vuelve tal cual: un 400 de modo inválido con su problem+json', async () => {
    canal.responderCon({ tipo: '4xx', estado: 400, cuerpo: { type: '/m6-control/errores/pedido-invalido', status: 400 } });

    const respuesta = await panel().inject({
      method: 'PUT',
      url: '/panel/m6/modo',
      headers: { ...DESDE_EL_PANEL_CON_ORIGEN, ...JSON_ },
      payload: '{"modo":"rapido"}',
    });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.headers['content-type']).toContain(PROBLEMA);
    expect(respuesta.json()).toEqual({ type: '/m6-control/errores/pedido-invalido', status: 400 });
  });
});

describe('qué no llega al canal', () => {
  it.each([
    ['GET', '/panel/m6'],
    ['GET', '/panel/m6/'],
    ['GET', '/panel/m6/otra'],
    ['GET', '/panel/m6/estado/extra'],
    ['GET', '/panel/m6/control/estado'],
    ['GET', '/panel/m6/clientes'],
    ['GET', `/panel/m6/clientes/${CLIENTE}`],
    ['POST', `/panel/m6/clientes/${CLIENTE}/ejemplo/otro`],
    ['POST', `/panel/m6/clientes/${CLIENTE}/viajes`],
    ['POST', '/panel/m6/estado'],
    ['PUT', '/panel/m6/estado'],
    ['GET', '/panel/m6/modo'],
    ['DELETE', '/panel/m6/modo'],
    ['PATCH', '/panel/m6/modo'],
    ['GET', `/panel/m6/clientes/${CLIENTE}/ejemplo`],
    ['PUT', `/panel/m6/clientes/${CLIENTE}/ejemplo`],
    ['DELETE', `/panel/m6/clientes/${CLIENTE}/ejemplo`],
  ])('%s %s se rechaza con 404 y no llega', async (metodo, url) => {
    const respuesta = await panel().inject({ method: metodo as 'GET', url, headers: DESDE_EL_PANEL_CON_ORIGEN });

    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.headers['content-type']).toContain(PROBLEMA);
    expect(canal.llamadas).toBe(0);
  });

  it.each([
    ['..', '/panel/m6/clientes/../ejemplo'],
    ['%2e%2e', '/panel/m6/clientes/%2e%2e/ejemplo'],
    ['con barra codificada', `/panel/m6/clientes/${CLIENTE}%2f..%2f..%2festado/ejemplo`],
    ['con barra invertida', '/panel/m6/clientes/..%5cestado/ejemplo'],
    ['salto de ruta al final', `/panel/m6/clientes/${CLIENTE}/ejemplo/..`],
    ['doble barra', `/panel/m6//clientes/${CLIENTE}/ejemplo`],
  ])('un intento de salir de la lista (%s) no llega al canal', async (_nombre, url) => {
    const puerto = await escuchar(panel());

    const cruda = await porSocket(
      puerto,
      `POST ${url} HTTP/1.1\r\nHost: 127.0.0.1:${PUERTO_PANEL}\r\nOrigin: http://127.0.0.1:${PUERTO_PANEL}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
    );

    // El Host del panel es el de su puerto configurado, no el del socket de la prueba.
    const { estado } = leerRespuesta(cruda);
    expect(estado).toMatch(/ 4\d\d /);
    expect(canal.llamadas).toBe(0);
  });

  it.each([
    ['sin forma de UUID', 'no-es-un-uuid'],
    ['con un UUID de más', `${CLIENTE}0`],
    ['con una barra codificada', 'a%2Fb'],
    ['vacío de versión', '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6'],
    ['con espacios', '%20'],
    ['con un punto y coma', `${CLIENTE.slice(0, 35)};`],
  ])('un clienteId %s da 400 problem+json y no llega', async (_nombre, clienteId) => {
    const respuesta = await panel().inject({ method: 'POST', url: `/panel/m6/clientes/${clienteId}/ejemplo`, headers: DESDE_EL_PANEL_CON_ORIGEN });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.headers['content-type']).toContain(PROBLEMA);
    expect(respuesta.json()).toMatchObject({ type: '/panel/errores/cliente-id-invalido', status: 400 });
    expect(canal.llamadas).toBe(0);
  });
});

describe('seguridad del panel sobre estas rutas (RNF-12.8)', () => {
  it('un Host ajeno da 403 también acá y no llega', async () => {
    const respuesta = await panel().inject({ method: 'GET', url: '/panel/m6/estado', headers: { host: 'evil.test' } });

    expect(respuesta.statusCode).toBe(403);
    expect(canal.llamadas).toBe(0);
  });

  it.each([
    ['PUT', '/panel/m6/modo'],
    ['POST', `/panel/m6/clientes/${CLIENTE}/ejemplo`],
  ])('un %s %s sin Origin, o con uno ajeno, da 403 y no llega', async (metodo, url) => {
    const sin = await panel().inject({ method: metodo as 'PUT', url, headers: { ...DESDE_EL_PANEL, ...JSON_ }, payload: '{"modo":"caido"}' });
    const ajeno = await panel().inject({
      method: metodo as 'PUT',
      url,
      headers: { ...DESDE_EL_PANEL, ...JSON_, origin: 'https://evil.test' },
      payload: '{"modo":"caido"}',
    });

    expect([sin.statusCode, ajeno.statusCode]).toEqual([403, 403]);
    expect(canal.llamadas).toBe(0);
  });
});

describe('el canal no responde (RNF-13.5)', () => {
  it('la espera por defecto es de 3 segundos', () => {
    expect(ESPERA_CONTROL_MS).toBe(3000);
  });

  it.each([
    ['no contesta a tiempo', { tipo: 'cuelga' as const }],
    ['manda los encabezados pero el cuerpo no llega a tiempo', { tipo: 'demora-cuerpo' as const, retardoMs: 1000 }],
    ['corta la conexión', { tipo: 'corta' as const }],
  ])('si el canal %s, 502 problem+json del panel, en poco tiempo y sin reintento', async (_nombre, comportamiento) => {
    canal.responderCon(comportamiento);
    const inicio = Date.now();

    const respuesta = await panel({ esperaControlMs: 200 }).inject({ method: 'GET', url: '/panel/m6/estado', headers: DESDE_EL_PANEL });

    expect(respuesta.statusCode).toBe(502);
    expect(respuesta.headers['content-type']).toContain(PROBLEMA);
    expect(respuesta.json()).toMatchObject({ type: '/panel/errores/m6-control-no-responde', title: 'Canal de control del M6 simulado no disponible', status: 502 });
    expect(Date.now() - inicio).toBeLessThan(2000);
    expect(canal.llamadas).toBe(1);
  });

  it('si la conexión se rechaza, 502, y el log no trae la URL ni el cuerpo', async () => {
    const logs = capturarLogs();
    const puerto = await puertoCerrado();
    const app = crearAppPanel({ config: { urlM6Control: `http://127.0.0.1:${puerto}` }, flujoLog: logs.flujo });
    abiertas.push(app);

    const respuesta = await app.inject({
      method: 'PUT',
      url: '/panel/m6/modo',
      headers: { ...DESDE_EL_PANEL_CON_ORIGEN, ...JSON_ },
      payload: '{"modo":"secreto-de-prueba"}',
    });

    expect(respuesta.statusCode).toBe(502);
    expect(logs.texto()).not.toContain(String(puerto));
    expect(logs.texto()).not.toContain('secreto-de-prueba');
    expect(logs.lineas().some((l) => l.msg === 'Canal de control del M6 simulado no responde')).toBe(true);
  });

  it('no cambia las rutas de M2: un canal caído no afecta a /health', async () => {
    const puerto = await puertoCerrado();
    const app = crearAppPanel({ config: { urlM6Control: `http://127.0.0.1:${puerto}` } });
    abiertas.push(app);

    const salud = await app.inject({ method: 'GET', url: '/salud-panel', headers: DESDE_EL_PANEL });

    expect(salud.statusCode).toBe(200);
  });
});

describe('contra el canal de control de verdad (T8)', () => {
  // El panel de mentira → el canal real: comprueba que lo que manda `fetch` pasa la regla de Host y de Origin del canal.
  const abiertosReales: { close: () => Promise<unknown> }[] = [];
  afterEach(async () => {
    await Promise.all(abiertosReales.splice(0).map((app) => app.close()));
  });

  async function conCanalReal(nombreDelHost: string) {
    const estado = crearEstadoM6();
    const cambios: string[] = [];
    const api = { abrir: async () => void cambios.push('abre'), cerrar: async () => void cambios.push('cierra') };
    const config = { ...CONFIG_M6, puertoControl: 0 };
    // El puerto del canal tiene que ser el de su configuración, así que se elige uno libre antes.
    const puerto = await puertoCerrado();
    const control = construirAppControl({ config: { ...config, puertoControl: puerto }, estado, api, flujoLog: descartarLogs });
    await control.listen({ port: puerto, host: '127.0.0.1' });
    abiertosReales.push(control);
    const app = crearAppPanel({ config: { urlM6Control: `http://${nombreDelHost}:${puerto}` } });
    abiertas.push(app);
    return { app, estado, cambios };
  }

  it.each([['127.0.0.1'], ['localhost']])('el panel con PANEL_URL_M6_CONTROL en %s: estado, modo y ejemplo funcionan', async (nombre) => {
    const { app, estado, cambios } = await conCanalReal(nombre);

    const ejemplo = await app.inject({ method: 'POST', url: `/panel/m6/clientes/${CLIENTE}/ejemplo`, headers: DESDE_EL_PANEL_CON_ORIGEN });
    const modo = await app.inject({
      method: 'PUT',
      url: '/panel/m6/modo',
      headers: { ...DESDE_EL_PANEL_CON_ORIGEN, ...JSON_ },
      payload: '{"modo":"caido"}',
    });
    const consulta = await app.inject({ method: 'GET', url: '/panel/m6/estado', headers: DESDE_EL_PANEL });
    const invalido = await app.inject({
      method: 'PUT',
      url: '/panel/m6/modo',
      headers: { ...DESDE_EL_PANEL_CON_ORIGEN, ...JSON_ },
      payload: '{"modo":"rapido"}',
    });

    expect(ejemplo.statusCode).toBe(200);
    expect(ejemplo.json<{ escenarios: { viajeId: string }[] }>().escenarios[0]?.viajeId).toBe(idsDeEjemplo(CLIENTE).completado);
    expect(estado.listar({ clientId: CLIENTE })).toHaveLength(2);
    expect(modo.statusCode).toBe(200);
    expect(cambios).toEqual(['cierra']);
    expect(consulta.json<{ modo: string }>().modo).toBe('caido');
    expect(invalido.statusCode).toBe(400);
    expect(invalido.headers['content-type']).toContain(PROBLEMA);
  });
});
