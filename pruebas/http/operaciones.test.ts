import Fastify, { type FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { construirApp } from '../../src/app.js';
import type { Config } from '../../src/config.js';
import { cargarContrato, type Contrato } from '../../src/contrato/cargar.js';
import {
  listarOperaciones,
  registrarOperaciones,
  type Manejador,
  type Manejadores,
} from '../../src/contrato/operaciones.js';

const RUTA_PRUEBA = fileURLToPath(new URL('../ayudas/contrato-prueba.yml', import.meta.url));
const contrato = cargarContrato(RUTA_PRUEBA);

const CONFIG: Config = {
  urlBd: 'postgres://m2:m2@localhost:5432/m2',
  puerto: 8082,
  claveTokens: 'clave-de-prueba-de-32-caracteres!',
  emisorTokens: 'pruebas',
  audienciaTokens: 'm2',
  campoRoles: 'roles',
  tiempoBdMs: 2000,
  tiempoModulosMs: 2000,
  reintentosModulos: 1,
  encabezadoCorrelacion: 'X-Request-Id',
};

const UUID = '00000000-0000-4000-8000-000000000001';
const OTRO_UUID = '00000000-0000-4000-8000-000000000002';
const URL_PARAMETROS = `/pruebas/clientes/${UUID}/direcciones/${OTRO_UUID}`;
const CLIENTE = { nombre: 'Ana', fechaNacimiento: '1990-05-17' };

// Devuelve lo que llegó al manejador después de validar y los permisos que guarda su ruta.
const eco: Manejador = async (request) => ({
  params: request.params,
  query: request.query,
  version: request.headers['x-version'],
  cuerpo: request.body,
  permisos: request.routeOptions.config.permisos,
});

// Un contrato armado en la prueba, para los casos que el contrato de prueba no tiene.
const contratoCon = (paths: object, extra: object = {}): Contrato => ({
  openapi: '3.1.0',
  info: { title: 'Contrato armado en la prueba', version: '0.0.0' },
  ...extra,
  paths,
});

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function crear(manejadores: Manejadores, opciones: { contrato?: Contrato; config?: Partial<Config> } = {}) {
  const app = construirApp({
    config: { ...CONFIG, ...opciones.config },
    contrato: opciones.contrato ?? contrato,
    manejadores,
  });
  apps.push(app);
  return app;
}

describe('construirApp: solo responden las operaciones con manejador (RNF-03.4)', () => {
  it('responde una operación que tiene manejador', async () => {
    const respuesta = await crear({ probarPublica: eco }).inject({ method: 'GET', url: '/pruebas/publica' });

    expect(respuesta.statusCode).toBe(200);
  });

  it.each([
    ['GET', '/pruebas/protegida'],
    ['GET', '/pruebas/sin-roles'],
    ['GET', '/pruebas/publica'],
    ['GET', '/pruebas/clientes'],
    ['POST', '/pruebas/clientes'],
    ['GET', URL_PARAMETROS],
    ['POST', '/pruebas/duplicados'],
    ['GET', '/pruebas/falla'],
    ['GET', '/pruebas/tarda'],
  ] as const)('sin manejadores, %s %s no se registra y da 404', async (method, url) => {
    expect((await crear({}).inject({ method, url })).statusCode).toBe(404);
  });

  it('una operación sin manejador da 404 aunque otras del contrato lo tengan', async () => {
    const app = crear({ probarPublica: eco, probarAlta: eco });

    expect((await app.inject({ method: 'GET', url: '/pruebas/falla' })).statusCode).toBe(404);
  });

  it('el método sin manejador de una ruta no llega al manejador del otro método', async () => {
    const alta = vi.fn(eco);
    const respuesta = await crear({ probarAlta: alta }).inject({ method: 'GET', url: '/pruebas/clientes' });

    // 404, o 405 cuando la app sume las rutas 405 (Lógica 8).
    expect([404, 405]).toContain(respuesta.statusCode);
    expect(alta).not.toHaveBeenCalled();
  });

  it('registrarOperaciones devuelve las implementadas y las pendientes, como listarOperaciones', () => {
    const app = Fastify();
    apps.push(app);
    const manejadores = { probarPublica: eco, probarAlta: eco };

    expect(registrarOperaciones(app, contrato, manejadores, 'X-Request-Id')).toEqual(listarOperaciones(contrato, manejadores));
  });
});

describe('construirApp: rutas con {param} y conversión de tipos (RNF-03.2)', () => {
  it('una ruta con {param} llega al manejador con sus parámetros', async () => {
    const respuesta = await crear({ probarParametros: eco }).inject({ method: 'GET', url: URL_PARAMETROS });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json().params).toEqual({ clienteId: UUID, direccionId: OTRO_UUID });
  });

  it('convierte la query string y completa el valor por defecto del contrato', async () => {
    const app = crear({ probarParametros: eco });
    const sinQuery = await app.inject({ method: 'GET', url: URL_PARAMETROS });
    const conQuery = await app.inject({ method: 'GET', url: `${URL_PARAMETROS}?pagina=3&etiquetas=a` });

    expect(sinQuery.json().query).toEqual({ pagina: 1 });
    expect(conQuery.json().query).toEqual({ pagina: 3, etiquetas: ['a'] });
  });

  it('convierte un encabezado del contrato y no prohíbe los que el contrato no nombra', async () => {
    const respuesta = await crear({ probarParametros: eco }).inject({
      method: 'GET',
      url: URL_PARAMETROS,
      headers: { 'X-Version': '2', 'X-Desconocido': 'algo' },
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json().version).toBe(2);
  });

  it('el cuerpo válido llega al manejador tal como vino', async () => {
    const cuerpo = { ...CLIENTE, direccion: { calle: 'San Martín 100', piso: 3 } };
    const respuesta = await crear({ probarAlta: eco }).inject({ method: 'POST', url: '/pruebas/clientes', payload: cuerpo });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json().cuerpo).toEqual(cuerpo);
  });
});

