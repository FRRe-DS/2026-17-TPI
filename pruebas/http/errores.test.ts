import type { InjectOptions } from 'fastify';
import { METHODS } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import type { Manejador } from '../../src/contrato/operaciones.js';
import { contratoCon, crearApp } from '../ayudas/app.js';
import { escuchar, leerRespuesta, porSocket } from '../ayudas/socket.js';

const MIB = 1024 * 1024;
const COMO_JSON = { 'content-type': 'application/json' };
const PROBLEMA_JSON = /^application\/problem\+json/;
const CLIENTE = { nombre: 'Ana', fechaNacimiento: '1990-05-17' };
const SECRETO = 'postgres://m2:clave-secreta@bd:5432/m2';

// Un cuerpo JSON de exactamente `bytes` bytes: {"a":"aaa…"}.
const cuerpoDe = (bytes: number) => `{"a":"${'a'.repeat(bytes - 8)}"}`;

// Devuelve el cuerpo que llegó, ya leído y validado.
const eco: Manejador = async (request) => ({ cuerpo: request.body });

const lanza: Manejador = async () => {
  throw new Error(SECRETO);
};

type Caso = { caso: string; solicitud: InjectOptions; status: number; title: string; detail: string; instance: string };

// Una solicitud por cada error genérico de RNF-03.2 que esta tarea responde, todas con query string para comprobar que
// `instance` no la trae.
const CASOS: Caso[] = [
  {
    caso: '404: la ruta no existe',
    solicitud: { method: 'GET', url: '/no/existe?x=1' },
    status: 404,
    title: 'No encontrado',
    detail: 'No existe la ruta pedida',
    instance: '/no/existe',
  },
  {
    caso: '413: el cuerpo supera 1 MiB',
    solicitud: { method: 'POST', url: '/pruebas/clientes?x=1', headers: COMO_JSON, payload: cuerpoDe(MIB + 1) },
    status: 413,
    title: 'Cuerpo demasiado grande',
    detail: 'El cuerpo supera 1 MiB',
    instance: '/pruebas/clientes',
  },
  {
    caso: '415: el cuerpo no es application/json',
    solicitud: { method: 'POST', url: '/pruebas/clientes?x=1', headers: { 'content-type': 'text/plain' }, payload: 'hola' },
    status: 415,
    title: 'Tipo de contenido no soportado',
    detail: 'El cuerpo tiene que ser application/json',
    instance: '/pruebas/clientes',
  },
  {
    caso: '400: el JSON está roto',
    solicitud: { method: 'POST', url: '/pruebas/clientes?x=1', headers: COMO_JSON, payload: '{"nombre": ' },
    status: 400,
    title: 'Solicitud inválida',
    detail: 'El cuerpo no es JSON válido',
    instance: '/pruebas/clientes',
  },
  {
    caso: '400: el cuerpo está vacío y dice ser JSON',
    solicitud: { method: 'POST', url: '/pruebas/clientes?x=1', headers: COMO_JSON, payload: '' },
    status: 400,
    title: 'Solicitud inválida',
    detail: 'El cuerpo no es JSON válido',
    instance: '/pruebas/clientes',
  },
  {
    caso: '400: el JSON trae __proto__',
    solicitud: { method: 'POST', url: '/pruebas/clientes?x=1', headers: COMO_JSON, payload: '{"__proto__": {"admin": true}}' },
    status: 400,
    title: 'Solicitud inválida',
    detail: 'El cuerpo no es JSON válido',
    instance: '/pruebas/clientes',
  },
  {
    caso: '400: falta un campo, y el detail lo nombra',
    solicitud: { method: 'POST', url: '/pruebas/clientes?x=1', headers: COMO_JSON, payload: { nombre: 'Ana' } },
    status: 400,
    title: 'Solicitud inválida',
    detail: 'Falta el campo fechaNacimiento en el cuerpo',
    instance: '/pruebas/clientes',
  },
  {
    caso: '500: un manejador falla',
    solicitud: { method: 'GET', url: '/pruebas/falla?x=1' },
    status: 500,
    title: 'Error interno',
    detail: 'Ocurrió un error interno',
    instance: '/pruebas/falla',
  },
];

