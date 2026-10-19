import type { InjectOptions } from 'fastify';
import { describe, expect, it } from 'vitest';
import type { Manejador } from '../../src/contrato/operaciones.js';
import { crearApp } from '../ayudas/app.js';
import { escuchar, leerRespuesta, porSocket } from '../ayudas/socket.js';

const ENCABEZADO = 'x-request-id';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const COMO_JSON = { 'content-type': 'application/json' };

const bien: Manejador = async () => ({ ok: true });
const falla: Manejador = async () => {
  throw new Error('falla interna');
};
// Devuelve el id que Fastify le dio a la solicitud.
const devuelveId: Manejador = async (request) => ({ id: request.id });

const MANEJADORES = { probarPublica: devuelveId, probarAlta: bien, probarFalla: falla };

type Pedido = { caso: string; estado: number; solicitud: InjectOptions };

// Una respuesta buena y una de cada error genérico que el servicio responde hoy: todas tienen que traer el encabezado.
const PEDIDOS: Pedido[] = [
  { caso: '200: una operación responde', estado: 200, solicitud: { method: 'GET', url: '/pruebas/publica?x=1' } },
  {
    caso: '400: un campo no cumple el contrato',
    estado: 400,
    solicitud: { method: 'POST', url: '/pruebas/clientes', headers: COMO_JSON, payload: { nombre: 'Ana' } },
  },
  {
    caso: '400: el JSON está roto',
    estado: 400,
    solicitud: { method: 'POST', url: '/pruebas/clientes', headers: COMO_JSON, payload: '{"nombre": ' },
  },
  { caso: '404: la ruta no existe', estado: 404, solicitud: { method: 'GET', url: '/no/existe' } },
  { caso: '405: la ruta no tiene el método', estado: 405, solicitud: { method: 'DELETE', url: '/pruebas/publica' } },
  {
    caso: '413: el cuerpo supera 1 MiB',
    estado: 413,
    solicitud: {
      method: 'POST',
      url: '/pruebas/clientes',
      headers: COMO_JSON,
      payload: `{"a":"${'a'.repeat(1024 * 1024)}"}`,
    },
  },
  {
    caso: '415: el cuerpo no es JSON',
    estado: 415,
    solicitud: { method: 'POST', url: '/pruebas/clientes', headers: { 'content-type': 'text/plain' }, payload: 'hola' },
  },
  { caso: '500: un manejador falla', estado: 500, solicitud: { method: 'GET', url: '/pruebas/falla' } },
];

// Valores que no cumplen el patrón de RNF-14.3 y llegan tal cual por inject (los repetidos van por un socket, más abajo).
const INVALIDOS = [
  ['está vacío', ''],
  ['tiene un espacio', 'dos palabras'],
  ['tiene otros caracteres', 'id/con?otros=caracteres'],
  ['tiene 129 caracteres', 'a'.repeat(129)],
] as const;

const enviar = (pedido: Pedido, encabezados: Record<string, string> = {}) =>
  crearApp(MANEJADORES).inject({ ...pedido.solicitud, headers: { ...pedido.solicitud.headers, ...encabezados } });

describe('construirApp: devuelve el identificador de correlación en cada respuesta (RNF-14.3, RNF-14.4)', () => {
  describe.each(PEDIDOS)('$caso', (pedido) => {
    it('respeta el que llega si cumple el patrón', async () => {
      const respuesta = await enviar(pedido, { [ENCABEZADO]: 'cliente-1.a_B' });

      expect(respuesta.statusCode).toBe(pedido.estado);
      expect(respuesta.headers[ENCABEZADO]).toBe('cliente-1.a_B');
    });

    it.each(INVALIDOS)('lo reemplaza por un UUID si %s', async (_caso, invalido) => {
      const respuesta = await enviar(pedido, { [ENCABEZADO]: invalido });

      expect(respuesta.statusCode).toBe(pedido.estado);
      expect(respuesta.headers[ENCABEZADO]).toMatch(UUID_V4);
    });

    it('genera un UUID si no llega', async () => {
      const respuesta = await enviar(pedido);

      expect(respuesta.statusCode).toBe(pedido.estado);
      expect(respuesta.headers[ENCABEZADO]).toMatch(UUID_V4);
    });
  });

  it('un id válido de 128 caracteres se respeta, y uno de 129 se reemplaza', async () => {
    const app = crearApp(MANEJADORES);
    const url = '/pruebas/publica';

    const respetado = await app.inject({ method: 'GET', url, headers: { [ENCABEZADO]: 'a'.repeat(128) } });
    const reemplazado = await app.inject({ method: 'GET', url, headers: { [ENCABEZADO]: 'a'.repeat(129) } });

    expect(respetado.headers[ENCABEZADO]).toBe('a'.repeat(128));
    expect(reemplazado.headers[ENCABEZADO]).toMatch(UUID_V4);
  });

  it('cada solicitud sin id recibe uno distinto', async () => {
    const app = crearApp(MANEJADORES);

    const respuestas = await Promise.all(
      Array.from({ length: 20 }, () => app.inject({ method: 'GET', url: '/pruebas/publica' })),
    );

    expect(new Set(respuestas.map((respuesta) => respuesta.headers[ENCABEZADO])).size).toBe(20);
  });

  it('solicitudes en paralelo, cada una con el suyo', async () => {
    const app = crearApp(MANEJADORES);

    const respuestas = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        app.inject({ method: 'GET', url: '/pruebas/publica', headers: { [ENCABEZADO]: `paralelo-${i}` } }),
      ),
    );

    expect(respuestas.map((respuesta) => respuesta.headers[ENCABEZADO])).toEqual(
      Array.from({ length: 20 }, (_, i) => `paralelo-${i}`),
    );
  });

  it('es el id de la solicitud (request.id) que ve el manejador', async () => {
    const app = crearApp(MANEJADORES);

    const conId = await app.inject({ method: 'GET', url: '/pruebas/publica', headers: { [ENCABEZADO]: 'cliente-1' } });
    const sinId = await app.inject({ method: 'GET', url: '/pruebas/publica' });

    expect(conId.json()).toEqual({ id: 'cliente-1' });
    expect(sinId.json().id).toMatch(UUID_V4);
    expect(sinId.json().id).toBe(sinId.headers[ENCABEZADO]);
  });

  it('no usa el encabezado request-id, que Fastify leía por defecto en la versión 4', async () => {
    const respuesta = await crearApp(MANEJADORES).inject({
      method: 'GET',
      url: '/pruebas/publica',
      headers: { 'request-id': 'otro-id' },
    });

    expect(respuesta.headers[ENCABEZADO]).toMatch(UUID_V4);
  });
});

