import type { FastifyInstance } from 'fastify';
import { request } from 'node:http';
import type { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { tokenDeServicio } from '../../../src/auth/tokens.js';
import { construirAppControl } from '../../../panel/m6-simulado/app-control.js';
import { construirAppM6 } from '../../../panel/m6-simulado/app-m6.js';
import { idsDeEjemplo } from '../../../panel/m6-simulado/ids.js';
import { crearEstadoM6, type EstadoM6 } from '../../../panel/m6-simulado/estado.js';
import { crearPuertoApi, type PuertoApi } from '../../../panel/m6-simulado/puerto-api.js';
import type { ConfigM6 } from '../../../panel/servidor/config.js';
import { escucha, puertoLibre } from '../../ayudas/arranque.js';
import { capturarLogs, descartarLogs } from '../../ayudas/logs.js';
import { leerRespuesta, porSocket } from '../../ayudas/socket.js';
import { CLIENTE, CONFIG_M6, OTRO_CLIENTE } from '../ayudas/m6.js';

const RETARDO_MS = 400;
const AJENO = '33333333-3333-4333-8333-333333333333';
const INEXISTENTE = '44444444-4444-4444-8444-444444444444';

type Levantado = {
  config: ConfigM6;
  estado: EstadoM6;
  api: PuertoApi;
  control: FastifyInstance;
  puerto: number;
  puertoControl: number;
};
const abiertos: Levantado[] = [];

// El M6 simulado entero en puertos reales: la API (que el modo caído cierra y reabre) y el canal de control.
async function levantar(opciones: { flujoLog?: Writable } = {}): Promise<Levantado> {
  const puerto = await puertoLibre();
  const puertoControl = await puertoLibre();
  const config = { ...CONFIG_M6, puerto, puertoControl, retardoLentoMs: RETARDO_MS };
  const estado = crearEstadoM6();
  const api = crearPuertoApi({
    puerto,
    escucha: '127.0.0.1',
    construir: () => construirAppM6({ config, estado, flujoLog: descartarLogs }),
  });
  await api.abrir();
  const control = construirAppControl({ config, estado, api, flujoLog: opciones.flujoLog ?? descartarLogs });
  await control.listen({ port: puertoControl, host: '127.0.0.1' });
  const levantado: Levantado = { config, estado, api, control, puerto, puertoControl };
  abiertos.push(levantado);
  return levantado;
}
afterEach(async () => {
  for (const { api, control } of abiertos.splice(0)) {
    await api.cerrar();
    await control.close();
  }
});

// Lo que manda la propia máquina: Host con el puerto del canal, y sin Origin, como el servidor del panel. Va con `http.request`
// y no con `fetch`, que pisa el encabezado Host con el de la URL.
function aControl(m6: Levantado, ruta: string, { host = `127.0.0.1:${m6.puertoControl}`, method = 'GET', headers = {}, body }: PedidoDeControl = {}) {
  return new Promise<{ status: number; headers: Headers; json: () => Promise<unknown> }>((resolver, rechazar) => {
    const pedido = request({ host: '127.0.0.1', port: m6.puertoControl, path: ruta, method, headers: { ...headers, host } }, (respuesta) => {
      const partes: Buffer[] = [];
      respuesta.on('data', (parte: Buffer) => partes.push(parte));
      respuesta.on('end', () => {
        const texto = Buffer.concat(partes).toString('utf8');
        const encabezados = new Headers();
        for (const [nombre, valor] of Object.entries(respuesta.headers)) encabezados.set(nombre, [valor ?? ''].flat().join(', '));
        resolver({ status: respuesta.statusCode ?? 0, headers: encabezados, json: async () => JSON.parse(texto) as unknown });
      });
    });
    pedido.on('error', rechazar);
    pedido.end(body);
  });
}
type PedidoDeControl = { host?: string; method?: string; headers?: Record<string, string>; body?: string | undefined };
const ponerModo = (m6: Levantado, modo: unknown) =>
  aControl(m6, '/control/modo', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modo }) });
const cargarEjemplo = (m6: Levantado, cliente = CLIENTE) => aControl(m6, `/control/clientes/${cliente}/ejemplo`, { method: 'POST' });

const comoM2 = async (m6: Levantado) => ({ authorization: `Bearer ${await tokenDeServicio(m6.config)}` });
const aApi = async (m6: Levantado, ruta: string) =>
  fetch(`http://127.0.0.1:${m6.puerto}/api/v1${ruta}`, { headers: await comoM2(m6) });

