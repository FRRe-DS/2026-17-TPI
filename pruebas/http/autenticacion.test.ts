import Fastify, { type LightMyRequestResponse } from 'fastify';
import { describe, expect, it } from 'vitest';
import { registrarPermisos } from '../../src/auth/permisos.js';
import type { ConfigTokens } from '../../src/config.js';
import type { Manejador } from '../../src/contrato/operaciones.js';
import { responderProblema } from '../../src/errores-fastify.js';
import { contratoCon, crearApp } from '../ayudas/app.js';
import { capturarLogs } from '../ayudas/logs.js';
import { armarToken, bearer, CONFIG_TOKENS, type OpcionesToken } from '../ayudas/tokens.js';

const UUID = '00000000-0000-4000-8000-000000000001';
const OTRO_UUID = '00000000-0000-4000-8000-000000000002';
const URL_PARAMETROS = `/pruebas/clientes/${UUID}/direcciones/${OTRO_UUID}`;
const PROBLEMA_JSON = /^application\/problem\+json/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CLIENTE = { nombre: 'Ana', fechaNacimiento: '1990-05-17' };
const SUB = '5f0c3a52-1d2e-4b6f-9a3c-7e8d9f0a1b2c';
const OTRA_CLAVE = 'otra-clave-de-prueba-de-32-caracteres';

// Los motivos del 401 de RNF-12.2: son el `detail` de la respuesta (los fija tokens.test.ts).
const FALTA = 'Falta el token';
const MAL_FORMADO = 'El token está mal formado';
const FIRMA = 'El token no está firmado con HS256 y la clave del servicio';
const SUB_INVALIDO = 'El sub del token falta, está vacío o no es texto';

// Devuelve lo que el manejador sabe de quien llama.
const quien: Manejador = async (request) => ({ identidad: request.identidad });

const MANEJADORES = {
  probarProtegida: quien,
  probarSinRoles: quien,
  probarPublica: quien,
  probarListado: quien,
  probarAlta: quien,
  probarParametros: quien,
};

// Las operaciones del contrato de prueba que exigen token. `probarProtegida` pide CLIENTE u OPERADOR; `probarAlta`, CLIENTE;
// las otras dos no nombran roles.
const PROTEGIDAS = [
  { operacion: 'probarProtegida', method: 'GET', url: '/pruebas/protegida' },
  { operacion: 'probarSinRoles', method: 'GET', url: '/pruebas/sin-roles' },
  { operacion: 'probarAlta', method: 'POST', url: '/pruebas/clientes', payload: CLIENTE },
  { operacion: 'probarParametros', method: 'GET', url: URL_PARAMETROS },
] as const;

const ahora = () => Math.floor(Date.now() / 1000);

// El valor del encabezado Authorization con un token armado con `opciones`. Es una función porque el token lleva la hora de
// cuando se arma, y estas pruebas usan el reloj real.
const conToken = (opciones: OpcionesToken) => () => bearer(opciones).authorization;

// Una solicitud GET a una operación protegida, con el Authorization que se pase (o sin él).
const pedir = (url: string, authorization?: string, app = crearApp(MANEJADORES)) =>
  app.inject({ method: 'GET', url, headers: authorization === undefined ? {} : { authorization } });

// Comprueba lo que vale para todo 401 y 403 (RNF-03.1, RNF-14.4): problem+json con la forma exacta, el encabezado de
// correlación y la `instance` sin query string.
function esProblema(respuesta: LightMyRequestResponse, status: number, title: string, detail: string, instance: string) {
  expect(respuesta.statusCode).toBe(status);
  expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
  expect(respuesta.headers['x-request-id']).toMatch(UUID_V4);
  expect(respuesta.json()).toEqual({ type: 'about:blank', title, status, detail, instance });
}

