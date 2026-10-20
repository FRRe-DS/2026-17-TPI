import type { LightMyRequestResponse } from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';
import { construirApp } from '../../src/app.js';
import type { Manejador } from '../../src/contrato/operaciones.js';
import { CONFIG, contratoCon, crearApp } from '../ayudas/app.js';
import { descartarLogs } from '../ayudas/logs.js';
import { AUTORIZADO, bearer } from '../ayudas/tokens.js';

const MIB = 1024 * 1024;
const UUID = '00000000-0000-4000-8000-000000000001';
const PROBLEMA_JSON = /^application\/problem\+json/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const COMO_JSON = { 'content-type': 'application/json' };
const COMO_TEXTO = { 'content-type': 'text/plain' };
const RELLENO = 'a'.repeat(MIB);

// Cada problema de RNF-03.5, con el título y el detalle fijos de la tabla de errores del plan (Lógica 6).
type Esperado = { status: number; title: string; detail: string };
const URL_INVALIDA: Esperado = {
  status: 400,
  title: 'Solicitud inválida',
  detail: 'La URL no es válida, o un parámetro de la ruta supera los 100 caracteres',
};
const NO_ENCONTRADO: Esperado = { status: 404, title: 'No encontrado', detail: 'No existe la ruta pedida' };
const NO_PERMITIDO: Esperado = {
  status: 405,
  title: 'Método no permitido',
  detail: 'La ruta solo admite los métodos de Allow',
};
const SIN_TOKEN: Esperado = { status: 401, title: 'No autenticado', detail: 'Falta el token' };
const TOKEN_VENCIDO: Esperado = { status: 401, title: 'No autenticado', detail: 'El token venció' };
const SIN_PERMISO: Esperado = { status: 403, title: 'Sin permiso', detail: 'El rol del token no permite esta operación' };
const DEMASIADO_GRANDE: Esperado = { status: 413, title: 'Cuerpo demasiado grande', detail: 'El cuerpo supera 1 MiB' };
const OTRO_TIPO: Esperado = {
  status: 415,
  title: 'Tipo de contenido no soportado',
  detail: 'El cuerpo tiene que ser application/json',
};
const datosInvalidos = (detail: string): Esperado => ({ status: 400, title: 'Solicitud inválida', detail });
const JSON_ROTO = datosInvalidos('El cuerpo no es JSON válido');
const FALTA_NOMBRE = datosInvalidos('Falta el campo nombre en el cuerpo');

// Comprueba que la respuesta es el problema esperado, en problem+json y con el encabezado de correlación. Solo el 401 lleva
// WWW-Authenticate y solo el 405 lleva Allow, con el valor que se pase.
function esElProblema(respuesta: LightMyRequestResponse, esperado: Esperado, allow?: string) {
  expect(respuesta.statusCode).toBe(esperado.status);
  expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
  expect(respuesta.headers['x-request-id']).toMatch(UUID_V4);
  expect(respuesta.json()).toMatchObject({ type: 'about:blank', ...esperado });
  expect(respuesta.headers['www-authenticate']).toBe(esperado.status === 401 ? 'Bearer' : undefined);
  expect(respuesta.headers.allow).toBe(esperado.status === 405 ? allow : undefined);
}

// Un manejador al que solo llega una solicitud sin problemas.
const bien: Manejador = async () => ({ ok: true });
const MANEJADORES = { probarProtegida: bien, probarListado: bien, probarAlta: bien, probarParametros: bien };

const ahora = () => Math.floor(Date.now() / 1000);
const CLIENTE = bearer();
const OPERADOR = bearer({ claims: { roles: ['OPERADOR'] } });
const SIN_ROLES = bearer({ claims: { roles: [] } });
const VENCIDO = bearer({ claims: { exp: ahora() - 3600 } });

// El 400 por la URL, el 404 y el 405 no dependen del token: se prueban con cada caso.
const CUALQUIER_TOKEN = [
  ['sin token', {}],
  ['con un token vencido', VENCIDO],
  ['con un token sin roles conocidos', SIN_ROLES],
  ['con un token válido', AUTORIZADO],
] as const;