describe('cargar el ejemplo de un cliente (RF-2.1.10, RF-2.1.11)', () => {
  it('registra un viaje completado y uno en curso del cliente, con ids derivados de su clienteId', async () => {
    const m6 = await levantar();

    expect((await cargarEjemplo(m6)).status).toBe(200);

    const ids = idsDeEjemplo(CLIENTE);
    const lista = (await (await aApi(m6, `/trips?clientId=${CLIENTE}`)).json()) as { items: { id: string; state: string }[]; total: number };
    expect(lista.total).toBe(2);
    expect(lista.items.map((v) => [v.id, v.state]).sort()).toEqual(
      [
        [ids.completado, 'COMPLETED'],
        [ids.enCurso, 'IN_PROGRESS'],
      ].sort(),
    );
    const completado = (await (await aApi(m6, `/trips/${ids.completado}`)).json()) as { clientId: string; driverId?: string };
    expect(completado.clientId).toBe(CLIENTE);
    expect(completado.driverId).toBeDefined();
  });

  it('repetirlo no duplica nada: mismos viajes, mismos ids, mismo total', async () => {
    const m6 = await levantar();

    const primera = await (await cargarEjemplo(m6)).json();
    const antes = m6.estado.listar({ clientId: CLIENTE });
    const segunda = await (await cargarEjemplo(m6)).json();

    expect(segunda).toEqual(primera);
    expect(m6.estado.listar({ clientId: CLIENTE })).toEqual(antes);
    expect(antes).toHaveLength(2);
  });

  it('el cliente en mayúsculas es el mismo cliente', async () => {
    const m6 = await levantar();

    await cargarEjemplo(m6);
    await cargarEjemplo(m6, CLIENTE.toUpperCase());

    expect(m6.estado.listar({ clientId: CLIENTE })).toHaveLength(2);
  });

  it('cada cliente tiene sus propios viajes y no pisa los de otro', async () => {
    const m6 = await levantar();

    await cargarEjemplo(m6, CLIENTE);
    await cargarEjemplo(m6, OTRO_CLIENTE);

    expect(m6.estado.listar({ clientId: CLIENTE })).toHaveLength(2);
    expect(m6.estado.listar({ clientId: OTRO_CLIENTE })).toHaveLength(2);
  });

  it('un clienteId que no es UUID da 400 problem+json y no guarda nada', async () => {
    const m6 = await levantar();

    const respuesta = await cargarEjemplo(m6, 'no-es-un-uuid');

    expect(respuesta.status).toBe(400);
    expect(respuesta.headers.get('content-type')).toContain('application/problem+json');
    expect(m6.estado.listar({ state: 'COMPLETED' })).toHaveLength(0);
  });
});

describe('escenarios (RNF-13.5)', () => {
  it('devuelve completado (201), en curso (422), ajeno (404) e inexistente (404) con el id de cada uno', async () => {
    const m6 = await levantar();

    const cuerpo = (await (await cargarEjemplo(m6)).json()) as { clienteId: string; escenarios: unknown[] };

    const ids = idsDeEjemplo(CLIENTE);
    expect(cuerpo.clienteId).toBe(CLIENTE);
    expect(cuerpo.escenarios).toEqual([
      { nombre: 'completado', viajeId: ids.completado, respuestaDeM2: 201 },
      { nombre: 'enCurso', viajeId: ids.enCurso, respuestaDeM2: 422 },
      { nombre: 'ajeno', viajeId: AJENO, respuestaDeM2: 404 },
      { nombre: 'inexistente', viajeId: INEXISTENTE, respuestaDeM2: 404 },
    ]);
  });

  it('cada escenario es lo que M6 tiene guardado: el ajeno es de otro cliente y el inexistente no existe', async () => {
    const m6 = await levantar();
    await cargarEjemplo(m6);

    const ids = idsDeEjemplo(CLIENTE);
    expect(((await (await aApi(m6, `/trips/${ids.enCurso}`)).json()) as { state: string }).state).toBe('IN_PROGRESS');
    const ajeno = (await (await aApi(m6, `/trips/${AJENO}`)).json()) as { state: string; clientId: string };
    expect(ajeno.state).toBe('COMPLETED');
    expect(ajeno.clientId).not.toBe(CLIENTE);
    expect((await aApi(m6, `/trips/${INEXISTENTE}`)).status).toBe(404);
  });

  it('el ajeno y el inexistente son los mismos para todos los clientes', async () => {
    const m6 = await levantar();

    const uno = (await (await cargarEjemplo(m6, CLIENTE)).json()) as { escenarios: { nombre: string; viajeId: string }[] };
    const otro = (await (await cargarEjemplo(m6, OTRO_CLIENTE)).json()) as { escenarios: { nombre: string; viajeId: string }[] };

    const fijos = (c: typeof uno) => c.escenarios.filter((e) => e.nombre === 'ajeno' || e.nombre === 'inexistente');
    expect(fijos(uno)).toEqual(fijos(otro));
    // El ajeno se guarda una sola vez, aunque se cargue el ejemplo de dos clientes.
    expect(m6.estado.listar({ clientId: '55555555-5555-4555-8555-555555555555' })).toHaveLength(1);
  });
});