describe('construirApp: un dato inválido da 400 con el campo en el detail (RNF-03.2)', () => {
  it.each([
    {
      caso: 'un parámetro de ruta definido dentro de paths',
      url: `/pruebas/clientes/${UUID}/direcciones/abc`,
      detail: 'El parámetro direccionId de la ruta no tiene el formato uuid',
    },
    {
      caso: 'un parámetro de ruta definido en components',
      url: `/pruebas/clientes/abc/direcciones/${UUID}`,
      detail: 'El parámetro clienteId de la ruta no tiene el formato uuid',
    },
    {
      caso: 'un parámetro de la query string',
      url: `${URL_PARAMETROS}?pagina=0`,
      detail: 'El parámetro pagina de la query string tiene que ser mayor o igual que 1',
    },
    {
      caso: 'un elemento de una lista de la query string',
      url: `${URL_PARAMETROS}?etiquetas=${'x'.repeat(21)}`,
      detail: 'El parámetro etiquetas.0 de la query string tiene que tener como máximo 20 caracteres',
    },
    {
      caso: 'un encabezado',
      url: URL_PARAMETROS,
      headers: { 'X-Version': 'cero' },
      detail: 'El encabezado x-version tiene que ser un número entero',
    },
    {
      caso: 'un campo que falta en el cuerpo',
      method: 'POST',
      url: '/pruebas/clientes',
      payload: { fechaNacimiento: '1990-05-17' },
      detail: 'Falta el campo nombre en el cuerpo',
    },
    {
      caso: 'un campo anidado que falta',
      method: 'POST',
      url: '/pruebas/clientes',
      payload: { ...CLIENTE, direccion: {} },
      detail: 'Falta el campo direccion.calle en el cuerpo',
    },
    {
      caso: 'un campo de más en el cuerpo',
      method: 'POST',
      url: '/pruebas/clientes',
      payload: { ...CLIENTE, extra: 1 },
      detail: 'El campo extra no está permitido en el cuerpo',
    },
    {
      caso: 'un número donde va un texto (el cuerpo no se convierte)',
      method: 'POST',
      url: '/pruebas/clientes',
      payload: { ...CLIENTE, nombre: 5 },
      detail: 'El campo nombre del cuerpo tiene que ser un texto',
    },
    {
      caso: 'una fecha imposible',
      method: 'POST',
      url: '/pruebas/clientes',
      payload: { ...CLIENTE, fechaNacimiento: '2026-02-30' },
      detail: 'El campo fechaNacimiento del cuerpo no tiene el formato date',
    },
    {
      caso: 'un cuerpo obligatorio que no llega',
      method: 'POST',
      url: '/pruebas/clientes',
      detail: 'El cuerpo tiene que ser un objeto',
    },
  ] as const)('$caso: 400 en problem+json, sin llegar al manejador', async (caso) => {
    const { url, detail } = caso;
    const manejador = vi.fn(eco);
    const respuesta = await crear({ probarParametros: manejador, probarAlta: manejador }).inject({
      method: 'method' in caso ? caso.method : 'GET',
      url,
      headers: 'headers' in caso ? caso.headers : undefined,
      payload: 'payload' in caso ? caso.payload : undefined,
    });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(respuesta.json()).toEqual({
      type: 'about:blank',
      title: 'Solicitud inválida',
      status: 400,
      detail,
      instance: url.split('?')[0],
    });
    expect(manejador).not.toHaveBeenCalled();
  });
});