// Un cuerpo con un problema de cada clase: el JSON roto y el que no cumple el esquema dan 400 si no hay otro problema; el de
// más de 1 MiB, 413; y el de otro tipo, 415.
const CUERPOS_INVALIDOS = [
  ['con JSON roto', COMO_JSON, '{"nombre": '],
  ['sin el campo nombre', COMO_JSON, '{}'],
  ['de más de 1 MiB', COMO_JSON, JSON.stringify({ nombre: 'Ana', relleno: RELLENO })],
  ['de otro tipo', COMO_TEXTO, 'hola'],
] as const;

describe('precedencia: el 400 por la URL va antes que todo lo demás (RNF-03.5, punto 1)', () => {
  it.each(CUALQUIER_TOKEN)('un parámetro de ruta de 101 caracteres %s, con query y encabezado inválidos', async (_c, token) => {
    const respuesta = await crearApp(MANEJADORES).inject({
      method: 'GET',
      url: `/pruebas/clientes/${'a'.repeat(101)}/direcciones/${UUID}?pagina=0`,
      headers: { ...token, 'x-version': '0' },
    });

    esElProblema(respuesta, URL_INVALIDA);
  });

  it.each(CUALQUIER_TOKEN)('una URL mal codificada %s, con un cuerpo de más de 1 MiB de otro tipo', async (_c, token) => {
    const respuesta = await crearApp(MANEJADORES).inject({
      method: 'POST',
      url: '/pruebas/clientes/%E0%A4%A',
      headers: { ...token, ...COMO_TEXTO },
      payload: RELLENO,
    });

    esElProblema(respuesta, URL_INVALIDA);
  });
});

describe('precedencia: el 404 y el 405, con o sin token (RNF-03.5, punto 3)', () => {
  it.each(CUALQUIER_TOKEN)('una ruta que no existe %s: 404, aun con más de 1 MiB de otro tipo', async (_c, token) => {
    const app = crearApp(MANEJADORES);

    const sinCuerpo = await app.inject({ method: 'GET', url: '/pruebas/nada', headers: token });
    const conCuerpo = await app.inject({
      method: 'POST',
      url: '/pruebas/nada',
      headers: { ...token, ...COMO_TEXTO },
      payload: RELLENO,
    });

    esElProblema(sinCuerpo, NO_ENCONTRADO);
    esElProblema(conCuerpo, NO_ENCONTRADO);
  });

  it.each(CUALQUIER_TOKEN)('un método que la ruta no tiene %s: 405, aun con más de 1 MiB de otro tipo', async (_c, token) => {
    const app = crearApp(MANEJADORES);

    const sinCuerpo = await app.inject({ method: 'DELETE', url: '/pruebas/protegida', headers: token });
    const conCuerpo = await app.inject({
      method: 'PUT',
      url: '/pruebas/clientes',
      headers: { ...token, ...COMO_TEXTO },
      payload: RELLENO,
    });

    esElProblema(sinCuerpo, NO_PERMITIDO, 'GET');
    esElProblema(conCuerpo, NO_PERMITIDO, 'GET, POST');
  });
});

describe('precedencia: el 401 y el 403 van antes que los errores del cuerpo y de los datos (RNF-03.5, puntos 4 y 5)', () => {
  const alta = (headers: Record<string, string>, payload: string) =>
    crearApp(MANEJADORES).inject({ method: 'POST', url: '/pruebas/clientes', headers, payload });

  it.each(CUERPOS_INVALIDOS)('sin token y con un cuerpo %s: 401', async (_c, tipo, cuerpo) => {
    esElProblema(await alta(tipo, cuerpo), SIN_TOKEN);
  });

  it.each(CUERPOS_INVALIDOS)('con un token vencido y un cuerpo %s: 401', async (_c, tipo, cuerpo) => {
    esElProblema(await alta({ ...tipo, ...VENCIDO }, cuerpo), TOKEN_VENCIDO);
  });

  it.each(CUERPOS_INVALIDOS)('con un rol que la operación no permite y un cuerpo %s: 403', async (_c, tipo, cuerpo) => {
    esElProblema(await alta({ ...tipo, ...OPERADOR }, cuerpo), SIN_PERMISO);
  });

  it.each(CUERPOS_INVALIDOS)('con un token sin roles conocidos y un cuerpo %s: 403', async (_c, tipo, cuerpo) => {
    esElProblema(await alta({ ...tipo, ...SIN_ROLES }, cuerpo), SIN_PERMISO);
  });

  it.each([
    ['sin token', {}, SIN_TOKEN],
    ['con un token sin roles conocidos', SIN_ROLES, SIN_PERMISO],
  ] as const)('%s, con parámetros de ruta, query y encabezado inválidos', async (_c, token, esperado) => {
    const respuesta = await crearApp(MANEJADORES).inject({
      method: 'GET',
      url: '/pruebas/clientes/no-es-uuid/direcciones/tampoco?pagina=0',
      headers: { ...token, 'x-version': '0' },
    });

    esElProblema(respuesta, esperado);
  });
});

