import type { FastifyInstance, FastifyRequest } from 'fastify';
import { once } from 'node:events';
import type { IncomingMessage, Server } from 'node:http';
import net, { type Socket } from 'node:net';
import { describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Config } from '../../src/config.js';
import type { Manejador } from '../../src/contrato/operaciones.js';
import { crearApp } from '../ayudas/app.js';
import { capturarLogs } from '../ayudas/logs.js';
import { escuchar, leerRespuesta, porSocket } from '../ayudas/socket.js';
import { AUTORIZADO } from '../ayudas/tokens.js';

const ENCABEZADO = 'x-request-id';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROBLEMA_JSON = /^application\/problem\+json/;
const MENSAJE = 'Solicitud terminada';
// Lo que pino suma a cada línea por su cuenta: no sale de la solicitud.
const BASE_DE_PINO = ['level', 'time', 'pid', 'hostname'];
const CLIENTE_ID = '0b9b7e2e-5f5c-4d7a-9a0e-3c1d2f4a6b8c';
const DIRECCION_ID = '7d1c3a5e-9b2f-4e6a-8c0d-1f2a3b4c5d6e';
// Una query string con datos personales: no tiene que llegar ni a `instance` ni al log.
const QUERY = '?dni=12345678';
// Lo que manda el cliente y no tiene que aparecer en el log.
const PRIVADOS = ['12345678', 'cliente-1', 'token-secreto'];

const bien: Manejador = async () => ({ ok: true });
const MANEJADORES = { probarPublica: bien, probarParametros: bien, probarAlta: bien };

type Logs = ReturnType<typeof capturarLogs>;
const deLaSolicitud = (logs: Logs) => logs.lineas().filter((linea) => linea.msg === MENSAJE);
const camposPropios = (linea: object) => Object.keys(linea).filter((campo) => !BASE_DE_PINO.includes(campo)).sort();
const crear = (config: Partial<Config> = {}) => {
  const logs = capturarLogs();
  return { app: crearApp(MANEJADORES, { config, flujoLog: logs.flujo }), logs };
};

const URL_INVALIDA = {
  type: 'about:blank',
  title: 'Solicitud inválida',
  status: 400,
  detail: 'La URL no es válida, o un parámetro de la ruta supera los 100 caracteres',
};

const LARGO = 'a'.repeat(101);
const MAL_CODIFICADA = '/pruebas/%E0%A4%A';
const CON_PARAMETRO_LARGO = `/pruebas/clientes/${LARGO}/direcciones/${DIRECCION_ID}`;

// Lo que Fastify detecta al buscar la ruta, antes de crear la solicitud. Las pruebas les suman la query string, que la
// instancia no trae.
const URLS = [
  ['tiene un % que no codifica nada', '/pruebas/%zz'],
  ['tiene un carácter UTF-8 cortado', MAL_CODIFICADA],
  ['termina en %', '/pruebas/publica%'],
  ['está mal codificada y es de una ruta que no existe (no se llega a buscar)', '/no/existe/%zz'],
  ['tiene un parámetro de ruta de 101 caracteres', CON_PARAMETRO_LARGO],
  ['tiene el segundo parámetro de ruta de 101 caracteres', `/pruebas/clientes/${CLIENTE_ID}/direcciones/${LARGO}`],
  ['tiene un parámetro que, decodificado, mide 101 caracteres', `/pruebas/clientes/${'%61'.repeat(101)}/direcciones/x`],
] as const;