describe('autenticación: 401 en una operación protegida si el token no es válido (RNF-12.2)', () => {
  const CASOS_401: [string, () => string | undefined, string][] = [
    ['sin el encabezado Authorization', () => undefined, FALTA],
    ['con un esquema que no es Bearer', () => 'Basic dXN1YXJpbzpjbGF2ZQ==', FALTA],
    ['con Bearer y sin token', () => 'Bearer ', FALTA],
    ['con algo que no es un token', () => 'Bearer esto-no-es-un-token', MAL_FORMADO],
    ['con un token firmado con otra clave', conToken({ clave: OTRA_CLAVE }), FIRMA],
    ['con un token firmado con otro algoritmo (HS384)', conToken({ alg: 'HS384' }), FIRMA],
    ['con un token sin firma (alg none)', conToken({ alg: 'none' }), FIRMA],
    ['con un token sin exp', conToken({ claims: { exp: undefined } }), 'El token no tiene fecha de vencimiento (exp)'],
    ['con un token vencido', conToken({ claims: { exp: ahora() - 3600 } }), 'El token venció'],
    ['con un token con nbf en el futuro', conToken({ claims: { nbf: ahora() + 3600 } }), 'El token todavía no es válido (nbf)'],
    ['con un token sin sub', conToken({ claims: { sub: undefined } }), SUB_INVALIDO],
    ['con un token con el sub vacío', conToken({ claims: { sub: '' } }), SUB_INVALIDO],
    ['con un token con un sub que no es texto', conToken({ claims: { sub: 42 } }), SUB_INVALIDO],
    ['con un token de otro emisor', conToken({ claims: { iss: 'otro-emisor' } }), 'El emisor del token no es el esperado'],
    [
      'con un token de otra audiencia',
      conToken({ claims: { aud: 'otra-audiencia' } }),
      'La audiencia del token no es la esperada',
    ],
    [
      'con un token con roles que no son una lista de textos',
      conToken({ claims: { roles: 'CLIENTE' } }),
      'El campo de roles del token no es una lista de textos',
    ],
  ];

  it.each(CASOS_401)('%s: 401 con WWW-Authenticate y el motivo, sin repetir el token', async (_caso, authorization, motivo) => {
    const valor = authorization();

    const respuesta = await pedir('/pruebas/protegida?x=1', valor);

    esProblema(respuesta, 401, 'No autenticado', motivo, '/pruebas/protegida');
    expect(respuesta.headers['www-authenticate']).toBe('Bearer');
    const token = valor?.replace(/^Bearer /, '') ?? '';
    for (const parte of [token, ...token.split('.')].filter((texto) => texto.length > 8)) {
      expect(respuesta.body).not.toContain(parte);
    }
  });

  it.each(PROTEGIDAS)('$operacion ($method $url) sin token: 401 con WWW-Authenticate', async ({ method, url, ...resto }) => {
    const respuesta = await crearApp(MANEJADORES).inject({ method, url, ...resto });

    esProblema(respuesta, 401, 'No autenticado', FALTA, url);
    expect(respuesta.headers['www-authenticate']).toBe('Bearer');
  });
});

describe('autenticación: 403 si el token es válido y ninguno de sus roles conocidos está permitido (RNF-12.3)', () => {
  const sinPermiso = (respuesta: LightMyRequestResponse, url: string) => {
    esProblema(respuesta, 403, 'Sin permiso', 'El rol del token no permite esta operación', url);
    expect(respuesta.headers['www-authenticate']).toBeUndefined();
  };

  it.each([
    ['un rol que la operación no permite', ['CONDUCTOR']],
    ['el rol SERVICIO, que la operación tampoco permite', ['SERVICIO']],
    ['varios roles, ninguno permitido', ['CONDUCTOR', 'SERVICIO']],
    ['la lista de roles vacía', []],
    ['un solo rol, que el servicio no conoce', ['ADMIN']],
    ['solo roles que el servicio no conoce', ['ADMIN', 'SUPERUSUARIO']],
    ['los roles permitidos escritos en minúsculas', ['cliente', 'operador']],
    ['sin el campo de roles', undefined],
  ])('en una operación que pide CLIENTE u OPERADOR, un token con %s', async (_caso, roles) => {
    const respuesta = await pedir('/pruebas/protegida?x=1', bearer({ claims: { roles } }).authorization);

    sinPermiso(respuesta, '/pruebas/protegida');
  });

  it.each([
    ['la lista de roles vacía', []],
    ['solo roles que el servicio no conoce', ['ADMIN']],
    ['los roles conocidos escritos en minúsculas', ['cliente']],
    ['sin el campo de roles', undefined],
  ])('en una operación que no nombra roles, un token con %s', async (_caso, roles) => {
    for (const url of ['/pruebas/sin-roles', URL_PARAMETROS]) {
      const respuesta = await pedir(url, bearer({ claims: { roles } }).authorization);

      sinPermiso(respuesta, url);
    }
  });

  it('una operación con cuerpo da 403 para un rol que no es el suyo', async () => {
    const respuesta = await crearApp(MANEJADORES).inject({
      method: 'POST',
      url: '/pruebas/clientes',
      headers: bearer({ claims: { roles: ['OPERADOR'] } }),
      payload: CLIENTE,
    });

    sinPermiso(respuesta, '/pruebas/clientes');
  });

  it('una operación que lista un rol que el servicio no conoce no se puede cumplir ni con un token que lo trae', async () => {
    const contrato = contratoCon({ '/x': { get: { operationId: 'x', security: [{ bearerAuth: ['ADMIN'] }] } } });
    const app = crearApp({ x: quien }, { contrato });

    const respuesta = await pedir('/x', bearer({ claims: { roles: ['ADMIN', 'CLIENTE'] } }).authorization, app);

    sinPermiso(respuesta, '/x');
  });
});