describe('precedencia: con un token válido, el 413 y el 415 van antes que el 400 (RNF-03.5, puntos 6 y 7)', () => {
  it.each([
    ['más de 1 MiB de JSON sin los campos obligatorios', COMO_JSON, JSON.stringify({ relleno: RELLENO }), DEMASIADO_GRANDE],
    ['más de 1 MiB de JSON roto', COMO_JSON, `{"nombre": "${RELLENO}`, DEMASIADO_GRANDE],
    ['un cuerpo de otro tipo sin los campos obligatorios', COMO_TEXTO, '{}', OTRO_TIPO],
    ['un cuerpo de otro tipo con JSON roto', COMO_TEXTO, '{"nombre": ', OTRO_TIPO],
    ['JSON roto y nada más: 400', COMO_JSON, '{"nombre": ', JSON_ROTO],
    ['sin los campos obligatorios y nada más: 400', COMO_JSON, '{}', FALTA_NOMBRE],
  ] as const)('%s', async (_c, tipo, payload, esperado) => {
    const respuesta = await crearApp(MANEJADORES).inject({
      method: 'POST',
      url: '/pruebas/clientes',
      headers: { ...tipo, ...CLIENTE },
      payload,
    });

    esElProblema(respuesta, esperado);
  });
});

// Todas las combinaciones. La operación de este contrato puede tener a la vez un problema de cada punto de RNF-03.5: exige
// el rol CLIENTE, tiene un parámetro de ruta (uuid) y uno de query string (entero desde 1), y pide un cuerpo JSON con
// `nombre`. Por cada combinación de problemas, la respuesta tiene que ser la del primero en el orden.
const CONTRATO_TODO = contratoCon({
  '/pruebas/todo/{id}': {
    post: {
      operationId: 'probarTodo',
      security: [{ bearerAuth: ['CLIENTE'] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'pagina', in: 'query', schema: { type: 'integer', minimum: 1 } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { type: 'object', required: ['nombre'], properties: { nombre: { type: 'string' } } } },
        },
      },
      responses: { '200': { description: 'Bien' } },
    },
  },
});

// Lo que se manda; cada problema cambia una parte. Sin ningún problema, la solicitud es válida y llega al manejador.
type Pedido = {
  method: 'POST' | 'PUT';
  ruta: string;
  id: string;
  query: string;
  token: { authorization?: string };
  tipo: string;
  cuerpo: keyof typeof CUERPOS;
  grande: boolean;
};
const CUERPOS = {
  valido: { chico: '{"nombre":"Ana"}', grande: JSON.stringify({ nombre: 'Ana', relleno: RELLENO }) },
  roto: { chico: '{"nombre": ', grande: `{"nombre": "${RELLENO}` },
  sinNombre: { chico: '{}', grande: JSON.stringify({ relleno: RELLENO }) },
};

type Problema = { nombre: string; parte: keyof Pedido; esperado: Esperado; allow?: string; aplicar: (pedido: Pedido) => void };
const PARAMETRO_LARGO: Problema = {
  nombre: 'un parámetro de ruta de 101 caracteres',
  parte: 'id',
  esperado: URL_INVALIDA,
  aplicar: (pedido) => (pedido.id = 'a'.repeat(101)),
};
const RUTA_INEXISTENTE: Problema = {
  nombre: 'una ruta que no existe',
  parte: 'ruta',
  esperado: NO_ENCONTRADO,
  aplicar: (pedido) => (pedido.ruta = '/pruebas/nada'),
};