describe('construirApp: la URL mal codificada y el parámetro de ruta largo, 400 en problem+json (RNF-03.1, RNF-03.2)', () => {
  it.each(URLS)('la URL %s', async (_caso, url) => {
    const respuesta = await crearApp(MANEJADORES).inject({ method: 'GET', url: `${url}${QUERY}` });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
    expect(respuesta.json()).toEqual({ ...URL_INVALIDA, instance: url });
  });

  it('un parámetro de 100 caracteres no es largo: sigue a la validación del contrato', async () => {
    const url = `/pruebas/clientes/${'a'.repeat(100)}/direcciones/${DIRECCION_ID}`;

    const respuesta = await crearApp(MANEJADORES).inject({ method: 'GET', url, headers: AUTORIZADO });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json()).toEqual({
      ...URL_INVALIDA,
      detail: 'El parámetro clienteId de la ruta no tiene el formato uuid',
      instance: url,
    });
  });

  // RNF-03.5: lo que no se puede leer va antes que el 405.
  it('con un método que la ruta no tiene, el parámetro largo da 400 y no 405', async () => {
    const respuesta = await crearApp(MANEJADORES).inject({ method: 'DELETE', url: CON_PARAMETRO_LARGO });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.headers.allow).toBeUndefined();
    expect(respuesta.json()).toEqual({ ...URL_INVALIDA, instance: CON_PARAMETRO_LARGO });
  });

  it('un segmento largo donde la ruta no tiene un parámetro es una ruta que no existe: 404', async () => {
    const respuesta = await crearApp(MANEJADORES).inject({ method: 'GET', url: `/no/existe/${LARGO}` });

    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.json().detail).toBe('No existe la ruta pedida');
  });

  describe.each([
    ['mal codificada', MAL_CODIFICADA],
    ['con un parámetro de 101 caracteres', CON_PARAMETRO_LARGO],
  ])('la URL %s', (_caso, url) => {
    it('respeta el id de correlación que llega, si cumple el patrón (RNF-14.3, RNF-14.4)', async () => {
      const respuesta = await crearApp(MANEJADORES).inject({ method: 'GET', url, headers: { [ENCABEZADO]: 'cliente-1' } });

      expect(respuesta.statusCode).toBe(400);
      expect(respuesta.headers[ENCABEZADO]).toBe('cliente-1');
    });

    it.each([
      ['no llega', {}],
      ['no cumple el patrón', { [ENCABEZADO]: 'dos palabras' }],
    ])('si el id %s, devuelve un UUID nuevo (RNF-14.3, RNF-14.4)', async (_motivo, headers) => {
      const respuesta = await crearApp(MANEJADORES).inject({ method: 'GET', url, headers });

      expect(respuesta.statusCode).toBe(400);
      expect(respuesta.headers[ENCABEZADO]).toMatch(UUID_V4);
    });

    it('devuelve el id en el encabezado configurado, si es otro (RNF-06.1, RNF-14.4)', async () => {
      const { app } = crear({ encabezadoCorrelacion: 'X-Correlation-Id' });

      const respuesta = await app.inject({ method: 'GET', url, headers: { 'x-correlation-id': 'otro-1' } });

      expect(respuesta.statusCode).toBe(400);
      expect(respuesta.headers['x-correlation-id']).toBe('otro-1');
      expect(respuesta.headers[ENCABEZADO]).toBeUndefined();
    });

    // Durante la parada, Fastify pone Connection: close solo en lo que llega a una ruta (plan, Lógica 13).
    it('deja abierta la conexión, salvo durante la parada (RNF-04.5)', async () => {
      const app = crearApp(MANEJADORES);

      const antes = await app.inject({ method: 'GET', url });
      app.deteniendose = true;
      const durante = await app.inject({ method: 'GET', url });

      expect(antes.headers.connection).toBe('keep-alive');
      expect(durante.statusCode).toBe(400);
      expect(durante.headers.connection).toBe('close');
    });

    it('deja una línea con el id, el método, la ruta sin query string, el estado y la duración (RNF-14.6)', async () => {
      const { app, logs } = crear();

      await app.inject({
        method: 'GET',
        url: `${url}${QUERY}`,
        headers: { [ENCABEZADO]: 'id-del-log', authorization: 'Bearer token-secreto' },
      });

      const [linea, ...otras] = deLaSolicitud(logs);
      expect(otras).toEqual([]);
      expect(linea).toMatchObject({ level: 30, idCorrelacion: 'id-del-log', metodo: 'GET', ruta: url, estado: 400 });
      expect(camposPropios(linea)).toEqual(['duracionMs', 'estado', 'idCorrelacion', 'metodo', 'msg', 'ruta']);
      // El reloj de Fastify (reply.elapsedTime) no arranca para estas respuestas: daría 0.
      expect(linea.duracionMs).toBeGreaterThan(0);
      expect(linea.duracionMs).toBeLessThan(1000);
      // Un 400 es una respuesta prevista: no deja una línea de error (RNF-03.3), ni la query string ni el token (RNF-19.2).
      expect(logs.lineas()).toHaveLength(1);
      for (const privado of PRIVADOS) expect(logs.texto()).not.toContain(privado);
    });
  });

  // Fastify también le pasa a frameworkErrors el error de una restricción asíncrona. El servicio no registra restricciones,
  // así que hoy no puede pasar; si pasara, es un error no previsto (RNF-03.3).
  it('el error de una restricción asíncrona da 500 en problem+json y queda en el log con su id (RNF-03.3)', async () => {
    const { app, logs } = crear();
    const rutas = new Map<string, unknown>();
    // Los tipos de find-my-way no declaran la forma asíncrona de deriveConstraint, que recibe `done` como tercer argumento.
    app.addConstraintStrategy({
      name: 'falla',
      mustMatchWhenDerived: true,
      storage: () => ({
        get: (valor: string) => rutas.get(valor) ?? null,
        set: (valor: string, ruta: unknown) => rutas.set(valor, ruta),
      }),
      deriveConstraint: (_req: unknown, _ctx: unknown, done: (error: Error) => void) => done(new Error('la restricción falló')),
    } as unknown as Parameters<FastifyInstance['addConstraintStrategy']>[0]);
    // Toda ruta declara sus permisos (Lógica 4). Los de esta no se llegan a mirar: la restricción falla antes que los hooks.
    app.route({
      method: 'GET',
      url: '/con-restriccion',
      constraints: { falla: 'x' },
      config: { permisos: { publica: true, roles: [] } },
      handler: bien,
    });

    const respuesta = await app.inject({ method: 'GET', url: `/con-restriccion${QUERY}`, headers: { [ENCABEZADO]: 'id-500' } });

    expect(respuesta.statusCode).toBe(500);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
    expect(respuesta.headers[ENCABEZADO]).toBe('id-500');
    expect(respuesta.json()).toEqual({
      type: 'about:blank',
      title: 'Error interno',
      status: 500,
      detail: 'Ocurrió un error interno',
      instance: '/con-restriccion',
    });
    expect(logs.lineas()).toMatchObject([
      { level: 50, msg: 'Error interno', idCorrelacion: 'id-500', err: { codigo: 'FST_ERR_ASYNC_CONSTRAINT' } },
      { level: 30, msg: MENSAJE, idCorrelacion: 'id-500', metodo: 'GET', ruta: '/con-restriccion', estado: 500 },
    ]);
  });
});