describe('autenticación: con un token válido y un rol permitido, el manejador recibe el sub y los roles (RNF-12.4)', () => {
  it.each([
    ['CLIENTE, uno de los dos roles de la operación', ['CLIENTE'], ['CLIENTE']],
    ['OPERADOR, el otro rol de la operación', ['OPERADOR'], ['OPERADOR']],
    ['los dos roles de la operación', ['CLIENTE', 'OPERADOR'], ['CLIENTE', 'OPERADOR']],
    ['un rol permitido y otro que no (el manejador recibe los dos)', ['CONDUCTOR', 'OPERADOR'], ['CONDUCTOR', 'OPERADOR']],
    ['los roles en otro orden', ['OPERADOR', 'CLIENTE'], ['OPERADOR', 'CLIENTE']],
    ['los cuatro roles', ['CLIENTE', 'CONDUCTOR', 'OPERADOR', 'SERVICIO'], ['CLIENTE', 'CONDUCTOR', 'OPERADOR', 'SERVICIO']],
    ['un rol permitido y uno que el servicio no conoce (el manejador recibe el conocido)', ['ADMIN', 'CLIENTE'], ['CLIENTE']],
    ['un rol permitido y otro en minúsculas (el manejador recibe solo el bien escrito)', ['cliente', 'OPERADOR'], ['OPERADOR']],
  ])('en una operación que pide CLIENTE u OPERADOR, un token con %s', async (_caso, roles, esperados) => {
    const respuesta = await pedir('/pruebas/protegida', bearer({ claims: { sub: SUB, roles } }).authorization);

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({ identidad: { sub: SUB, roles: esperados } });
  });

  it.each(['CLIENTE', 'CONDUCTOR', 'OPERADOR', 'SERVICIO'])('una operación sin roles acepta el rol %s', async (rol) => {
    for (const url of ['/pruebas/sin-roles', URL_PARAMETROS]) {
      const respuesta = await pedir(url, bearer({ claims: { sub: SUB, roles: [rol] } }).authorization);

      expect(respuesta.statusCode).toBe(200);
      expect(respuesta.json()).toEqual({ identidad: { sub: SUB, roles: [rol] } });
    }
  });

  it('una operación con cuerpo deja pasar al rol que pide, y el manejador recibe el cuerpo ya validado', async () => {
    const respuesta = await crearApp({
      probarAlta: async (request) => ({ identidad: request.identidad, cuerpo: request.body }),
    }).inject({
      method: 'POST',
      url: '/pruebas/clientes',
      headers: bearer({ claims: { sub: SUB, roles: ['CLIENTE'] } }),
      payload: CLIENTE,
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({ identidad: { sub: SUB, roles: ['CLIENTE'] }, cuerpo: CLIENTE });
  });

  it('usa la clave, el emisor, la audiencia y el campo de roles de la configuración de la app', async () => {
    const otra: ConfigTokens = {
      claveTokens: OTRA_CLAVE,
      emisorTokens: 'otro-emisor',
      audienciaTokens: 'otra-audiencia',
      campoRoles: 'permisos',
    };
    const app = crearApp(MANEJADORES, { config: otra });

    const pedirConToken = (opciones?: OpcionesToken) => pedir('/pruebas/protegida', bearer(opciones).authorization, app);
    const aceptado = await pedirConToken({ config: otra, claims: { sub: SUB, permisos: ['OPERADOR'] } });
    const conLaConfigDePrueba = await pedirConToken();
    const rolesEnOtroCampo = await pedirConToken({ config: otra, claims: { permisos: undefined, roles: ['CLIENTE'] } });

    expect(aceptado.statusCode).toBe(200);
    expect(aceptado.json()).toEqual({ identidad: { sub: SUB, roles: ['OPERADOR'] } });
    expect(conLaConfigDePrueba.statusCode).toBe(401);
    expect(rolesEnOtroCampo.statusCode).toBe(403);
  });
});

describe('autenticación: una operación con security: [] no pide token (RNF-12.1)', () => {
  const PUBLICAS = [
    { operacion: 'probarPublica', url: '/pruebas/publica' },
    { operacion: 'probarListado', url: '/pruebas/clientes' },
  ] as const;

  it.each(PUBLICAS)('$operacion ($url) responde 200 sin token, y el manejador no recibe ninguna identidad', async ({ url }) => {
    const respuesta = await pedir(url);

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({ identidad: null });
  });

  it.each([
    ['uno que no es un token', 'Bearer esto-no-es-un-token'],
    ['uno con otro esquema', 'Basic dXN1YXJpbzpjbGF2ZQ=='],
    ['uno firmado con otra clave', conToken({ clave: OTRA_CLAVE })()],
    ['uno vencido', conToken({ claims: { exp: ahora() - 3600 } })()],
    ['uno válido', conToken({ claims: { sub: SUB } })()],
  ])('si trae %s, no lo mira: 200 y sin identidad', async (_caso, authorization) => {
    const respuesta = await pedir('/pruebas/publica', authorization);

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({ identidad: null });
  });
});

describe('autenticación: una ruta que no declara sus permisos no se registra (RNF-12.1)', () => {
  type App = ReturnType<typeof crearApp>;
  const PUBLICA = { permisos: { publica: true, roles: [] } };

  // Rutas registradas a mano, fuera del contrato, como GET /health cuando no está en él (plan, Lógica 4).
  const SIN_PERMISOS: [string, (app: App) => unknown, string][] = [
    ['con app.route, sin config', (app) => app.route({ method: 'GET', url: '/a-mano', handler: quien }), 'GET'],
    ['con app.route, con config y sin permisos', (app) => app.route({ method: 'GET', url: '/a-mano', config: {}, handler: quien }), 'GET'],
    ['con app.route y dos métodos', (app) => app.route({ method: ['GET', 'POST'], url: '/a-mano', handler: quien }), 'GET, POST'],
    ['con el atajo app.get', (app) => app.get('/a-mano', quien), 'GET'],
  ];

  it.each(SIN_PERMISOS)('%s: falla con el método y la URL, y la ruta no queda registrada', async (_caso, registrar, metodos) => {
    const app = crearApp(MANEJADORES);

    expect(() => registrar(app)).toThrow(
      expect.objectContaining({ message: `La ruta ${metodos} /a-mano no declara sus permisos` }),
    );
    expect((await pedir('/a-mano', undefined, app)).statusCode).toBe(404);
  });

  it('una que se declara pública se registra y responde sin token, sin identidad', async () => {
    const app = crearApp(MANEJADORES);
    app.route({ method: 'GET', url: '/a-mano', config: PUBLICA, handler: quien });

    const respuesta = await pedir('/a-mano', undefined, app);

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({ identidad: null });
  });

  it('una que pide un rol se registra y lo exige como una operación del contrato: 401, 403 y 200', async () => {
    const app = crearApp(MANEJADORES);
    const permisos = { publica: false, roles: ['OPERADOR'] };
    app.route({ method: 'GET', url: '/a-mano', config: { permisos }, handler: quien });

    const sinToken = await pedir('/a-mano', undefined, app);
    const conOtroRol = await pedir('/a-mano', bearer({ claims: { roles: ['CLIENTE'] } }).authorization, app);
    const conSuRol = await pedir('/a-mano', bearer({ claims: { sub: SUB, roles: ['OPERADOR'] } }).authorization, app);

    esProblema(sinToken, 401, 'No autenticado', FALTA, '/a-mano');
    esProblema(conOtroRol, 403, 'Sin permiso', 'El rol del token no permite esta operación', '/a-mano');
    expect(conSuRol.statusCode).toBe(200);
    expect(conSuRol.json()).toEqual({ identidad: { sub: SUB, roles: ['OPERADOR'] } });
  });
});

describe('autenticación: una ruta sin permisos que el onRoute no vio pide token y un rol conocido (RNF-12.1, RNF-12.3)', () => {
  const CONOCIDOS = ['CLIENTE', 'CONDUCTOR', 'OPERADOR', 'SERVICIO'];

  // Una app con una ruta sin `config.permisos` registrada antes que `registrarPermisos`: su onRoute no la ve, como no vería
  // GET /health si se registrara a mano antes que el hook (plan, Lógica 4). crearApp no deja armarla, porque construirApp
  // llama a registrarPermisos antes de registrar cualquier ruta. Tiene solo el hook y el manejador de errores, sin el
  // encabezado de correlación. Cada solicitud arma la suya y la cierra.
  async function pedirAnterior(authorization?: string) {
    const app = Fastify();
    app.get('/anterior', quien);
    registrarPermisos(app, CONFIG_TOKENS);
    app.setErrorHandler(responderProblema);
    const respuesta = await pedir('/anterior', authorization, app);
    await app.close();
    return respuesta;
  }

  // Lo que comprueba esProblema, menos el encabezado de correlación, que esta app no pone.
  function esProblemaDeLaAnterior(respuesta: LightMyRequestResponse, status: number, title: string, detail: string) {
    expect(respuesta.statusCode).toBe(status);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
    expect(respuesta.json()).toEqual({ type: 'about:blank', title, status, detail, instance: '/anterior' });
  }

  it('sin token: 401 con WWW-Authenticate', async () => {
    const respuesta = await pedirAnterior();

    esProblemaDeLaAnterior(respuesta, 401, 'No autenticado', FALTA);
    expect(respuesta.headers['www-authenticate']).toBe('Bearer');
  });

  it.each([
    ['la lista de roles vacía', []],
    ['solo roles que el servicio no conoce', ['ADMIN']],
    ['los roles conocidos escritos en minúsculas', ['cliente']],
    ['sin el campo de roles', undefined],
  ])('con un token con %s: 403', async (_caso, roles) => {
    const respuesta = await pedirAnterior(bearer({ claims: { roles } }).authorization);

    esProblemaDeLaAnterior(respuesta, 403, 'Sin permiso', 'El rol del token no permite esta operación');
    expect(respuesta.headers['www-authenticate']).toBeUndefined();
  });

  it.each(CONOCIDOS)('con el rol %s llega al manejador, con el sub y los roles', async (rol) => {
    const respuesta = await pedirAnterior(bearer({ claims: { sub: SUB, roles: [rol] } }).authorization);

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({ identidad: { sub: SUB, roles: [rol] } });
  });
});

describe('autenticación: la identidad es de cada solicitud', () => {
  it('dos solicitudes a la vez a la misma operación no mezclan sus identidades', async () => {
    const app = crearApp({
      probarProtegida: async (request) => {
        await new Promise((resolver) => setTimeout(resolver, 25));
        return { identidad: request.identidad };
      },
    });

    const [una, otra] = await Promise.all([
      pedir('/pruebas/protegida', bearer({ claims: { sub: 'una', roles: ['CLIENTE'] } }).authorization, app),
      pedir('/pruebas/protegida', bearer({ claims: { sub: 'otra', roles: ['OPERADOR'] } }).authorization, app),
    ]);

    expect(una.json()).toEqual({ identidad: { sub: 'una', roles: ['CLIENTE'] } });
    expect(otra.json()).toEqual({ identidad: { sub: 'otra', roles: ['OPERADOR'] } });
  });

  it('una operación pública no hereda la identidad de la solicitud anterior', async () => {
    const app = crearApp(MANEJADORES);

    const protegida = await pedir('/pruebas/protegida', bearer({ claims: { sub: SUB } }).authorization, app);
    const publica = await pedir('/pruebas/publica', undefined, app);

    expect(protegida.json()).toEqual({ identidad: { sub: SUB, roles: ['CLIENTE'] } });
    expect(publica.json()).toEqual({ identidad: null });
  });
});

describe('autenticación: el token no queda en el log (RNF-19.1)', () => {
  it('ni el 401 ni el 403 lo dejan, ni el encabezado: cada uno deja su línea', async () => {
    const logs = capturarLogs();
    const app = crearApp(MANEJADORES, { flujoLog: logs.flujo });
    const rechazado = armarToken({ clave: OTRA_CLAVE });
    const sinPermiso = armarToken({ claims: { roles: ['CONDUCTOR'] } });

    await pedir('/pruebas/protegida', `Bearer ${rechazado}`, app);
    await pedir('/pruebas/protegida', `Bearer ${sinPermiso}`, app);

    expect(logs.lineas().map((linea) => linea.estado)).toEqual([401, 403]);
    for (const token of [rechazado, sinPermiso]) {
      for (const parte of [token, ...token.split('.')]) expect(logs.texto()).not.toContain(parte);
    }
    expect(logs.texto()).not.toMatch(/bearer|authorization/i);
  });
});