describe('construirApp: cada error genérico sale en problem+json (RNF-03.1, RNF-03.2)', () => {
  it.each(CASOS)('$caso', async ({ solicitud, status, title, detail, instance }) => {
    const respuesta = await crearApp({ probarAlta: eco, probarFalla: lanza }).inject(solicitud);

    expect(respuesta.statusCode).toBe(status);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
    expect(respuesta.json()).toEqual({ type: 'about:blank', title, status, detail, instance });
  });

  it.each(['/', '/no/existe', '/pruebas', '/pruebas/protegida/extra'])('404 para %s, que no es una operación', async (url) => {
    const respuesta = await crearApp({ probarProtegida: eco }).inject({ method: 'GET', url: `${url}?x=1` });

    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
    expect(respuesta.json()).toEqual({
      type: 'about:blank',
      title: 'No encontrado',
      status: 404,
      detail: 'No existe la ruta pedida',
      instance: url,
    });
  });
});

// Cuerpos que darían 413, 415 o 400 si se leyeran: el 404 y el 405 tienen que salir antes.
const CUERPOS = [
  ['de más de 1 MiB', COMO_JSON, cuerpoDe(MIB + 1)],
  ['que no es JSON', { 'content-type': 'text/plain' }, 'hola'],
  ['con el JSON roto', COMO_JSON, '{"nombre": '],
  ['vacío, que dice ser JSON', COMO_JSON, ''],
] as const;

describe('construirApp: una ruta que no existe da 404 antes de leer el cuerpo (RNF-03.5)', () => {
  describe.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)('%s', (method) => {
    it.each(CUERPOS)('con un cuerpo %s', async (_caso, headers, payload) => {
      const respuesta = await crearApp({ probarAlta: eco }).inject({ method, url: '/no/existe', headers, payload });

      expect(respuesta.statusCode).toBe(404);
      expect(respuesta.json().detail).toBe('No existe la ruta pedida');
    });
  });

  // Los hooks de parada y de autenticación se registran después: ninguno tiene que correr para una ruta que no existe.
  it('y antes de cualquier otro hook onRequest que se registre después', async () => {
    const app = crearApp({ probarAlta: eco });
    const otro = vi.fn();
    app.addHook('onRequest', async (request) => {
      otro(request.url);
    });

    expect((await app.inject({ method: 'GET', url: '/no/existe' })).statusCode).toBe(404);
    expect(otro).not.toHaveBeenCalled();

    await app.inject({ method: 'POST', url: '/pruebas/clientes', payload: CLIENTE });
    expect(otro).toHaveBeenCalledExactlyOnceWith('/pruebas/clientes');
  });
});

describe('construirApp: el cuerpo puede pesar hasta 1 MiB (RNF-03.2)', () => {
  const contratoAbierto = contratoCon({
    '/x': {
      post: {
        operationId: 'x',
        security: [],
        requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
      },
    },
  });

  it.each([
    [MIB, 200],
    [MIB + 1, 413],
  ])('un cuerpo de %i bytes da %i', async (bytes, status) => {
    const respuesta = await crearApp({ x: eco }, { contrato: contratoAbierto }).inject({
      method: 'POST',
      url: '/x',
      headers: COMO_JSON,
      payload: cuerpoDe(bytes),
    });

    expect(respuesta.statusCode).toBe(status);
  });
});