// Un pedido crudo: la línea de la solicitud y los encabezados que se pasen, más un id de correlación válido y un token,
// que no se usan ni se registran (la solicitud no se pudo leer), y la línea en blanco que cierra los encabezados.
const crudo = (linea: string, ...encabezados: string[]) =>
  [linea, ...encabezados, 'X-Request-Id: cliente-1', 'Authorization: Bearer token-secreto', '', ''].join('\r\n');

const NO_SE_PUDO_LEER = {
  type: 'about:blank',
  title: 'Solicitud inválida',
  status: 400,
  detail: 'La solicitud no se pudo leer',
};

type Ilegible = {
  caso: string;
  pedido: string;
  terminar?: boolean;
  estado: string;
  cuerpo: { type: string; title: string; status: number; detail: string };
};

// Lo que Node no puede leer como HTTP y le pasa al manejador de errores de cliente, sin crear la solicitud.
const ILEGIBLES: Ilegible[] = [
  { caso: 'no es HTTP', pedido: 'ESTO NO ES HTTP\r\n\r\n', estado: 'HTTP/1.1 400 Bad Request', cuerpo: NO_SE_PUDO_LEER },
  {
    caso: 'la versión de HTTP no existe',
    pedido: crudo(`GET /pruebas/publica${QUERY} HTTP/9.9`, 'Host: localhost'),
    estado: 'HTTP/1.1 400 Bad Request',
    cuerpo: NO_SE_PUDO_LEER,
  },
  {
    caso: 'un encabezado no tiene los dos puntos',
    pedido: crudo(`GET /pruebas/publica${QUERY} HTTP/1.1`, 'Host localhost'),
    estado: 'HTTP/1.1 400 Bad Request',
    cuerpo: NO_SE_PUDO_LEER,
  },
  {
    caso: 'la URL tiene un espacio',
    pedido: crudo('GET /pruebas/con espacio HTTP/1.1', 'Host: localhost'),
    estado: 'HTTP/1.1 400 Bad Request',
    cuerpo: NO_SE_PUDO_LEER,
  },
  {
    caso: 'Content-Length no es un número',
    pedido: crudo('POST /pruebas/clientes HTTP/1.1', 'Host: localhost', 'Content-Length: abc'),
    estado: 'HTTP/1.1 400 Bad Request',
    cuerpo: NO_SE_PUDO_LEER,
  },
  {
    caso: 'el cliente cierra su lado con los encabezados a medias',
    pedido: `GET /pruebas/publica${QUERY} HTTP/1.1\r\nHost: localhost\r\nX-Request-Id: cliente-1\r\nX-A: b`,
    terminar: true,
    estado: 'HTTP/1.1 400 Bad Request',
    cuerpo: NO_SE_PUDO_LEER,
  },
  {
    caso: 'los encabezados superan 16 KiB',
    pedido: crudo(`GET /pruebas/publica${QUERY} HTTP/1.1`, 'Host: localhost', `X-Grande: ${'a'.repeat(16 * 1024)}`),
    estado: 'HTTP/1.1 431 Request Header Fields Too Large',
    cuerpo: {
      type: 'about:blank',
      title: 'Encabezados demasiado grandes',
      status: 431,
      detail: 'Los encabezados superan 16 KiB',
    },
  },
  {
    caso: 'la solicitud no termina de llegar a tiempo (ERR_HTTP_REQUEST_TIMEOUT)',
    pedido: `GET /pruebas/publica${QUERY} HTTP/1.1\r\nHost: localhost\r\nX-Request-Id: cliente-1\r\n`,
    estado: 'HTTP/1.1 408 Request Timeout',
    cuerpo: {
      type: 'about:blank',
      title: 'Tiempo agotado',
      status: 408,
      detail: 'La solicitud no terminó de llegar a tiempo',
    },
  },
];