describe('modos', () => {
  it('arranca en normal y el estado informa el modo y el retardo del lento', async () => {
    const m6 = await levantar();

    const respuesta = await aControl(m6, '/control/estado');

    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ modo: 'normal', retardoLentoMs: RETARDO_MS });
  });

  it('PUT modo cambia el modo y responde el estado', async () => {
    const m6 = await levantar();

    const respuesta = await ponerModo(m6, 'lento');

    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ modo: 'lento', retardoLentoMs: RETARDO_MS });
    expect(await (await aControl(m6, '/control/estado')).json()).toEqual({ modo: 'lento', retardoLentoMs: RETARDO_MS });
  });

  it.each([['rapido'], ['NORMAL'], [''], [null], [3], [undefined]])('un modo inválido (%j) da 400 y no cambia nada', async (modo) => {
    const m6 = await levantar();

    const respuesta = await ponerModo(m6, modo);

    expect(respuesta.status).toBe(400);
    expect(respuesta.headers.get('content-type')).toContain('application/problem+json');
    expect(((await (await aControl(m6, '/control/estado')).json()) as { modo: string }).modo).toBe('normal');
  });

  it('un cuerpo que no es JSON o falta da 400', async () => {
    const m6 = await levantar();

    const roto = await aControl(m6, '/control/modo', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"modo":' });
    const vacio = await aControl(m6, '/control/modo', { method: 'PUT' });

    expect(roto.status).toBe(400);
    expect(vacio.status).toBe(400);
  });

  it('en modo lento la respuesta de la API tarda al menos M6_RETARDO_LENTO_MS, y en normal no', async () => {
    const m6 = await levantar();
    const headers = await comoM2(m6);
    const pedir = async () => {
      const inicio = performance.now();
      const respuesta = await fetch(`http://127.0.0.1:${m6.puerto}/api/v1/trips/${INEXISTENTE}`, { headers });
      return { estado: respuesta.status, ms: performance.now() - inicio };
    };

    const rapida = await pedir();
    await ponerModo(m6, 'lento');
    const lenta = await pedir();
    await ponerModo(m6, 'normal');
    const otraVezRapida = await pedir();

    // El reloj de `performance` y el temporizador pueden diferir un par de milisegundos.
    expect(lenta.ms).toBeGreaterThanOrEqual(RETARDO_MS - 5);
    expect(lenta.estado).toBe(404);
    expect(rapida.ms).toBeLessThan(RETARDO_MS / 2);
    expect(otraVezRapida.ms).toBeLessThan(RETARDO_MS / 2);
  });

  it('en modo lento el token se verifica antes de esperar: sin token es 401 enseguida', async () => {
    const m6 = await levantar();
    await ponerModo(m6, 'lento');

    const inicio = performance.now();
    const respuesta = await fetch(`http://127.0.0.1:${m6.puerto}/api/v1/trips/${INEXISTENTE}`);

    expect(respuesta.status).toBe(401);
    expect(performance.now() - inicio).toBeLessThan(RETARDO_MS / 2);
  });

  it('en modo caído el puerto de la API rechaza conexiones y el de control sigue respondiendo', async () => {
    const m6 = await levantar();
    expect(await escucha(m6.puerto)).toBe(true);

    const respuesta = await ponerModo(m6, 'caido');

    expect(respuesta.status).toBe(200);
    expect(await escucha(m6.puerto)).toBe(false);
    await expect(aApi(m6, `/trips/${INEXISTENTE}`)).rejects.toThrow();
    expect(await (await aControl(m6, '/control/estado')).json()).toEqual({ modo: 'caido', retardoLentoMs: RETARDO_MS });
    expect((await cargarEjemplo(m6)).status).toBe(200);
  });

  it('volver a normal (o a lento) reabre el puerto de la API con los viajes que había', async () => {
    const m6 = await levantar();
    await cargarEjemplo(m6);
    const { completado } = idsDeEjemplo(CLIENTE);
    await ponerModo(m6, 'caido');

    await ponerModo(m6, 'normal');
    expect((await aApi(m6, `/trips/${completado}`)).status).toBe(200);

    await ponerModo(m6, 'caido');
    await ponerModo(m6, 'lento');
    expect(await escucha(m6.puerto)).toBe(true);
  });

  it('pedir caído estando caído, o normal estando normal, no falla', async () => {
    const m6 = await levantar();

    expect((await ponerModo(m6, 'normal')).status).toBe(200);
    expect((await ponerModo(m6, 'caido')).status).toBe(200);
    expect((await ponerModo(m6, 'caido')).status).toBe(200);
    expect(await escucha(m6.puerto)).toBe(false);
  });

  it('pasar a caído corta un pedido lento que estaba esperando, sin esperar a que termine', async () => {
    const m6 = await levantar();
    const headers = await comoM2(m6);
    await ponerModo(m6, 'lento');
    const pendiente = fetch(`http://127.0.0.1:${m6.puerto}/api/v1/trips/${INEXISTENTE}`, { headers }).then(
      () => 'respondió',
      () => 'cortado',
    );
    await new Promise((resolver) => setTimeout(resolver, 50));

    const inicio = performance.now();
    await ponerModo(m6, 'caido');

    expect(await pendiente).toBe('cortado');
    expect(performance.now() - inicio).toBeLessThan(RETARDO_MS / 2);
  });

  it('dos cambios de modo a la vez se aplican de a uno, en el orden en que llegaron', async () => {
    // Un puerto de mentira cuya apertura tarda: si el cierre del segundo pedido corriera mientras abre, no encontraría nada
    // que cerrar y el puerto quedaría abierto con el modo en caído.
    const pasos: string[] = [];
    const api = {
      abrir: async () => {
        pasos.push('abre');
        await new Promise((resolver) => setTimeout(resolver, 80));
        pasos.push('abrió');
      },
      cerrar: async () => {
        pasos.push('cierra');
      },
    };
    const estado = crearEstadoM6();
    const control = construirAppControl({ config: CONFIG_M6, estado, api, flujoLog: descartarLogs });
    const modo = (modo: string) =>
      control.inject({
        method: 'PUT',
        url: '/control/modo',
        headers: { host: `127.0.0.1:${CONFIG_M6.puertoControl}`, 'content-type': 'application/json' },
        payload: JSON.stringify({ modo }),
      });

    const [primera, segunda] = await Promise.all([modo('normal'), modo('caido')]);
    await control.close();

    expect([primera.statusCode, segunda.statusCode]).toEqual([200, 200]);
    expect(pasos).toEqual(['abre', 'abrió', 'cierra']);
    expect(estado.modo()).toBe('caido');
  });

  it('si el puerto no se puede abrir, responde 500 y el modo no cambia', async () => {
    const api = {
      abrir: async () => {
        throw new Error('EADDRINUSE');
      },
      cerrar: async () => {},
    };
    const estado = crearEstadoM6();
    estado.cambiarModo('caido');
    const control = construirAppControl({ config: CONFIG_M6, estado, api, flujoLog: descartarLogs });

    const respuesta = await control.inject({
      method: 'PUT',
      url: '/control/modo',
      headers: { host: `127.0.0.1:${CONFIG_M6.puertoControl}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ modo: 'normal' }),
    });
    await control.close();

    expect(respuesta.statusCode).toBe(500);
    expect(respuesta.body).not.toContain('EADDRINUSE');
    expect(estado.modo()).toBe('caido');
  });
});

describe('defensa del canal de control: Host y Origin', () => {
  const hostsBuenos = (puerto: number) => [`localhost:${puerto}`, `127.0.0.1:${puerto}`, `[::1]:${puerto}`, `m6:${puerto}`, `LOCALHOST:${puerto}`];

  it('acepta los nombres de la propia máquina y el del servicio `m6`, con el puerto del canal', async () => {
    const m6 = await levantar();

    for (const host of hostsBuenos(m6.puertoControl)) {
      const cruda = await porSocket(m6.puertoControl, `GET /control/estado HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
      expect(leerRespuesta(cruda).estado, host).toContain(' 200 ');
    }
  });

  it.each([
    ['otro nombre', (p: number) => `evil.test:${p}`],
    ['un nombre que resuelve a la propia máquina', (p: number) => `127.0.0.1.nip.io:${p}`],
    ['otro puerto', (p: number) => `localhost:${p + 1}`],
    ['sin puerto', () => 'localhost'],
    ['`m6` sin puerto', () => 'm6'],
    ['`m6` con un sufijo', (p: number) => `m6.evil.test:${p}`],
    ['una IP ajena', (p: number) => `10.0.0.5:${p}`],
  ])('rechaza con 403 un Host ajeno: %s', async (_nombre, hostDe) => {
    const m6 = await levantar();

    const cruda = await porSocket(m6.puertoControl, `GET /control/estado HTTP/1.1\r\nHost: ${hostDe(m6.puertoControl)}\r\nConnection: close\r\n\r\n`);

    const { estado, encabezados, resto } = leerRespuesta(cruda);
    expect(estado).toContain(' 403 ');
    expect(encabezados['content-type']).toContain('application/problem+json');
    // No repite lo que recibió (si no tiene puerto, el texto fijo del mensaje ya lo nombra).
    const recibido = hostDe(m6.puertoControl);
    if (recibido.includes(':')) expect(resto).not.toContain(recibido);
  });

  it('rechaza con 403 un pedido sin Host', async () => {
    const m6 = await levantar();

    const cruda = await porSocket(m6.puertoControl, 'GET /control/estado HTTP/1.0\r\n\r\n');

    expect(leerRespuesta(cruda).estado).toContain(' 403 ');
  });

  it('rechaza el Host ajeno en las tres rutas y en una que no existe, y no ejecuta nada', async () => {
    const m6 = await levantar();
    const host = `evil.test:${m6.puertoControl}`;
    const json = { 'content-type': 'application/json' };

    const respuestas = [
      await aControl(m6, '/control/estado', { host }),
      await aControl(m6, '/control/modo', { host, method: 'PUT', headers: json, body: JSON.stringify({ modo: 'caido' }) }),
      await aControl(m6, `/control/clientes/${CLIENTE}/ejemplo`, { host, method: 'POST' }),
      await aControl(m6, '/control/no-existe', { host, method: 'POST' }),
    ];

    expect(respuestas.map((r) => r.status)).toEqual([403, 403, 403, 403]);
    expect(await escucha(m6.puerto)).toBe(true);
    expect(m6.estado.listar({ state: 'COMPLETED' })).toHaveLength(0);
    expect(((await (await aControl(m6, '/control/estado')).json()) as { modo: string }).modo).toBe('normal');
  });

  it.each([
    ['POST', (c: string) => `/control/clientes/${c}/ejemplo`],
    ['PUT', () => '/control/modo'],
  ])('rechaza con 403 un %s que trae Origin, aunque sea el del propio canal: lo manda un navegador, no el panel', async (metodo, ruta) => {
    const m6 = await levantar();
    const host = `127.0.0.1:${m6.puertoControl}`;

    for (const origin of [`http://${host}`, 'https://evil.test', 'null']) {
      const respuesta = await aControl(m6, ruta(CLIENTE), {
        method: metodo,
        headers: { origin, 'content-type': 'application/json' },
        body: metodo === 'PUT' ? JSON.stringify({ modo: 'caido' }) : undefined,
      });
      expect(respuesta.status, origin).toBe(403);
    }
    expect(await escucha(m6.puerto)).toBe(true);
    expect(m6.estado.listar({ state: 'COMPLETED' })).toHaveLength(0);
  });

  it('no hay CORS: ninguna respuesta trae Access-Control-* y una consulta previa no recibe permiso', async () => {
    const m6 = await levantar();

    const previa = await aControl(m6, '/control/modo', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.test', 'access-control-request-method': 'PUT' },
    });
    const consulta = await aControl(m6, '/control/estado', { headers: { origin: 'https://evil.test' } });

    for (const respuesta of [previa, consulta]) {
      expect([...respuesta.headers.keys()].filter((h) => h.startsWith('access-control-'))).toEqual([]);
    }
    expect(previa.status).toBeGreaterThanOrEqual(400);
  });
});

describe('logs del canal de control', () => {
  it('una línea por pedido con la plantilla de la ruta, sin el clienteId', async () => {
    const logs = capturarLogs();
    const m6 = await levantar({ flujoLog: logs.flujo });

    await cargarEjemplo(m6);
    await aControl(m6, '/control/estado');
    await ponerModo(m6, 'lento');
    await new Promise((resolver) => setTimeout(resolver, 20));

    const pedidos = logs.lineas().filter((l) => l.msg === 'Pedido terminado');
    expect(pedidos.map((l) => [l['metodo'], l['ruta'], l['estado']])).toEqual([
      ['POST', '/control/clientes/:clienteId/ejemplo', 200],
      ['GET', '/control/estado', 200],
      ['PUT', '/control/modo', 200],
    ]);
    expect(logs.texto()).not.toContain(CLIENTE);
  });
});