describe('construirApp: con otro nombre de encabezado de correlación (RNF-06.1, RNF-14.3, RNF-14.4)', () => {
  const config = { encabezadoCorrelacion: 'X-Correlacion' };

  it('lee y devuelve el id con ese nombre, aunque se haya escrito con mayúsculas', async () => {
    const respuesta = await crearApp(MANEJADORES, { config }).inject({
      method: 'GET',
      url: '/pruebas/publica',
      headers: { 'x-correlacion': 'mio-1', [ENCABEZADO]: 'ajeno-1' },
    });

    expect(respuesta.headers['x-correlacion']).toBe('mio-1');
    expect(respuesta.headers[ENCABEZADO]).toBeUndefined();
    expect(respuesta.json()).toEqual({ id: 'mio-1' });
  });

  it('si no llega con ese nombre, genera un UUID y no toma el X-Request-Id', async () => {
    const respuesta = await crearApp(MANEJADORES, { config }).inject({
      method: 'GET',
      url: '/pruebas/publica',
      headers: { [ENCABEZADO]: 'ajeno-1' },
    });

    expect(respuesta.headers['x-correlacion']).toMatch(UUID_V4);
    expect(respuesta.headers[ENCABEZADO]).toBeUndefined();
  });

  it('también en un error', async () => {
    const respuesta = await crearApp(MANEJADORES, { config }).inject({
      method: 'GET',
      url: '/no/existe',
      headers: { 'x-correlacion': 'mio-2' },
    });

    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.headers['x-correlacion']).toBe('mio-2');
  });
});

describe('construirApp: el identificador de correlación por un socket (RNF-14.3, RNF-14.4)', () => {
  const pedido = (metodo: string, url: string, encabezados: string[]) =>
    [`${metodo} ${url} HTTP/1.1`, 'Host: localhost', ...encabezados, 'Connection: close', '', ''].join('\r\n');

  // inject no repite un encabezado como lo hace Node con una conexión real: los junta con «, » antes de entregarlos.
  it('un id repetido se reemplaza por un UUID, y uno solo se respeta', async () => {
    const puerto = await escuchar(crearApp(MANEJADORES));

    const uno = leerRespuesta(await porSocket(puerto, pedido('GET', '/pruebas/publica', ['X-Request-Id: abc'])));
    const dos = leerRespuesta(
      await porSocket(puerto, pedido('GET', '/pruebas/publica', ['X-Request-Id: abc', 'X-Request-Id: abc'])),
    );

    expect(uno.estado).toBe('HTTP/1.1 200 OK');
    expect(uno.encabezados[ENCABEZADO]).toBe('abc');
    expect(dos.estado).toBe('HTTP/1.1 200 OK');
    expect(dos.encabezados[ENCABEZADO]).toMatch(UUID_V4);
  });

  it('la respuesta a HEAD también lo trae', async () => {
    const puerto = await escuchar(crearApp(MANEJADORES));

    const respuesta = leerRespuesta(await porSocket(puerto, pedido('HEAD', '/pruebas/publica', ['X-Request-Id: head-1'])));

    expect(respuesta.estado).toBe('HTTP/1.1 405 Method Not Allowed');
    expect(respuesta.encabezados[ENCABEZADO]).toBe('head-1');
  });
});