// Node corta por tiempo una solicitud cuyos encabezados no terminan de llegar a los 60 s (headersTimeout; Fastify deja
// requestTimeout en 0) y lo revisa cada 30 s (connectionsCheckingInterval, que lee al empezar a escuchar). Acá se acortan
// los dos, para tener un ERR_HTTP_REQUEST_TIMEOUT real en un instante.
async function escucharConTiempoCorto(app: FastifyInstance) {
  const servidor = app.server as Server & { connectionsCheckingInterval: number };
  servidor.headersTimeout = 150;
  servidor.connectionsCheckingInterval = 20;
  return escuchar(app);
}

// El cuerpo de una respuesta cruda, que porSocket entrega byte por byte (latin1), leído como el UTF-8 que es.
const cuerpoDe = (resto: string): unknown => JSON.parse(Buffer.from(resto, 'latin1').toString('utf8'));

describe('construirApp: lo que no se puede leer como HTTP, por un socket (RNF-03.1, RNF-03.2, RNF-14.4)', () => {
  describe.each(ILEGIBLES)('$caso', ({ pedido, terminar, estado, cuerpo }) => {
    it('responde en problem+json, sin instance, con un id de correlación nuevo, y cierra la conexión', async () => {
      const puerto = await escucharConTiempoCorto(crearApp(MANEJADORES));

      const respuesta = leerRespuesta(await porSocket(puerto, pedido, { terminar }));

      expect(respuesta.estado).toBe(estado);
      expect(respuesta.encabezados['content-type']).toMatch(PROBLEMA_JSON);
      expect(respuesta.encabezados.connection).toBe('close');
      expect(respuesta.encabezados[ENCABEZADO]).toMatch(UUID_V4);
      // El largo va en bytes: el title y el detail tienen acentos.
      expect(Number(respuesta.encabezados['content-length'])).toBe(respuesta.resto.length);
      expect(cuerpoDe(respuesta.resto)).toEqual(cuerpo);
    });

    it('deja una línea con el id de la respuesta, el estado y la duración, sin método ni ruta (RNF-14.6)', async () => {
      const { app, logs } = crear();
      const puerto = await escucharConTiempoCorto(app);

      const respuesta = leerRespuesta(await porSocket(puerto, pedido, { terminar }));

      const [linea, ...otras] = deLaSolicitud(logs);
      expect(otras).toEqual([]);
      expect(linea).toMatchObject({ level: 30, idCorrelacion: respuesta.encabezados[ENCABEZADO], estado: cuerpo.status });
      expect(camposPropios(linea)).toEqual(['duracionMs', 'estado', 'idCorrelacion', 'msg']);
      expect(linea.duracionMs).toBeGreaterThan(0);
      expect(linea.duracionMs).toBeLessThan(1000);
      // Ni el error, que trae el pedido crudo (rawPacket), ni nada de lo que mandó el cliente (RNF-19.2). La otra línea es
      // la que escribe listen al empezar a escuchar.
      expect(logs.lineas().filter((otra) => otra.msg !== MENSAJE)).toMatchObject([{ msg: /^Server listening at / }]);
      for (const privado of PRIVADOS) expect(logs.texto()).not.toContain(privado);
    });
  });

  it('cada respuesta trae un id distinto', async () => {
    const puerto = await escuchar(crearApp(MANEJADORES));

    const ids = await Promise.all(
      [1, 2, 3].map(async () => leerRespuesta(await porSocket(puerto, 'ESTO NO ES HTTP\r\n\r\n')).encabezados[ENCABEZADO]),
    );

    expect(new Set(ids).size).toBe(3);
  });

  it('devuelve el id en el encabezado configurado, si es otro (RNF-06.1, RNF-14.4)', async () => {
    const puerto = await escuchar(crear({ encabezadoCorrelacion: 'X-Correlation-Id' }).app);

    const respuesta = leerRespuesta(await porSocket(puerto, 'ESTO NO ES HTTP\r\n\r\n'));

    expect(respuesta.estado).toBe('HTTP/1.1 400 Bad Request');
    expect(respuesta.encabezados['x-correlation-id']).toMatch(UUID_V4);
    expect(respuesta.encabezados[ENCABEZADO]).toBeUndefined();
  });

  it('con encabezados de 15 KiB responde la operación: el límite es el de Node, 16 KiB', async () => {
    const puerto = await escuchar(crearApp(MANEJADORES));
    const grande = `X-Grande: ${'a'.repeat(15 * 1024)}`;
    const pedido = crudo('GET /pruebas/publica HTTP/1.1', 'Host: localhost', 'Connection: close', grande);

    const respuesta = leerRespuesta(await porSocket(puerto, pedido));

    expect(respuesta.estado).toBe('HTTP/1.1 200 OK');
  });

  it('ante ECONNRESET no escribe nada en el socket ni deja línea en el log', async () => {
    const { app, logs } = crear();
    const delServidor: { socket: Socket; escrituras: MockInstance }[] = [];
    const errores: unknown[] = [];
    app.server.on('connection', (socket: Socket) => delServidor.push({ socket, escrituras: vi.spyOn(socket, 'write') }));
    app.server.on('clientError', (error: NodeJS.ErrnoException) => errores.push(error.code));
    const puerto = await escuchar(app);

    // Los encabezados a medias, para que Node no tenga nada que responder, y un RST recién cuando el servidor los leyó: si
    // llega antes, Node puede verlo como el fin de la conexión (HPE_INVALID_EOF_STATE) y no como ECONNRESET.
    const cliente = net.connect(puerto, '127.0.0.1');
    cliente.on('error', () => {});
    await once(cliente, 'connect');
    cliente.write('GET /pruebas/publica HTTP/1.1\r\nHost: localhost\r\n');
    await vi.waitFor(() => expect(delServidor[0]?.socket.bytesRead).toBeGreaterThan(0));
    cliente.resetAndDestroy();

    await vi.waitFor(() => expect(errores).toEqual(['ECONNRESET']));
    expect(delServidor).toHaveLength(1);
    expect(delServidor[0]?.escrituras).not.toHaveBeenCalled();
    expect(deLaSolicitud(logs)).toEqual([]);
  });
});