describe('construirApp: solo se acepta el cuerpo application/json (RNF-03.2)', () => {
  it.each(['application/json', 'application/json; charset=utf-8', 'APPLICATION/JSON'])('acepta %s', async (tipo) => {
    const respuesta = await crearApp({ probarAlta: eco }).inject({
      method: 'POST',
      url: '/pruebas/clientes',
      headers: { 'content-type': tipo },
      payload: JSON.stringify(CLIENTE),
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({ cuerpo: CLIENTE });
  });

  it.each([
    'text/plain',
    'text/plain; charset=utf-8',
    'application/xml',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
    'application/vnd.api+json',
  ])('rechaza %s con 415', async (tipo) => {
    const respuesta = await crearApp({ probarAlta: eco }).inject({
      method: 'POST',
      url: '/pruebas/clientes',
      headers: { 'content-type': tipo },
      payload: JSON.stringify(CLIENTE),
    });

    expect(respuesta.statusCode).toBe(415);
    expect(respuesta.json().detail).toBe('El cuerpo tiene que ser application/json');
  });

  it('rechaza con 415 un cuerpo que llega sin Content-Type', async () => {
    const respuesta = await crearApp({ probarAlta: eco }).inject({
      method: 'POST',
      url: '/pruebas/clientes',
      payload: JSON.stringify(CLIENTE),
    });

    expect(respuesta.statusCode).toBe(415);
  });
});

describe('construirApp: un error no previsto da 500 sin mostrar nada interno (RNF-03.3)', () => {
  const FALLAS: [string, Manejador][] = [
    ['lanzado por un manejador async', lanza],
    [
      'lanzado por un manejador síncrono',
      () => {
        throw new Error(SECRETO);
      },
    ],
    [
      'que no es un Error',
      async () => {
        throw SECRETO;
      },
    ],
    [
      'con statusCode y code propios',
      async () => {
        throw Object.assign(new Error(SECRETO), { statusCode: 400, code: 'ERR_PROPIO' });
      },
    ],
  ];

  it.each(FALLAS)('un error %s', async (_caso, manejador) => {
    const respuesta = await crearApp({ probarFalla: manejador }).inject({ method: 'GET', url: '/pruebas/falla?x=1' });

    expect(respuesta.statusCode).toBe(500);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
    expect(respuesta.json()).toEqual({
      type: 'about:blank',
      title: 'Error interno',
      status: 500,
      detail: 'Ocurrió un error interno',
      instance: '/pruebas/falla',
    });
    expect(JSON.stringify(respuesta.headers)).not.toContain('clave-secreta');
  });
});

// Todos los métodos que Node reconoce, menos CONNECT, que Node atiende aparte (Lógica 8).
const METODOS = METHODS.filter((metodo) => metodo !== 'CONNECT');

const PROBLEMA_405 = {
  type: 'about:blank',
  title: 'Método no permitido',
  status: 405,
  detail: 'La ruta solo admite los métodos de Allow',
};

describe('construirApp: un método que la ruta no tiene da 405 con Allow (RNF-03.2)', () => {
  it.each(METODOS.filter((metodo) => metodo !== 'GET'))('%s a una ruta que solo tiene GET', async (method) => {
    const respuesta = await crearApp({ probarPublica: eco }).inject({ method, url: '/pruebas/publica?x=1' });

    expect(respuesta.statusCode).toBe(405);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
    expect(respuesta.headers.allow).toBe('GET');
    expect(respuesta.json()).toEqual({ ...PROBLEMA_405, instance: '/pruebas/publica' });
  });

  it.each(['PUT', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'QUERY', 'PROPFIND'])(
    '%s a una ruta con GET y POST: Allow trae los dos',
    async (method) => {
      const respuesta = await crearApp({ probarListado: eco, probarAlta: eco }).inject({ method, url: '/pruebas/clientes' });

      expect(respuesta.statusCode).toBe(405);
      expect(respuesta.headers.allow).toBe('GET, POST');
    },
  );

  it('una operación del contrato sin manejador no cuenta en Allow', async () => {
    const respuesta = await crearApp({ probarAlta: eco }).inject({ method: 'GET', url: '/pruebas/clientes' });

    expect(respuesta.statusCode).toBe(405);
    expect(respuesta.headers.allow).toBe('POST');
  });

  it.each(METODOS)('%s a una ruta que no existe sigue dando 404', async (method) => {
    const respuesta = await crearApp({ probarPublica: eco }).inject({ method, url: '/no/existe' });

    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.json().detail).toBe('No existe la ruta pedida');
  });

  it('una operación HEAD o TRACE del contrato se registra, y Allow va en orden alfabético', async () => {
    const contratoX = contratoCon({
      '/x': {
        trace: { operationId: 't', security: [] },
        get: { operationId: 'g', security: [] },
        head: { operationId: 'h', security: [] },
      },
    });
    const marca = (manejador: string): Manejador => async () => ({ manejador });
    const app = crearApp({ g: marca('g'), h: marca('h'), t: marca('t') }, { contrato: contratoX });

    expect((await app.inject({ method: 'GET', url: '/x' })).json()).toEqual({ manejador: 'g' });
    expect((await app.inject({ method: 'HEAD', url: '/x' })).json()).toEqual({ manejador: 'h' });
    expect((await app.inject({ method: 'TRACE', url: '/x' })).json()).toEqual({ manejador: 't' });
    const otro = await app.inject({ method: 'POST', url: '/x' });
    expect(otro.statusCode).toBe(405);
    expect(otro.headers.allow).toBe('GET, HEAD, TRACE');
  });
});

describe('construirApp: el 405 sale antes de leer el cuerpo y de validar los datos (RNF-03.5)', () => {
  const CON_CUERPO = ['POST', 'PUT', 'PATCH', 'DELETE', 'QUERY', 'PROPFIND'] as const;

  describe.each(CON_CUERPO)('%s a una ruta que solo tiene GET', (method) => {
    it.each(CUERPOS)('con un cuerpo %s', async (_caso, headers, payload) => {
      const respuesta = await crearApp({ probarPublica: eco }).inject({ method, url: '/pruebas/publica', headers, payload });

      expect(respuesta.statusCode).toBe(405);
      expect(respuesta.headers.allow).toBe('GET');
    });
  });

  it('con parámetros de ruta que no cumplen el contrato', async () => {
    const respuesta = await crearApp({ probarParametros: eco }).inject({
      method: 'POST',
      url: '/pruebas/clientes/no-es-uuid/direcciones/tampoco',
    });

    expect(respuesta.statusCode).toBe(405);
    expect(respuesta.headers.allow).toBe('GET');
  });
});

describe('construirApp: HEAD y CONNECT por un socket (RNF-03.1, casos límite de la spec)', () => {
  const head = (url: string) => `HEAD ${url} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`;

  it('a HEAD, 405 con Allow y sin cuerpo; a una ruta que no existe, 404 sin cuerpo', async () => {
    const puerto = await escuchar(crearApp({ probarPublica: eco }));

    const sinMetodo = leerRespuesta(await porSocket(puerto, head('/pruebas/publica')));
    expect(sinMetodo.estado).toBe('HTTP/1.1 405 Method Not Allowed');
    expect(sinMetodo.encabezados.allow).toBe('GET');
    expect(sinMetodo.encabezados['content-type']).toMatch(PROBLEMA_JSON);
    expect(sinMetodo.resto).toBe('');

    const noExiste = leerRespuesta(await porSocket(puerto, head('/no/existe')));
    expect(noExiste.estado).toBe('HTTP/1.1 404 Not Found');
    expect(noExiste.resto).toBe('');
  });

  it('CONNECT: Node cierra la conexión sin responder', async () => {
    const puerto = await escuchar(crearApp({ probarPublica: eco }));

    expect(await porSocket(puerto, 'CONNECT /pruebas/publica HTTP/1.1\r\nHost: localhost\r\n\r\n')).toBe('');
  });
});