describe('construirApp: el encabezado de correlación queda fuera de la validación (RNF-14.3)', () => {
  const INVALIDO = 'no valido!';

  it.each([
    ['declarado en la ruta, en una operación protegida', 'probarProtegida', '/pruebas/protegida'],
    ['declarado en la ruta, junto con otros parámetros', 'probarParametros', URL_PARAMETROS],
  ])('un X-Request-Id que no cumple el patrón del contrato no da 400 (%s)', async (_caso, operacion, url) => {
    const respuesta = await crear({ [operacion]: eco }).inject({ method: 'GET', url, headers: { 'X-Request-Id': INVALIDO } });

    expect(respuesta.statusCode).toBe(200);
  });

  it('compara el nombre configurado sin distinguir mayúsculas', async () => {
    const respuesta = await crear({ probarProtegida: eco }, { config: { encabezadoCorrelacion: 'x-request-id' } }).inject({
      method: 'GET',
      url: '/pruebas/protegida',
      headers: { 'X-Request-Id': INVALIDO },
    });

    expect(respuesta.statusCode).toBe(200);
  });

  it('con otro encabezado configurado, el X-Request-Id del contrato se valida como cualquier otro', async () => {
    const respuesta = await crear({ probarProtegida: eco }, { config: { encabezadoCorrelacion: 'X-Correlation-Id' } }).inject({
      method: 'GET',
      url: '/pruebas/protegida',
      headers: { 'X-Request-Id': INVALIDO },
    });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json().detail).toBe('El encabezado x-request-id no tiene el formato esperado');
  });
});

describe('construirApp: cada ruta guarda en su configuración los permisos de su security (RNF-12.1, RNF-12.3)', () => {
  it.each([
    { operacion: 'probarProtegida', url: '/pruebas/protegida', permisos: { publica: false, roles: ['CLIENTE', 'OPERADOR'] } },
    { operacion: 'probarSinRoles', url: '/pruebas/sin-roles', permisos: { publica: false, roles: [] } },
    { operacion: 'probarPublica', url: '/pruebas/publica', permisos: { publica: true, roles: [] } },
    { operacion: 'probarParametros', url: URL_PARAMETROS, permisos: { publica: false, roles: [] } },
  ])('$operacion', async ({ operacion, url, permisos }) => {
    const respuesta = await crear({ [operacion]: eco }).inject({ method: 'GET', url });

    expect(respuesta.json().permisos).toEqual(permisos);
  });

  it('probarAlta, con cuerpo', async () => {
    const respuesta = await crear({ probarAlta: eco }).inject({ method: 'POST', url: '/pruebas/clientes', payload: CLIENTE });

    expect(respuesta.json().permisos).toEqual({ publica: false, roles: ['CLIENTE'] });
  });

  it.each([
    [
      'sin security en la operación ni en el contrato, exige token con cualquier rol',
      undefined,
      undefined,
      { publica: false, roles: [] },
    ],
    [
      'la de la operación manda sobre la global',
      [{ bearerAuth: ['OPERADOR'] }],
      [{ bearerAuth: ['CLIENTE'] }],
      { publica: false, roles: ['CLIENTE'] },
    ],
    [
      'con varias alternativas, los roles de todas, sin repetir',
      undefined,
      [{ bearerAuth: ['CLIENTE'] }, { bearerAuth: ['OPERADOR', 'CLIENTE'] }],
      { publica: false, roles: ['CLIENTE', 'OPERADOR'] },
    ],
    [
      'una alternativa sin roles admite cualquier rol conocido',
      undefined,
      [{ bearerAuth: ['CLIENTE'] }, { bearerAuth: [] }],
      { publica: false, roles: [] },
    ],
    [
      'una alternativa vacía ({}) la hace pública',
      undefined,
      [{}, { bearerAuth: ['CLIENTE'] }],
      { publica: true, roles: [] },
    ],
    [
      'sin security en la operación, vale la global',
      [{ bearerAuth: ['OPERADOR'] }],
      undefined,
      { publica: false, roles: ['OPERADOR'] },
    ],
  ])('%s', async (_caso, global, deLaOperacion, permisos) => {
    const operacion = { operationId: 'x', ...(deLaOperacion && { security: deLaOperacion }) };
    const contratoX = contratoCon({ '/x': { get: operacion } }, global && { security: global });
    const respuesta = await crear({ x: eco }, { contrato: contratoX }).inject({ method: 'GET', url: '/x' });

    expect(respuesta.json().permisos).toEqual(permisos);
  });
});