// Un POST a probarAlta con un token válido y los encabezados que se pasen, más la línea en blanco que los cierra: el
// cuerpo, entero o no, va después.
const altaCon = (...encabezados: string[]) =>
  [
    'POST /pruebas/clientes HTTP/1.1',
    'Host: localhost',
    `Authorization: ${AUTORIZADO.authorization}`,
    'Content-Type: application/json',
    ...encabezados,
    '',
    '',
  ].join('\r\n');

const deNivelError = (logs: Logs) => logs.lineas().filter((linea) => linea.level >= 50);

// Manda `inicio` (los encabezados y el principio del cuerpo), espera a que la app esté leyendo el cuerpo y recién entonces
// corta con `cortar`. Si el corte llegara antes, Fastify todavía no escucharía la solicitud y Node no le avisaría a nadie:
// la prueba pasaría sin llegar al manejador de errores. Devuelve lo que llegó por el socket y lo que la app intentó
// responder, que pasa por onSend aunque la conexión ya se haya cerrado; para entonces el manejador de errores ya corrió.
async function cortarMientrasLee(app: FastifyInstance, inicio: string, cortar: (cliente: Socket) => void) {
  const solicitudes: IncomingMessage[] = [];
  const intentadas: { estado: number; cuerpo: unknown }[] = [];
  app.server.on('request', (solicitud: IncomingMessage) => solicitudes.push(solicitud));
  app.addHook('onSend', async (_request, reply, payload) => {
    intentadas.push({ estado: reply.statusCode, cuerpo: JSON.parse(String(payload)) });
  });
  const puerto = await escuchar(app);
  const cliente = net.connect(puerto, '127.0.0.1');
  const partes: Buffer[] = [];
  cliente.on('data', (parte: Buffer) => partes.push(parte));
  cliente.on('error', () => {});
  const cerrado = new Promise((resolve) => cliente.on('close', resolve));
  await once(cliente, 'connect');
  cliente.write(inicio);
  // Fastify lee el cuerpo con un oyente de 'data': recién entonces la solicitud fluye.
  await vi.waitFor(() => expect(solicitudes[0]?.readableFlowing).toBe(true));
  cortar(cliente);
  await cerrado;
  await vi.waitFor(() => expect(intentadas).toHaveLength(1));
  expect(solicitudes).toHaveLength(1);
  return { recibido: Buffer.concat(partes).toString('latin1'), intentada: intentadas[0] };
}

