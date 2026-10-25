import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BaseDeDatos } from '../../src/bd/pool.js';
import type { Manejador, Manejadores } from '../../src/contrato/operaciones.js';
import { BaseNoDisponible, Conflicto } from '../../src/errores.js';
import { crearClienteModulo } from '../../src/modulos/cliente.js';
import { CONFIG, crearApp, POOL_FALSO } from '../ayudas/app.js';
import { capturarLogs } from '../ayudas/logs.js';
import { crearServidorModulo } from '../ayudas/servidor-modulo.js';
import { escuchar, leerRespuesta, porSocket } from '../ayudas/socket.js';
import { AUTORIZADO } from '../ayudas/tokens.js';

const ENCABEZADO = 'x-request-id';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const COMO_JSON = { 'content-type': 'application/json' };
// Para llamar a una operación protegida: estas pruebas no son de autenticación (eso es autenticacion.test.ts).
const COMO_JSON_AUTORIZADO = { ...COMO_JSON, ...AUTORIZADO };

const bien: Manejador = async () => ({ ok: true });
const falla: Manejador = async () => {
  throw new Error('falla interna');
};
// Devuelve el id que Fastify le dio a la solicitud.
const devuelveId: Manejador = async (request) => ({ id: request.id });

const MANEJADORES = { probarPublica: devuelveId, probarAlta: bien, probarFalla: falla };

type Pedido = { caso: string; estado: number; solicitud: InjectOptions & { url: string } };