describe('construirApp: cómo arma el esquema de los parámetros', () => {
  it('un parámetro de la operación reemplaza al de la ruta con el mismo nombre y lugar', async () => {
    const contratoX = contratoCon({
      '/x': {
        parameters: [{ name: 'limite', in: 'query', schema: { type: 'integer', maximum: 5 } }],
        get: { operationId: 'x', parameters: [{ name: 'limite', in: 'query', schema: { type: 'integer', maximum: 100 } }] },
      },
    });
    const app = crear({ x: eco }, { contrato: contratoX });
    const dentro = await app.inject({ method: 'GET', url: '/x?limite=50' });
    const fuera = await app.inject({ method: 'GET', url: '/x?limite=500' });

    expect(dentro.json().query).toEqual({ limite: 50 });
    expect(fuera.json().detail).toBe('El parámetro limite de la query string tiene que ser menor o igual que 100');
  });

  it('exige un encabezado obligatorio, escrito con cualquier combinación de mayúsculas', async () => {
    const contratoX = contratoCon({
      '/x': {
        get: {
          operationId: 'x',
          parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 1 } }],
        },
      },
    });
    const app = crear({ x: eco }, { contrato: contratoX });
    const sin = await app.inject({ method: 'GET', url: '/x' });
    const con = await app.inject({ method: 'GET', url: '/x', headers: { 'IDEMPOTENCY-KEY': 'abc' } });

    expect(sin.statusCode).toBe(400);
    expect(sin.json().detail).toBe('Falta el encabezado idempotency-key');
    expect(con.statusCode).toBe(200);
  });

  it('ignora Accept, Content-Type y Authorization solo como encabezados, como pide OpenAPI', async () => {
    const obligatorio = (name: string, lugar: string) => ({
      name,
      in: lugar,
      required: true,
      schema: { type: 'string', pattern: '^nunca$' },
    });
    const parameters = [
      ...['Accept', 'content-type', 'AUTHORIZATION'].map((nombre) => obligatorio(nombre, 'header')),
      obligatorio('accept', 'query'),
    ];
    const app = crear({ x: eco }, { contrato: contratoCon({ '/x': { get: { operationId: 'x', parameters } } }) });
    const headers = { authorization: 'Bearer otra-cosa' };

    expect((await app.inject({ method: 'GET', url: '/x?accept=nunca', headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/x', headers })).json().detail).toBe(
      'Falta el parámetro accept en la query string',
    );
  });

  it('distingue dos parámetros con el mismo nombre en distinto lugar', async () => {
    const contratoX = contratoCon({
      '/x/{id}': {
        get: {
          operationId: 'x',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'id', in: 'query', schema: { type: 'integer' } },
          ],
        },
      },
    });
    const app = crear({ x: eco }, { contrato: contratoX });

    expect((await app.inject({ method: 'GET', url: `/x/${UUID}?id=7` })).json()).toMatchObject({
      params: { id: UUID },
      query: { id: 7 },
    });
    expect((await app.inject({ method: 'GET', url: '/x/abc?id=7' })).json().detail).toBe(
      'El parámetro id de la ruta no tiene el formato uuid',
    );
  });

  it('resuelve contra el contrato un $ref que está adentro del esquema de un parámetro', async () => {
    const etiquetas = {
      name: 'etiquetas',
      in: 'query',
      schema: { type: 'array', items: { $ref: '#/components/schemas/Etiqueta' } },
    };
    const contratoX = contratoCon(
      { '/x': { get: { operationId: 'x', parameters: [etiquetas] } } },
      { components: { schemas: { Etiqueta: { type: 'string', maxLength: 3 } } } },
    );
    const app = crear({ x: eco }, { contrato: contratoX });

    expect((await app.inject({ method: 'GET', url: '/x?etiquetas=abc' })).json().query).toEqual({ etiquetas: ['abc'] });
    expect((await app.inject({ method: 'GET', url: '/x?etiquetas=abcd' })).json().detail).toBe(
      'El parámetro etiquetas.0 de la query string tiene que tener como máximo 3 caracteres',
    );
  });

  it('escapa y lee los punteros aunque una clave tenga ~ o %, como piden JSON Pointer y URI', async () => {
    const contratoX = contratoCon(
      {
        '/x~1': {
          parameters: [{ name: 'id', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }],
          get: { operationId: 'x' },
        },
        '/y': {
          get: {
            operationId: 'y',
            parameters: [{ $ref: '#/paths/~1x~01/parameters/0' }, { $ref: '#/components/parameters/50%25' }],
          },
        },
      },
      { components: { parameters: { '50%': { name: 'n', in: 'query', schema: { type: 'integer' } } } } },
    );
    const app = crear({ x: eco, y: eco }, { contrato: contratoX });

    expect((await app.inject({ method: 'GET', url: '/x~1?id=abc' })).json().detail).toBe(
      'El parámetro id de la query string no tiene el formato uuid',
    );
    expect((await app.inject({ method: 'GET', url: `/y?id=${UUID}&n=7` })).json().query).toEqual({ id: UUID, n: 7 });
    expect((await app.inject({ method: 'GET', url: '/y?id=abc' })).json().detail).toBe(
      'El parámetro id de la query string no tiene el formato uuid',
    );
  });

  it('sigue un $ref que apunta adentro de paths, con el puntero escapado como JSON Pointer y URI', async () => {
    const contratoX = contratoCon({
      '/x/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        get: { operationId: 'x' },
      },
      '/y/{id}': { get: { operationId: 'y', parameters: [{ $ref: '#/paths/~1x~1%7Bid%7D/parameters/0' }] } },
    });
    const app = crear({ y: eco }, { contrato: contratoX });

    expect((await app.inject({ method: 'GET', url: `/y/${UUID}` })).json().params).toEqual({ id: UUID });
    expect((await app.inject({ method: 'GET', url: '/y/abc' })).json().detail).toBe(
      'El parámetro id de la ruta no tiene el formato uuid',
    );
  });

  it('completa el valor por defecto aunque el parámetro y su esquema sean $ref', async () => {
    const contratoX = contratoCon(
      { '/x': { get: { operationId: 'x', parameters: [{ $ref: '#/components/parameters/Limite' }] } } },
      {
        components: {
          parameters: { Limite: { name: 'limite', in: 'query', schema: { $ref: '#/components/schemas/Limite' } } },
          schemas: { Limite: { type: 'integer', minimum: 1, default: 10 } },
        },
      },
    );
    const app = crear({ x: eco }, { contrato: contratoX });

    expect((await app.inject({ method: 'GET', url: '/x' })).json().query).toEqual({ limite: 10 });
    expect((await app.inject({ method: 'GET', url: '/x?limite=0' })).statusCode).toBe(400);
  });
});