// Si el cliente corta mientras se lee el cuerpo, Node corta la solicitud con ECONNRESET y Fastify se lo pasa al manejador de
// errores. Es una solicitud que no se pudo leer, no un error del servicio: un 400 que no se registra como error interno
// (RNF-03.3). Casi nunca sale, porque la conexión ya se cerró; si sigue abierta, el 400 que llega es el del manejador de
// errores de cliente, como a cualquier HTTP que no se puede leer.
describe('construirApp: el cliente corta mientras se lee el cuerpo, por un socket (RNF-03.2, RNF-03.3)', () => {
  // Content-Length de 50 y solo los primeros bytes del cuerpo.
  const A_MEDIAS = `${altaCon('Content-Length: 50')}{"nombre":`;
  const CORTE = { estado: 400, cuerpo: { ...NO_SE_PUDO_LEER, instance: '/pruebas/clientes' } };

  it('si corta la conexión (RST), la app responde 400 y no queda ninguna línea de error', async () => {
    const { app, logs } = crear();

    const { recibido, intentada } = await cortarMientrasLee(app, A_MEDIAS, (cliente) => cliente.resetAndDestroy());

    expect(recibido).toBe('');
    expect(intentada).toEqual(CORTE);
    expect(deNivelError(logs)).toEqual([]);
  });

  it('si cierra su lado, recibe el 400 de una solicitud que no se pudo leer y no queda ninguna línea de error', async () => {
    const { app, logs } = crear();

    const { recibido, intentada } = await cortarMientrasLee(app, A_MEDIAS, (cliente) => cliente.end());

    const respuesta = leerRespuesta(recibido);
    expect(respuesta.estado).toBe('HTTP/1.1 400 Bad Request');
    expect(respuesta.encabezados['content-type']).toMatch(PROBLEMA_JSON);
    expect(cuerpoDe(respuesta.resto)).toEqual(NO_SE_PUDO_LEER);
    expect(intentada).toEqual(CORTE);
    expect(deNivelError(logs)).toEqual([]);
  });

  it('si manda un chunked mal formado, recibe el 400 en problem+json y no queda ninguna línea de error', async () => {
    const { app, logs } = crear();
    // Un primer trozo bien formado (0x0a = 10 bytes), para que la app empiece a leer, y después un tamaño que no es
    // hexadecimal.
    const inicio = `${altaCon('Transfer-Encoding: chunked')}a\r\n{"nombre":\r\n`;

    const { recibido, intentada } = await cortarMientrasLee(app, inicio, (cliente) => cliente.write('zz\r\n'));

    const respuesta = leerRespuesta(recibido);
    expect(respuesta.estado).toBe('HTTP/1.1 400 Bad Request');
    expect(respuesta.encabezados['content-type']).toMatch(PROBLEMA_JSON);
    expect(cuerpoDe(respuesta.resto)).toEqual(NO_SE_PUDO_LEER);
    expect(intentada).toEqual(CORTE);
    expect(deNivelError(logs)).toEqual([]);
  });

  // Un ECONNRESET de la base o de otro módulo llega con la solicitud ya leída: es un error del servicio.
  it('un manejador que lanza ECONNRESET con el cuerpo ya leído sigue dando 500 y deja su línea de error', async () => {
    const logs = capturarLogs();
    const reset: Manejador = async () => {
      throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    };
    const puerto = await escuchar(crearApp({ ...MANEJADORES, probarAlta: reset }, { flujoLog: logs.flujo }));
    const cuerpo = JSON.stringify({ nombre: 'Ana', fechaNacimiento: '1990-05-01' });

    const respuesta = leerRespuesta(
      await porSocket(puerto, `${altaCon(`Content-Length: ${cuerpo.length}`, 'Connection: close')}${cuerpo}`),
    );

    expect(respuesta.estado).toBe('HTTP/1.1 500 Internal Server Error');
    expect(respuesta.encabezados['content-type']).toMatch(PROBLEMA_JSON);
    expect(cuerpoDe(respuesta.resto)).toEqual({
      type: 'about:blank',
      title: 'Error interno',
      status: 500,
      detail: 'Ocurrió un error interno',
      instance: '/pruebas/clientes',
    });
    expect(deNivelError(logs)).toMatchObject([
      { msg: 'Error interno', idCorrelacion: respuesta.encabezados[ENCABEZADO], err: { codigo: 'ECONNRESET' } },
    ]);
  });

  // Lo que se reconoce es el ECONNRESET de una solicitud que se cortó antes de terminar de leerse. Cualquier otro error que
  // llega cuando el cliente ya se fue sigue siendo un error del servicio: un hook en `etapa` espera a que el cliente corte y
  // recién entonces lanza `error`.
  async function fallarDespuesDelCorte(etapa: 'onRequest' | 'preHandler', error: Error, pedido: string) {
    const { app, logs } = crear();
    const intentadas: number[] = [];
    let esperando = false;
    const esperarYFallar = async (request: FastifyRequest) => {
      const cerrada = new Promise((resolve) => request.raw.on('close', resolve));
      esperando = true;
      await cerrada;
      throw error;
    };
    if (etapa === 'onRequest') app.addHook('onRequest', esperarYFallar);
    else app.addHook('preHandler', esperarYFallar);
    app.addHook('onSend', async (_request, reply) => {
      intentadas.push(reply.statusCode);
    });
    const puerto = await escuchar(app);
    const cliente = net.connect(puerto, '127.0.0.1');
    cliente.on('error', () => {});
    await once(cliente, 'connect');
    cliente.write(pedido);
    await vi.waitFor(() => expect(esperando).toBe(true));

    cliente.resetAndDestroy();

    await vi.waitFor(() => expect(intentadas).toEqual([500]));
    return deNivelError(logs);
  }

  it('otro error que llega con la solicitud ya cortada, antes de leer el cuerpo, sigue dando 500 y deja su línea', async () => {
    const errores = await fallarDespuesDelCorte('onRequest', new Error('falla después del corte'), A_MEDIAS);

    expect(errores).toMatchObject([{ msg: 'Error interno', err: { mensaje: 'falla después del corte' } }]);
  });

  // Es el caso de la base que se corta mientras el cliente ya se fue: la solicitud está destruida, pero se terminó de leer.
  it('un ECONNRESET que llega con el cuerpo ya leído, aunque el cliente se haya ido, sigue dando 500 y deja su línea', async () => {
    const cuerpo = JSON.stringify({ nombre: 'Ana', fechaNacimiento: '1990-05-01' });
    const reset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });

    const errores = await fallarDespuesDelCorte('preHandler', reset, `${altaCon(`Content-Length: ${cuerpo.length}`)}${cuerpo}`);

    expect(errores).toMatchObject([{ msg: 'Error interno', err: { codigo: 'ECONNRESET' } }]);
  });

  // Una solicitud sin cuerpo no la lee nadie: cuando el cliente se va, Node la corta igual, aunque haya llegado entera. El
  // ECONNRESET de la base o de otro módulo que llega entonces no es el del corte.
  it('un ECONNRESET en una solicitud sin cuerpo, con el cliente ya ido, sigue dando 500 y deja su línea', async () => {
    const reset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });

    const errores = await fallarDespuesDelCorte('preHandler', reset, 'GET /pruebas/publica HTTP/1.1\r\nHost: localhost\r\n\r\n');

    expect(errores).toMatchObject([{ msg: 'Error interno', err: { codigo: 'ECONNRESET' } }]);
  });

  // Con el cuerpo a medias, la solicitud no terminó de llegar, pero el ECONNRESET que lanza el servicio antes de leerlo
  // sigue siendo suyo.
  it('un ECONNRESET que llega antes de leer el cuerpo, con el cuerpo a medias, sigue dando 500 y deja su línea', async () => {
    const reset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });

    const errores = await fallarDespuesDelCorte('onRequest', reset, A_MEDIAS);

    expect(errores).toMatchObject([{ msg: 'Error interno', err: { codigo: 'ECONNRESET' } }]);
  });
});