// Una respuesta buena y una de cada error genérico que el servicio responde hoy: todas tienen que traer el encabezado.
const PEDIDOS: Pedido[] = [
  { caso: '200: una operación responde', estado: 200, solicitud: { method: 'GET', url: '/pruebas/publica?x=1' } },
  {
    caso: '400: un campo no cumple el contrato',
    estado: 400,
    solicitud: { method: 'POST', url: '/pruebas/clientes', headers: COMO_JSON_AUTORIZADO, payload: { nombre: 'Ana' } },
  },
  {
    caso: '400: el JSON está roto',
    estado: 400,
    solicitud: { method: 'POST', url: '/pruebas/clientes', headers: COMO_JSON_AUTORIZADO, payload: '{"nombre": ' },
  },
  { caso: '404: la ruta no existe', estado: 404, solicitud: { method: 'GET', url: '/no/existe' } },
  { caso: '405: la ruta no tiene el método', estado: 405, solicitud: { method: 'DELETE', url: '/pruebas/publica' } },
  {
    caso: '413: el cuerpo supera 1 MiB',
    estado: 413,
    solicitud: {
      method: 'POST',
      url: '/pruebas/clientes',
      headers: COMO_JSON_AUTORIZADO,
      payload: `{"a":"${'a'.repeat(1024 * 1024)}"}`,
    },
  },
  {
    caso: '415: el cuerpo no es JSON',
    estado: 415,
    solicitud: {
      method: 'POST',
      url: '/pruebas/clientes',
      headers: { 'content-type': 'text/plain', ...AUTORIZADO },
      payload: 'hola',
    },
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

describe('construirApp: un error no previsto queda en el log, con su id y sin secretos (RNF-03.3, RNF-19.1)', () => {
  const CONTRASENA_BD = 'contrasena-de-la-bd';
  const URL_BD = `postgres://m2:${CONTRASENA_BD}@bd:5432/m2`;
  const CLAVE = CONFIG.claveTokens;
  const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMifQ.firma-del-token';
  // El token válido de AUTORIZADO, sin el esquema: lo llevan las solicitudes a operaciones protegidas, y tampoco va al log.
  const TOKEN_AUTORIZADO = AUTORIZADO.authorization.replace(/^Bearer /, '');
  const SECRETOS = [CLAVE, CONTRASENA_BD, TOKEN, TOKEN_AUTORIZADO];
  const CON_TOKEN = { authorization: `Bearer ${TOKEN}` };
  const CLIENTE = { nombre: 'Ana', fechaNacimiento: '1990-05-17' };

  // Una app con el log capturado y la contraseña de la base de este grupo de pruebas.
  const crear = (manejadores: Manejadores) => {
    const logs = capturarLogs();
    return { app: crearApp(manejadores, { flujoLog: logs.flujo, config: { urlBd: URL_BD } }), logs };
  };
  const errores = (logs: ReturnType<typeof capturarLogs>) => logs.lineas().filter((linea) => linea.level >= 50);
  const lanzando = (valor: unknown): Manejador => async () => {
    throw valor;
  };
  const sinSecretos = (logs: ReturnType<typeof capturarLogs>) => {
    for (const secreto of SECRETOS) expect(logs.texto()).not.toContain(secreto);
  };

  it('un 500 cuyo mensaje trae la clave, la contraseña de la base y el token deja el error en el log', async () => {
    const { app, logs } = crear({ probarFalla: lanzando(new Error(`falló con ${CLAVE}, ${URL_BD} y ${TOKEN}`)) });

    const respuesta = await app.inject({
      method: 'GET',
      url: '/pruebas/falla',
      headers: { ...CON_TOKEN, [ENCABEZADO]: 'cliente-500' },
    });

    expect(respuesta.statusCode).toBe(500);
    expect(respuesta.json().detail).toBe('Ocurrió un error interno');
    const [linea, ...otras] = errores(logs);
    expect(otras).toEqual([]);
    expect(linea).toMatchObject({ level: 50, msg: 'Error interno', idCorrelacion: 'cliente-500' });
    expect(linea.err).toMatchObject({
      tipo: 'Error',
      mensaje: 'falló con [oculto], postgres://m2:[oculto]@bd:5432/m2 y [oculto]',
    });
    expect(linea.err?.traza).toMatch(
      /^Error: falló con \[oculto\], postgres:\/\/m2:\[oculto\]@bd:5432\/m2 y \[oculto\]\n\s+at /,
    );
    sinSecretos(logs);
  });

  it('sin un id en la solicitud, la línea trae el UUID que devuelve la respuesta', async () => {
    const { app, logs } = crear({ probarFalla: lanzando(new Error('falló')) });

    const respuesta = await app.inject({ method: 'GET', url: '/pruebas/falla' });

    expect(respuesta.headers[ENCABEZADO]).toMatch(UUID_V4);
    expect(errores(logs)).toMatchObject([{ idCorrelacion: respuesta.headers[ENCABEZADO] }]);
  });

  it('con un id inválido, la línea trae el UUID que lo reemplazó y no lo que llegó', async () => {
    const { app, logs } = crear({ probarFalla: lanzando(new Error('falló')) });

    const respuesta = await app.inject({ method: 'GET', url: '/pruebas/falla', headers: { [ENCABEZADO]: 'dos palabras' } });

    expect(errores(logs)).toMatchObject([{ idCorrelacion: respuesta.headers[ENCABEZADO] }]);
    expect(logs.texto()).not.toContain('dos palabras');
  });

  it.each([
    ['un texto', `texto con ${CLAVE} y ${TOKEN}`, { tipo: 'string', mensaje: 'texto con [oculto] y [oculto]' }],
    ['un número', 42, { tipo: 'number', mensaje: '42' }],
  ])('si se lanza %s en vez de un error, también queda en el log, sin secretos', async (_caso, valor, esperado) => {
    const { app, logs } = crear({ probarFalla: lanzando(valor) });

    const respuesta = await app.inject({ method: 'GET', url: '/pruebas/falla', headers: CON_TOKEN });

    expect(respuesta.statusCode).toBe(500);
    expect(errores(logs)).toMatchObject([{ msg: 'Error interno', err: esperado }]);
    sinSecretos(logs);
  });

  it('si se lanza un objeto, queda en el log con su contenido y sin secretos', async () => {
    const { app, logs } = crear({ probarFalla: lanzando({ estado: 'roto', clave: CLAVE, anidado: { token: TOKEN } }) });

    const respuesta = await app.inject({ method: 'GET', url: '/pruebas/falla', headers: CON_TOKEN });

    expect(respuesta.statusCode).toBe(500);
    const [linea] = errores(logs);
    expect(linea.err).toMatchObject({ tipo: 'object', mensaje: expect.stringContaining("estado: 'roto'") });
    sinSecretos(logs);
  });

  it('un error de pg guarda la tabla, la columna y la restricción, pero no detail ni where', async () => {
    const errorDePg = Object.assign(new Error('null value in column "email" violates not-null constraint'), {
      code: '23502',
      severity: 'ERROR',
      table: 'clientes',
      column: 'email',
      constraint: 'clientes_email_key',
      detail: 'Failing row contains (7, Ana, ana@example.com).',
      where: 'COPY clientes, line 1: "7,Ana,ana@example.com"',
    });
    const { app, logs } = crear({ probarFalla: lanzando(errorDePg) });

    const respuesta = await app.inject({ method: 'GET', url: '/pruebas/falla' });

    expect(respuesta.statusCode).toBe(500);
    const [linea] = errores(logs);
    expect(linea.err).toMatchObject({
      codigo: '23502',
      tabla: 'clientes',
      columna: 'email',
      restriccion: 'clientes_email_key',
    });
    expect(Object.keys(linea.err ?? {}).sort()).toEqual([
      'codigo',
      'columna',
      'mensaje',
      'restriccion',
      'tabla',
      'tipo',
      'traza',
    ]);
    expect(logs.texto()).not.toContain('ana@example.com');
    expect(logs.texto()).not.toContain('Failing row');
  });

  it('la causa del error también queda en el log, sin secretos', async () => {
    const causa = Object.assign(new Error(`connect ECONNREFUSED, token ${TOKEN}`), { code: 'ECONNREFUSED' });
    const { app, logs } = crear({ probarFalla: lanzando(new TypeError('fetch failed', { cause: causa })) });

    await app.inject({ method: 'GET', url: '/pruebas/falla', headers: CON_TOKEN });

    const [linea] = errores(logs);
    expect(linea.err).toMatchObject({
      tipo: 'TypeError',
      mensaje: 'fetch failed',
      causa: { tipo: 'Error', codigo: 'ECONNREFUSED', mensaje: 'connect ECONNREFUSED, token [oculto]' },
    });
    sinSecretos(logs);
  });

  it('el token que no tiene la forma Bearer también se oculta', async () => {
    const { app, logs } = crear({ probarFalla: lanzando(new Error('llegó Basic dXN1YXJpbzpjbGF2ZQ== y nada más')) });

    await app.inject({ method: 'GET', url: '/pruebas/falla', headers: { authorization: 'Basic dXN1YXJpbzpjbGF2ZQ==' } });

    expect(errores(logs)).toMatchObject([{ err: { mensaje: 'llegó [oculto] y nada más' } }]);
    expect(logs.texto()).not.toContain('dXN1YXJpbzpjbGF2ZQ==');
  });

  const POR_CLIENTE = COMO_JSON_AUTORIZADO;
  const TEXTO_PLANO = { 'content-type': 'text/plain', ...AUTORIZADO };
  it.each([
    ['404: la ruta no existe', 404, { method: 'GET', url: '/no/existe' }],
    ['405: la ruta no tiene el método', 405, { method: 'DELETE', url: '/pruebas/publica' }],
    ['400: un campo no cumple el contrato', 400, { method: 'POST', url: '/pruebas/clientes', payload: { nombre: 'Ana' } }],
    ['415: el cuerpo no es JSON', 415, { method: 'POST', url: '/pruebas/clientes', payload: 'x', headers: TEXTO_PLANO }],
    ['409: el manejador lanza un Conflicto', 409, { method: 'POST', url: '/pruebas/clientes', payload: CLIENTE }],
  ] as const)('%s: no es un error imprevisto y no se registra como error', async (_caso, estado, solicitud) => {
    // El 503 por la base o por otro módulo sí deja una línea, con su causa: está en el bloque siguiente.
    const { app, logs } = crear({ probarPublica: bien, probarAlta: lanzando(new Conflicto()) });

    const respuesta = await app.inject({ headers: POR_CLIENTE, ...solicitud });

    expect(respuesta.statusCode).toBe(estado);
    expect(errores(logs)).toEqual([]);
  });

  it('el log no trae nada de la solicitud: ni el cuerpo, ni la query string, ni los encabezados', async () => {
    const { app, logs } = crear({ probarAlta: lanzando(new Error('falló')), probarPublica: bien });
    const privados = ['Ana', '1990-05-17', '12345678', 'secreto-en-la-query', 'authorization', 'Bearer'];

    await app.inject({
      method: 'POST',
      url: '/pruebas/clientes?dni=12345678&token=secreto-en-la-query',
      headers: COMO_JSON_AUTORIZADO,
      payload: CLIENTE,
    });
    await app.inject({ method: 'GET', url: '/pruebas/publica?dni=12345678', headers: CON_TOKEN });

    expect(errores(logs)).toHaveLength(1);
    for (const privado of privados) expect(logs.texto()).not.toContain(privado);
    sinSecretos(logs);
  });

  it('no hay líneas del log por defecto de Fastify, que traen la URL con su query string', async () => {
    const { app, logs } = crear({ probarPublica: bien });

    await app.inject({ method: 'GET', url: '/pruebas/publica?dni=12345678' });
    await app.inject({ method: 'GET', url: '/no/existe?dni=12345678' });

    const mensajes = logs.lineas().map((linea) => linea.msg);
    expect(mensajes).not.toContain('incoming request');
    expect(mensajes).not.toContain('request completed');
    expect(mensajes).not.toContain('Route GET:/no/existe?dni=12345678 not found');
    expect(logs.texto()).not.toContain('12345678');
  });

  it('el logger limpia la clave y la contraseña de cualquier error que se registre', () => {
    const { app, logs } = crear({});

    app.log.error({ err: new Error(`con ${CLAVE} y ${URL_BD}`) }, 'otro error');
    app.log.child({ idCorrelacion: 'hijo-1' }).error({ err: `texto con ${CLAVE}` }, 'otro texto');
    app.log.error({ err: { message: `objeto con ${CONTRASENA_BD}` } }, 'otro objeto');

    expect(logs.lineas()).toMatchObject([
      { msg: 'otro error', err: { mensaje: 'con [oculto] y postgres://m2:[oculto]@bd:5432/m2' } },
      { msg: 'otro texto', idCorrelacion: 'hijo-1', err: { tipo: 'string', mensaje: 'texto con [oculto]' } },
      { msg: 'otro objeto', err: { mensaje: 'objeto con [oculto]' } },
    ]);
    sinSecretos(logs);
  });

  // Sin un texto, pino copia en msg el mensaje del error tal cual, sin pasar por el serializador.
  it('un error registrado sin texto lleva uno fijo, y su mensaje no llega a msg', () => {
    const { app, logs } = crear({});

    app.log.error(new Error(`con ${CLAVE}`));
    app.log.child({ idCorrelacion: 'hijo-1' }).error({ err: new Error(`con ${URL_BD}`) });
    app.log.warn({ err: { message: `objeto con ${CONTRASENA_BD}` } });
    app.log.error({ err: new Error('x'), msg: 'texto propio' });
    app.log.info({ dato: 1 });

    expect(logs.lineas()).toMatchObject([
      { level: 50, msg: 'Error', err: { mensaje: 'con [oculto]' } },
      { level: 50, msg: 'Error', idCorrelacion: 'hijo-1', err: { mensaje: 'con postgres://m2:[oculto]@bd:5432/m2' } },
      { level: 40, msg: 'Error', err: { mensaje: 'objeto con [oculto]' } },
      { level: 50, msg: 'texto propio', err: { mensaje: 'x' } },
      { level: 30, dato: 1 },
    ]);
    // Una línea sin error sigue sin texto.
    expect(logs.lineas()[4]).not.toHaveProperty('msg');
    sinSecretos(logs);
  });

  it('los textos de cada línea también pasan por limpiarSecretos', () => {
    const { app, logs } = crear({});

    app.log.error({ err: new Error('x') }, `falló con ${CLAVE}`);
    app.log.child({ idCorrelacion: 'hijo-1' }).info(`conectando a ${URL_BD}`);
    app.log.info('la clave es %s', CLAVE);

    expect(logs.lineas().map((linea) => linea.msg)).toEqual([
      'falló con [oculto]',
      'conectando a postgres://m2:[oculto]@bd:5432/m2',
      'la clave es [oculto]',
    ]);
    sinSecretos(logs);
  });

  it('un error que no se puede leer igual da 500 en problem+json y deja una línea mínima', async () => {
    const ilegible = new Error('x');
    Object.defineProperty(ilegible, 'message', {
      get() {
        throw new Error(`no se puede leer ${CLAVE}`);
      },
    });
    const { app, logs } = crear({ probarFalla: lanzando(ilegible) });

    const respuesta = await app.inject({ method: 'GET', url: '/pruebas/falla' });

    expect(respuesta.statusCode).toBe(500);
    expect(respuesta.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(errores(logs)).toMatchObject([{ err: { tipo: 'desconocido', mensaje: 'El error no se pudo serializar' } }]);
    sinSecretos(logs);
  });
});

describe('construirApp: la causa de un 503 por la base o por otro módulo queda en el log, con su id (RNF-14.8, RNF-19.1)', () => {
  const CONTRASENA_BD = 'contrasena-de-la-bd';
  const URL_BD = `postgres://m2:${CONTRASENA_BD}@bd:5432/m2`;
  const CLAVE = CONFIG.claveTokens;
  const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMifQ.firma-del-token';
  const CON_TOKEN = { authorization: `Bearer ${TOKEN}` };
  const SIN_BASE = 'La base de datos no está disponible';
  const SIN_M6 = 'M6 no está disponible';

  const modulo = crearServidorModulo();
  beforeAll(() => modulo.levantar());
  afterAll(() => modulo.cerrar());

  // Una app con el log capturado, la contraseña de la base de este grupo de pruebas y el pool que se pase.
  const crear = (manejadores: Manejadores, pool?: BaseDeDatos) => {
    const logs = capturarLogs();
    return { app: crearApp(manejadores, { flujoLog: logs.flujo, config: { urlBd: URL_BD }, pool }), logs };
  };
  const errores = (logs: ReturnType<typeof capturarLogs>) => logs.lineas().filter((linea) => linea.level >= 50);
  const sinSecretos = (logs: ReturnType<typeof capturarLogs>) => {
    for (const secreto of [CLAVE, CONTRASENA_BD, TOKEN]) expect(logs.texto()).not.toContain(secreto);
  };

  // Una operación que consulta la base, como lo harán las de negocio.
  const consultaLaBase: Manejador = async (request) => {
    await request.server.pool.consultar('SELECT 1');
    return { ok: true };
  };

  // Una operación que lee de M6 con el cliente de módulos, sin reintentos, pasándole el id de la solicitud.
  const leeDeM6: Manejador = async (request) => {
    const cliente = crearClienteModulo({
      nombre: 'M6',
      urlBase: modulo.url,
      tiempoMs: 500,
      reintentos: 0,
      encabezadoCorrelacion: CONFIG.encabezadoCorrelacion,
    });
    return (await cliente.obtener('/', request.id)).cuerpo;
  };

  it('por la base: una línea error con el id, el detail como texto y el error de pg como causa, sin secretos', async () => {
    const causa = Object.assign(new Error(`connect ECONNREFUSED con ${URL_BD}, ${CLAVE} y ${TOKEN}`), {
      code: 'ECONNREFUSED',
    });
    const caida: BaseDeDatos = { ...POOL_FALSO, consultar: async () => Promise.reject(new BaseNoDisponible({ cause: causa })) };
    const { app, logs } = crear({ probarPublica: consultaLaBase }, caida);

    const respuesta = await app.inject({
      method: 'GET',
      url: '/pruebas/publica',
      headers: { ...CON_TOKEN, [ENCABEZADO]: 'sin-base-1' },
    });

    expect(respuesta.statusCode).toBe(503);
    expect(respuesta.json().detail).toBe(SIN_BASE);
    // El contrato declara Retry-After solo para el 503 de una dependencia (spec 007, RF-2.4.6).
    expect(respuesta.headers['retry-after']).toBeUndefined();
    expect(errores(logs)).toEqual([
      expect.objectContaining({
        level: 50,
        msg: SIN_BASE,
        idCorrelacion: 'sin-base-1',
        err: expect.objectContaining({
          tipo: 'BaseNoDisponible',
          mensaje: SIN_BASE,
          causa: expect.objectContaining({
            tipo: 'Error',
            codigo: 'ECONNREFUSED',
            mensaje: 'connect ECONNREFUSED con postgres://m2:[oculto]@bd:5432/m2, [oculto] y [oculto]',
          }),
        }),
      }),
    ]);
    // La respuesta no trae la causa.
    expect(respuesta.body).not.toContain('ECONNREFUSED');
    sinSecretos(logs);
  });

  it('por otro módulo: una línea error con el id, el detail como texto y lo que falló en el último intento', async () => {
    modulo.responderCon({ tipo: '5xx', estado: 500, cuerpo: { error: `con ${CLAVE}` } });
    const { app, logs } = crear({ probarPublica: leeDeM6 });

    const respuesta = await app.inject({
      method: 'GET',
      url: '/pruebas/publica',
      headers: { ...CON_TOKEN, [ENCABEZADO]: 'sin-m6-1' },
    });

    expect(respuesta.statusCode).toBe(503);
    expect(respuesta.json().detail).toBe(SIN_M6);
    // El id llegó también a M6, por el encabezado de correlación.
    expect(modulo.encabezadosRecibidos.get(ENCABEZADO)).toBe('sin-m6-1');
    expect(errores(logs)).toEqual([
      expect.objectContaining({
        level: 50,
        msg: SIN_M6,
        idCorrelacion: 'sin-m6-1',
        err: expect.objectContaining({
          tipo: 'ModuloNoDisponible',
          mensaje: SIN_M6,
          causa: expect.objectContaining({ mensaje: 'M6 respondió 500' }),
        }),
      }),
    ]);
    sinSecretos(logs);
  });

  // La causa es el error del último intento: si fuera el SyntaxError de JSON.parse, traería un pedazo del cuerpo (RNF-19.2).
  it('por otro módulo que responde algo que no es JSON: la línea no trae nada del cuerpo', async () => {
    modulo.responderCon({ tipo: 'no-json', contenido: '<html><body>Ana Perez, Av. Siempre Viva 742</body></html>' });
    const { app, logs } = crear({ probarPublica: leeDeM6 });

    const respuesta = await app.inject({ method: 'GET', url: '/pruebas/publica', headers: { [ENCABEZADO]: 'sin-m6-2' } });

    expect(respuesta.statusCode).toBe(503);
    expect(errores(logs)).toEqual([
      expect.objectContaining({
        idCorrelacion: 'sin-m6-2',
        err: expect.objectContaining({ causa: expect.objectContaining({ mensaje: 'M6 respondió 200 con un cuerpo que no es JSON' }) }),
      }),
    ]);
    for (const dato of ['Ana Perez', 'Siempre Viva', '<html>']) expect(logs.texto()).not.toContain(dato);
  });

  // Spec 007, T2: la credencial de M2 ante M6 es un secreto fijo, como la clave de los tokens (RNF-19.1).
  it('con credencial ante M6: va a M6, y el 503 y el log no la traen aunque un error la repita', async () => {
    const CREDENCIAL_M6 = 'credencial-de-m2-ante-m6';
    modulo.responderCon({ tipo: '5xx', estado: 500, cuerpo: { error: `Bearer ${CREDENCIAL_M6}` } });
    const logs = capturarLogs();
    const app = crearApp(
      {
        probarPublica: async (request) => {
          const cliente = crearClienteModulo({
            nombre: 'M6',
            urlBase: modulo.url,
            tiempoMs: 500,
            reintentos: 0,
            encabezadoCorrelacion: CONFIG.encabezadoCorrelacion,
            credencial: CREDENCIAL_M6,
            reintentarDespuesS: 5,
          });
          return (await cliente.obtener('/', request.id)).cuerpo;
        },
        probarFalla: async () => {
          throw new Error(`no se pudo hablar con M6 usando ${CREDENCIAL_M6}`);
        },
      },
      { flujoLog: logs.flujo, config: { urlBd: URL_BD, credencialM6: CREDENCIAL_M6 } },
    );

    const sinM6 = await app.inject({ method: 'GET', url: '/pruebas/publica', headers: { [ENCABEZADO]: 'sin-m6-3' } });
    expect(sinM6.statusCode).toBe(503);
    expect(sinM6.headers['retry-after']).toBe('5');
    expect(modulo.encabezadosRecibidos.get('authorization')).toBe(`Bearer ${CREDENCIAL_M6}`);

    const interno = await app.inject({ method: 'GET', url: '/pruebas/falla', headers: { ...CON_TOKEN } });
    expect(interno.statusCode).toBe(500);
    expect(errores(logs)).toHaveLength(2);
    expect(logs.texto()).toContain('no se pudo hablar con M6 usando [oculto]');

    for (const texto of [sinM6.body, interno.body, logs.texto()]) expect(texto).not.toContain(CREDENCIAL_M6);
  });

  it('sin un id en la solicitud, la línea trae el UUID que devuelve la respuesta', async () => {
    const caida: BaseDeDatos = { ...POOL_FALSO, consultar: async () => Promise.reject(new BaseNoDisponible({ cause: new Error('x') })) };
    const { app, logs } = crear({ probarPublica: consultaLaBase }, caida);

    const respuesta = await app.inject({ method: 'GET', url: '/pruebas/publica' });

    expect(respuesta.headers[ENCABEZADO]).toMatch(UUID_V4);
    expect(errores(logs)).toMatchObject([{ msg: SIN_BASE, idCorrelacion: respuesta.headers[ENCABEZADO] }]);
  });

  // Todas fallan por la misma caída: cada una deja su línea, con su id y la causa de su consulta (spec, casos límite).
  it('cinco solicitudes a la vez dejan cinco líneas, cada una con su id y su causa', async () => {
    const ids = ['vez-1', 'vez-2', 'vez-3', 'vez-4', 'vez-5'];
    const todas = Promise.withResolvers<void>();
    let empezadas = 0;
    // Ninguna falla hasta que empezaron las cinco. La causa nombra la solicitud: así se ve que cada línea lleva la de la suya.
    const sinBase: Manejador = async (request) => {
      empezadas += 1;
      if (empezadas === ids.length) todas.resolve();
      await todas.promise;
      throw new BaseNoDisponible({ cause: new Error(`corte de ${request.id}`) });
    };
    const { app, logs } = crear({ probarPublica: sinBase });

    const respuestas = await Promise.all(
      ids.map((id) => app.inject({ method: 'GET', url: '/pruebas/publica', headers: { [ENCABEZADO]: id } })),
    );

    expect(respuestas.map((respuesta) => respuesta.statusCode)).toEqual([503, 503, 503, 503, 503]);
    const lineas = errores(logs);
    expect(lineas).toHaveLength(ids.length);
    expect(lineas.map((linea) => linea.idCorrelacion).sort()).toEqual(ids);
    for (const linea of lineas) {
      expect(linea).toMatchObject({ msg: SIN_BASE, err: { causa: { mensaje: `corte de ${linea.idCorrelacion}` } } });
    }
  });

  it('el 503 de la parada no deja esa línea: el servicio lo responde a propósito', async () => {
    const { app, logs } = crear({ probarPublica: bien });
    await app.ready();
    app.deteniendose = true;

    const respuesta = await app.inject({ method: 'GET', url: '/pruebas/publica' });

    expect(respuesta.statusCode).toBe(503);
    expect(respuesta.json().detail).toBe('El servicio se está deteniendo');
    expect(errores(logs)).toEqual([]);
  });
});

describe('construirApp: una línea por solicitud en el log (RNF-14.5, RNF-14.6, RNF-19.2)', () => {
  const MENSAJE = 'Solicitud terminada';
  // Lo que pino suma a cada línea por su cuenta: no sale de la solicitud.
  const BASE_DE_PINO = ['level', 'time', 'pid', 'hostname'];
  const CAMPOS = ['duracionMs', 'estado', 'idCorrelacion', 'metodo', 'msg', 'ruta'];
  const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMifQ.firma-del-token';
  const QUERY = 'dni=12345678&token=secreto-en-la-query';
  const CLIENTE_ID = '0b9b7e2e-5f5c-4d7a-9a0e-3c1d2f4a6b8c';
  const DIRECCION_ID = '7d1c3a5e-9b2f-4e6a-8c0d-1f2a3b4c5d6e';

  type Logs = ReturnType<typeof capturarLogs>;
  const deLaSolicitud = (logs: Logs) => logs.lineas().filter((linea) => linea.msg === MENSAJE);
  const conQuery = (url: string) => `${url}${url.includes('?') ? '&' : '?'}${QUERY}`;
  const crear = (manejadores: Manejadores = MANEJADORES) => {
    const logs = capturarLogs();
    return { app: crearApp(manejadores, { flujoLog: logs.flujo }), logs };
  };

  describe.each(PEDIDOS)('$caso', ({ estado, solicitud }) => {
    it('deja una línea JSON con el id, el método, la ruta, el estado y la duración, y ningún otro dato', async () => {
      const { app, logs } = crear();
      const antes = Date.now();

      const respuesta = await app.inject({ ...solicitud, headers: { ...solicitud.headers, [ENCABEZADO]: 'cliente-1' } });

      expect(respuesta.statusCode).toBe(estado);
      const [linea, ...otras] = deLaSolicitud(logs);
      expect(otras).toEqual([]);
      expect(linea).toMatchObject({
        level: 30,
        idCorrelacion: 'cliente-1',
        metodo: solicitud.method,
        ruta: solicitud.url.split('?')[0],
        estado,
      });
      expect(Object.keys(linea).filter((campo) => !BASE_DE_PINO.includes(campo)).sort()).toEqual(CAMPOS);
      expect(linea.duracionMs).toEqual(expect.any(Number));
      expect(linea.duracionMs).toBeGreaterThanOrEqual(0);
      expect(linea.time).toBeGreaterThanOrEqual(antes);
      expect(linea.time).toBeLessThanOrEqual(Date.now());
      // Una línea por evento: la de la solicitud y, si un manejador falló, la del error.
      expect(logs.lineas().filter((otra) => otra.msg !== 'Error interno')).toEqual([linea]);
    });

    it('registra la ruta sin la query string, que no queda en ninguna parte del log', async () => {
      const { app, logs } = crear();

      const respuesta = await app.inject({ ...solicitud, url: conQuery(solicitud.url) });

      expect(respuesta.statusCode).toBe(estado);
      expect(deLaSolicitud(logs)).toMatchObject([{ ruta: solicitud.url.split('?')[0] }]);
      for (const privado of ['dni=', '12345678', 'token=', 'secreto-en-la-query']) {
        expect(logs.texto()).not.toContain(privado);
      }
    });
  });

  it('un 500 deja la línea del error y la de la solicitud, las dos con el mismo id', async () => {
    const { app, logs } = crear();

    await app.inject({ method: 'GET', url: '/pruebas/falla', headers: { [ENCABEZADO]: 'cliente-500' } });

    expect(logs.lineas()).toMatchObject([
      { level: 50, msg: 'Error interno', idCorrelacion: 'cliente-500' },
      { level: 30, msg: MENSAJE, idCorrelacion: 'cliente-500', estado: 500 },
    ]);
  });

  it.each(INVALIDOS)('si el id recibido %s, la línea trae el UUID que lo reemplazó', async (_caso, invalido) => {
    const { app, logs } = crear();

    const respuesta = await app.inject({ method: 'GET', url: '/pruebas/publica', headers: { [ENCABEZADO]: invalido } });

    const [linea] = deLaSolicitud(logs);
    expect(linea.idCorrelacion).toMatch(UUID_V4);
    expect(linea.idCorrelacion).toBe(respuesta.headers[ENCABEZADO]);
    // Un texto vacío está en cualquier texto: de ese caso solo importa que el id sea el UUID.
    if (invalido !== '') expect(logs.texto()).not.toContain(invalido);
  });

  it('duracionMs es lo que tarda la solicitud, en milisegundos', async () => {
    const tarda: Manejador = async () => {
      await new Promise((listo) => setTimeout(listo, 60));
      return { ok: true };
    };
    const { app, logs } = crear({ probarTarda: tarda });

    await app.inject({ method: 'GET', url: '/pruebas/tarda' });

    // En segundos serían 0,06 y en microsegundos, más de 60000.
    const [linea] = deLaSolicitud(logs);
    expect(linea.duracionMs).toBeGreaterThanOrEqual(50);
    expect(linea.duracionMs).toBeLessThan(5000);
  });

  it('la línea se escribe con la respuesta ya terminada: trae el código que salió, aunque un onSend lo cambie', async () => {
    const { app, logs } = crear();
    app.addHook('onSend', async (_request, reply) => {
      reply.code(299);
    });

    const respuesta = await app.inject({ method: 'GET', url: '/pruebas/publica' });

    expect(respuesta.statusCode).toBe(299);
    expect(deLaSolicitud(logs)).toMatchObject([{ estado: 299 }]);
  });

  it('la ruta es la que pidió el cliente, con sus parámetros y sin la query string', async () => {
    const { app, logs } = crear({ probarParametros: bien });
    const ruta = `/pruebas/clientes/${CLIENTE_ID}/direcciones/${DIRECCION_ID}`;

    await app.inject({ method: 'GET', url: `${ruta}?pagina=2`, headers: AUTORIZADO });

    expect(deLaSolicitud(logs)).toMatchObject([{ metodo: 'GET', ruta }]);
  });

  it('no registra el Authorization ni otros encabezados, ni el cuerpo de la solicitud ni el de la respuesta', async () => {
    const { app, logs } = crear({ probarAltaDuplicada: async () => ({ dato: 'dato-de-la-respuesta' }) });
    const privados = [TOKEN, 'Bearer', 'valor-de-la-cookie', 'agente-de-prueba', 'otro-encabezado'];
    const cuerpos = ['valor-del-cuerpo', 'dato-de-la-respuesta'];
    const nombres = ['authorization', 'cookie', 'user-agent', 'x-otro', 'content-type'];

    const respuesta = await app.inject({
      method: 'POST',
      url: '/pruebas/duplicados',
      headers: {
        ...COMO_JSON,
        authorization: `Bearer ${TOKEN}`,
        cookie: 'sesion=valor-de-la-cookie',
        'user-agent': 'agente-de-prueba',
        'x-otro': 'otro-encabezado',
      },
      payload: { codigo: 'valor-del-cuerpo' },
    });

    expect(respuesta.json()).toEqual({ dato: 'dato-de-la-respuesta' });
    expect(deLaSolicitud(logs)).toHaveLength(1);
    for (const privado of [...privados, ...cuerpos, ...nombres]) expect(logs.texto()).not.toContain(privado);
  });

  it('solicitudes en paralelo: cada una deja su línea, con su id, su ruta y su estado', async () => {
    const { app, logs } = crear();
    const pedidos = Array.from({ length: 20 }, (_, i) => ({
      id: `paralelo-${i}`,
      ruta: i % 2 === 0 ? '/pruebas/publica' : `/no/existe/${i}`,
      estado: i % 2 === 0 ? 200 : 404,
    }));

    await Promise.all(
      pedidos.map(({ id, ruta }) => app.inject({ method: 'GET', url: ruta, headers: { [ENCABEZADO]: id } })),
    );

    const lineas = deLaSolicitud(logs);
    expect(lineas).toHaveLength(20);
    for (const { id, ruta, estado } of pedidos) {
      expect(lineas.filter((linea) => linea.idCorrelacion === id)).toMatchObject([{ ruta, estado }]);
    }
  });

  it('por un socket también deja su línea, y sin la query string', async () => {
    const { app, logs } = crear();
    const puerto = await escuchar(app);
    const pedido = [
      'GET /pruebas/publica?dni=12345678 HTTP/1.1',
      'Host: localhost',
      'X-Request-Id: socket-1',
      'Connection: close',
      '',
      '',
    ].join('\r\n');

    const respuesta = leerRespuesta(await porSocket(puerto, pedido));

    expect(respuesta.estado).toBe('HTTP/1.1 200 OK');
    // La línea se escribe cuando Fastify termina de enviar, y el cliente puede leer la respuesta un instante antes.
    await vi.waitFor(() => {
      expect(deLaSolicitud(logs)).toMatchObject([
        { idCorrelacion: 'socket-1', metodo: 'GET', ruta: '/pruebas/publica', estado: 200 },
      ]);
    });
    expect(logs.texto()).not.toContain('12345678');
  });
});