describe('construirApp: el cuerpo', () => {
  const ESQUEMA = { type: 'object', required: ['a'], properties: { a: { type: 'string' } } };

  it('un cuerpo opcional (sin required: true) puede faltar, pero si llega se valida', async () => {
    const contratoX = contratoCon({
      '/x': { post: { operationId: 'x', requestBody: { content: { 'application/json': { schema: ESQUEMA } } } } },
    });
    const app = crear({ x: eco }, { contrato: contratoX });

    expect((await app.inject({ method: 'POST', url: '/x' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/x', payload: {} })).json().detail).toBe('Falta el campo a en el cuerpo');
  });

  it('un cuerpo que es un $ref a components/requestBodies se valida con su esquema', async () => {
    const contratoX = contratoCon(
      { '/x': { post: { operationId: 'x', requestBody: { $ref: '#/components/requestBodies/Alta' } } } },
      { components: { requestBodies: { Alta: { required: true, content: { 'application/json': { schema: ESQUEMA } } } } } },
    );
    const app = crear({ x: eco }, { contrato: contratoX });

    expect((await app.inject({ method: 'POST', url: '/x', payload: { a: 'b' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/x', payload: {} })).json().detail).toBe('Falta el campo a en el cuerpo');
    expect((await app.inject({ method: 'POST', url: '/x' })).json().detail).toBe('El cuerpo tiene que ser un objeto');
  });
});

describe('construirApp: un contrato que no se puede registrar hace fallar la app', () => {
  const conParametro = (parametro: unknown) => contratoCon({ '/x': { get: { operationId: 'x', parameters: [parametro] } } });
  const conSecurity = (security: unknown) => contratoCon({ '/x': { get: { operationId: 'x', security } } });
  const SIN_NOMBRE = /el parámetro #\/paths\/~1x\/get\/parameters\/0 no tiene nombre/;
  const SECURITY_MAL = /la security no es una lista de alternativas, cada una con una lista de roles \(textos\) por esquema/;

  it.each([
    ['un parámetro sin nombre', conParametro({ in: 'query', schema: { type: 'string' } }), SIN_NOMBRE],
    ['un parámetro que no es un objeto', conParametro(null), SIN_NOMBRE],
    [
      'un parámetro en una cookie',
      conParametro({ name: 'sesion', in: 'cookie', schema: { type: 'string' } }),
      /sesion está en cookie/,
    ],
    [
      'un parámetro sin schema',
      conParametro({ name: 'filtro', in: 'query', content: { 'application/json': { schema: { type: 'object' } } } }),
      /el parámetro filtro no tiene schema/,
    ],
    [
      'un cuerpo que no es application/json',
      contratoCon({
        '/x': { get: { operationId: 'x', requestBody: { content: { 'multipart/form-data': { schema: { type: 'object' } } } } } },
      }),
      /no tiene un esquema application\/json/,
    ],
    [
      'un cuerpo application/json sin schema',
      contratoCon({ '/x': { get: { operationId: 'x', requestBody: { content: { 'application/json': {} } } } } }),
      /no tiene un esquema application\/json/,
    ],
    ['una security que no es una lista', conSecurity({ bearerAuth: [] }), SECURITY_MAL],
    ['una alternativa de security que no es un objeto', conSecurity([[]]), SECURITY_MAL],
    ['roles que no están en una lista', conSecurity([{ bearerAuth: 'CLIENTE' }]), SECURITY_MAL],
    ['un rol que no es texto', conSecurity([{ bearerAuth: ['CLIENTE', 5] }]), SECURITY_MAL],
    [
      'un $ref a otro archivo',
      conParametro({ $ref: 'otros.yml#/components/parameters/Limite' }),
      /otros\.yml#\S+ no apunta adentro del contrato/,
    ],
    ['un $ref a algo que no existe', conParametro({ $ref: '#/components/parameters/NoExiste' }), /NoExiste no lleva a nada/],
    [
      'un $ref a un miembro heredado de Object',
      contratoCon(
        { '/x': { get: { operationId: 'x', parameters: [{ $ref: '#/components/parameters/toString' }] } } },
        { components: { parameters: {} } },
      ),
      /toString no lleva a nada/,
    ],
    [
      'un $ref circular',
      contratoCon(
        { '/x': { get: { operationId: 'x', parameters: [{ $ref: '#/components/parameters/A' }] } } },
        { components: { parameters: { A: { $ref: '#/components/parameters/B' }, B: { $ref: '#/components/parameters/A' } } } },
      ),
      /#\/components\/parameters\/A es circular/,
    ],
    [
      'un parámetro de ruta con un guion, que Fastify cortaría',
      contratoCon({ '/x/{cliente-id}': { get: { operationId: 'x' } } }),
      /\{cliente-id\} solo puede tener letras, dígitos y _/,
    ],
  ])('%s', (_caso, contratoX, motivo) => {
    const registrar = () => crear({ x: eco }, { contrato: contratoX });
    const causa = expect.objectContaining({ message: expect.stringMatching(motivo) });

    expect(registrar).toThrow(/^No se pudo registrar la operación x \(GET \/x/);
    expect(registrar).toThrow(motivo);
    expect(registrar).toThrow(expect.objectContaining({ cause: causa }));
  });

  it('un esquema que Ajv no puede compilar hace fallar la app al prepararse', async () => {
    const formatoDesconocido = { name: 'q', in: 'query', schema: { type: 'string', format: 'desconocido' } };
    const app = crear({ x: eco }, { contrato: conParametro(formatoDesconocido) });

    await expect(app.ready()).rejects.toThrow(/unknown format "desconocido"/);
  });
});