// A un Expect que no es 100-continue, si nadie atiende checkExpectation, Node responde 417 solo, sin pasar por Fastify. El
// RFC 9110 (§10.1.1) deja ignorar una expectativa que el servidor no conoce: la solicitud sigue como cualquier otra.
describe('construirApp: un Expect desconocido, por un socket (RNF-03.1, RNF-14.4, RNF-14.6)', () => {
  const conExpect = (linea: string) =>
    [linea, 'Host: localhost', 'Connection: close', 'Expect: algo', 'X-Request-Id: expect-1', '', ''].join('\r\n');

  it('a una operación la responde como a cualquier otra solicitud', async () => {
    const { app, logs } = crear();
    const puerto = await escuchar(app);

    const respuesta = leerRespuesta(await porSocket(puerto, conExpect('GET /pruebas/publica HTTP/1.1')));

    expect(respuesta.estado).toBe('HTTP/1.1 200 OK');
    expect(respuesta.encabezados[ENCABEZADO]).toBe('expect-1');
    expect(cuerpoDe(respuesta.resto)).toEqual({ ok: true });
    expect(deLaSolicitud(logs)).toMatchObject([
      { idCorrelacion: 'expect-1', metodo: 'GET', ruta: '/pruebas/publica', estado: 200 },
    ]);
  });

  it('a una ruta que no existe, 404 en problem+json', async () => {
    const { app, logs } = crear();
    const puerto = await escuchar(app);

    const respuesta = leerRespuesta(await porSocket(puerto, conExpect('GET /no/existe HTTP/1.1')));

    expect(respuesta.estado).toBe('HTTP/1.1 404 Not Found');
    expect(respuesta.encabezados['content-type']).toMatch(PROBLEMA_JSON);
    expect(respuesta.encabezados[ENCABEZADO]).toBe('expect-1');
    expect(cuerpoDe(respuesta.resto)).toMatchObject({ status: 404, instance: '/no/existe' });
    expect(deLaSolicitud(logs)).toMatchObject([{ idCorrelacion: 'expect-1', metodo: 'GET', ruta: '/no/existe', estado: 404 }]);
  });
});