// Los problemas posibles de cada punto del orden, del primero al último. El 2 (la parada, 503) llega con T23. El 401 y el
// 403 van en el mismo grupo: un token no puede faltar y traer un rol a la vez.
const ORDEN: Problema[][] = [
  [
    { nombre: 'la URL mal codificada', parte: 'id', esperado: URL_INVALIDA, aplicar: (pedido) => (pedido.id = '%E0%A4%A') },
    PARAMETRO_LARGO,
  ],
  [
    RUTA_INEXISTENTE,
    {
      nombre: 'un método que la ruta no tiene',
      parte: 'method',
      esperado: NO_PERMITIDO,
      allow: 'POST',
      aplicar: (pedido) => (pedido.method = 'PUT'),
    },
  ],
  [
    { nombre: 'sin token', parte: 'token', esperado: SIN_TOKEN, aplicar: (pedido) => (pedido.token = {}) },
    { nombre: 'un rol no permitido', parte: 'token', esperado: SIN_PERMISO, aplicar: (pedido) => (pedido.token = OPERADOR) },
  ],
  [
    { nombre: 'más de 1 MiB', parte: 'grande', esperado: DEMASIADO_GRANDE, aplicar: (pedido) => (pedido.grande = true) },
    { nombre: 'otro tipo', parte: 'tipo', esperado: OTRO_TIPO, aplicar: (pedido) => (pedido.tipo = 'text/plain') },
  ],
  [
    { nombre: 'JSON roto', parte: 'cuerpo', esperado: JSON_ROTO, aplicar: (pedido) => (pedido.cuerpo = 'roto') },
    { nombre: 'sin nombre', parte: 'cuerpo', esperado: FALTA_NOMBRE, aplicar: (pedido) => (pedido.cuerpo = 'sinNombre') },
    {
      nombre: 'una query string inválida',
      parte: 'query',
      esperado: datosInvalidos('El parámetro pagina de la query string tiene que ser mayor o igual que 1'),
      aplicar: (pedido) => (pedido.query = '?pagina=0'),
    },
    {
      nombre: 'un id que no es UUID',
      parte: 'id',
      esperado: datosInvalidos('El parámetro id de la ruta no tiene el formato uuid'),
      aplicar: (pedido) => (pedido.id = 'no-es-uuid'),
    },
  ],
];

// Cada combinación toma a lo sumo un problema de cada punto. No van juntos dos que cambian la misma parte (el id es uno
// solo), ni un parámetro largo con una ruta que no existe: ahí el segmento no es un parámetro y da 404 (T12).
const posible = (problemas: Problema[]) =>
  new Set(problemas.map((problema) => problema.parte)).size === problemas.length &&
  !(problemas.includes(PARAMETRO_LARGO) && problemas.includes(RUTA_INEXISTENTE));
const COMBINACIONES = ORDEN.reduce<Problema[][]>(
  (combinaciones, punto) => combinaciones.flatMap((antes) => [antes, ...punto.map((problema) => [...antes, problema])]),
  [[]],
)
  .filter(posible)
  .map((problemas): [string, Problema[]] => {
    const nombres = problemas.map((problema) => problema.nombre).join(', ') || 'sin ningún problema';
    return [`${nombres}: ${problemas[0]?.esperado.status ?? 200}`, problemas];
  });

describe('precedencia: con varios problemas a la vez, responde por el primero del orden (RNF-03.5)', () => {
  // Una sola app para todas las combinaciones, que no cambian nada en ella: crear una por prueba tarda unos 20 ms, y son 315.
  // No sale de `crearApp`, que cierra sus apps al terminar cada prueba.
  const app = construirApp({
    config: CONFIG,
    contrato: CONTRATO_TODO,
    manejadores: { probarTodo: bien },
    flujoLog: descartarLogs,
  });
  afterAll(() => app.close());

  it('arma todas las combinaciones posibles', () => {
    expect(COMBINACIONES).toHaveLength(315);
  });

  it.each(COMBINACIONES)('%s', async (_titulo, problemas) => {
    const pedido: Pedido = {
      method: 'POST',
      ruta: '/pruebas/todo',
      id: UUID,
      query: '',
      token: CLIENTE,
      tipo: 'application/json',
      cuerpo: 'valido',
      grande: false,
    };
    for (const problema of problemas) problema.aplicar(pedido);

    const respuesta = await app.inject({
      method: pedido.method,
      url: `${pedido.ruta}/${pedido.id}${pedido.query}`,
      headers: { 'content-type': pedido.tipo, ...pedido.token },
      payload: CUERPOS[pedido.cuerpo][pedido.grande ? 'grande' : 'chico'],
    });

    const [primero] = problemas;
    if (primero === undefined) {
      expect(respuesta.statusCode).toBe(200);
      expect(respuesta.json()).toEqual({ ok: true });
    } else {
      esElProblema(respuesta, primero.esperado, primero.allow);
    }
  });
});