// El manejador de errores de cliente que la app le dio a Node, con `this` en la app, como lo llama Node.
type ManejadorDeCliente = (error: Partial<NodeJS.ErrnoException>, socket: Partial<Socket>) => void;
const manejadorDeCliente = (app: FastifyInstance) => app.server.listeners('clientError')[0] as ManejadorDeCliente;

// Un socket con lo que el manejador mira y usa.
const socketFalso = (estado: Partial<Pick<Socket, 'destroyed' | 'writable'>> = {}) => ({
  destroyed: false,
  writable: true,
  write: vi.fn(),
  destroy: vi.fn(),
  ...estado,
});

describe('construirApp: el manejador de errores de cliente, con un socket armado en la prueba (RNF-03.1, RNF-03.2)', () => {
  it('ante ECONNRESET no escribe ni cierra nada, aunque el socket siga abierto', () => {
    const { app, logs } = crear();
    const socket = socketFalso();

    manejadorDeCliente(app)({ code: 'ECONNRESET', message: 'read ECONNRESET' }, socket);

    expect(socket.write).not.toHaveBeenCalled();
    expect(socket.destroy).not.toHaveBeenCalled();
    expect(deLaSolicitud(logs)).toEqual([]);
  });

  it('con el socket ya destruido no hace nada', () => {
    const { app, logs } = crear();
    const socket = socketFalso({ destroyed: true });

    manejadorDeCliente(app)({ code: 'HPE_INVALID_METHOD', message: 'Invalid method encountered' }, socket);

    expect(socket.write).not.toHaveBeenCalled();
    expect(socket.destroy).not.toHaveBeenCalled();
    expect(deLaSolicitud(logs)).toEqual([]);
  });

  it('si ya no se puede escribir en el socket, lo cierra sin responder ni dejar línea', () => {
    const { app, logs } = crear();
    const socket = socketFalso({ writable: false });

    manejadorDeCliente(app)({ code: 'HPE_INVALID_METHOD', message: 'Invalid method encountered' }, socket);

    expect(socket.write).not.toHaveBeenCalled();
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(deLaSolicitud(logs)).toEqual([]);
  });

  it.each([
    ['EPIPE', { code: 'EPIPE', message: 'write EPIPE' }],
    ['un error sin code', { message: 'algo falló' }],
  ])('cualquier otro error de la conexión (%s) es una solicitud que no se pudo leer: 400, no 500', (_caso, error) => {
    const { app, logs } = crear();
    const socket = socketFalso();

    manejadorDeCliente(app)(error, socket);

    expect(socket.write).toHaveBeenCalledOnce();
    // Como lo entrega porSocket: byte por byte.
    const respuesta = leerRespuesta(Buffer.from(String(socket.write.mock.calls[0]?.[0])).toString('latin1'));
    expect(respuesta.estado).toBe('HTTP/1.1 400 Bad Request');
    expect(cuerpoDe(respuesta.resto)).toEqual(NO_SE_PUDO_LEER);
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(deLaSolicitud(logs)).toMatchObject([{ estado: 400 }]);
  });
});
