import _Ajv2020 from 'ajv/dist/2020.js';
import _addFormats from 'ajv-formats';
import { errorCodes } from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  aProblema,
  BaseNoDisponible,
  Conflicto,
  Deteniendose,
  MetodoNoPermitido,
  ModuloNoDisponible,
  ErrorDeIntegracion,
  NoAutenticado,
  NoEncontrado,
  Problema,
  SinPermiso,
  SolicitudIlegible,
} from '../../src/errores.js';

// Con "module": "nodenext", TypeScript no deja construir ni invocar la importación por defecto de estos dos paquetes
// CommonJS; su `.default` sí, y existe en ejecución.
const Ajv2020 = _Ajv2020.default;
const addFormats = _addFormats.default;
const ajv = addFormats(new Ajv2020());

const RUTA = '/api/v1/clientes/123';
const CON_QUERY = `${RUTA}?nombre=Ana&token=secreto`;
const SECRETO = 'valor-secreto-123';

const CLAVES_CON_INSTANCE = ['type', 'title', 'status', 'detail', 'instance'];
const CLAVES_SIN_INSTANCE = ['type', 'title', 'status', 'detail'];

type Fila = {
  origen: string;
  error: () => unknown;
  codigo: number;
  title: string;
  detail: string;
  encabezados?: Record<string, string>;
};

// Un error de Node al leer el HTTP, como los que recibe `clientError`: lo único que importa es su código.
const errorDeNode = (code: string) => Object.assign(new Error('Parse Error: mensaje interno de Node'), { code });

// Una fila por cada origen de la tabla de Lógica 6 que lanza nuestro código.
const NOMBRADOS: Fila[] = [
  {
    origen: 'NoAutenticado',
    error: () => new NoAutenticado('El token venció'),
    codigo: 401,
    title: 'No autenticado',
    detail: 'El token venció',
    encabezados: { 'WWW-Authenticate': 'Bearer' },
  },
  {
    origen: 'SinPermiso',
    error: () => new SinPermiso(),
    codigo: 403,
    title: 'Sin permiso',
    detail: 'El rol del token no permite esta operación',
  },
  {
    origen: 'NoEncontrado',
    error: () => new NoEncontrado(),
    codigo: 404,
    title: 'No encontrado',
    detail: 'No existe la ruta pedida',
  },
  {
    origen: 'MetodoNoPermitido',
    error: () => new MetodoNoPermitido(['GET', 'HEAD']),
    codigo: 405,
    title: 'Método no permitido',
    detail: 'La ruta solo admite los métodos de Allow',
    encabezados: { Allow: 'GET, HEAD' },
  },
  {
    origen: 'Conflicto',
    error: () => new Conflicto(),
    codigo: 409,
    title: 'Conflicto',
    detail: 'Ya existe un registro con esos datos',
  },
  {
    origen: 'ModuloNoDisponible',
    error: () => new ModuloNoDisponible('M6'),
    codigo: 503,
    title: 'Servicio no disponible',
    detail: 'M6 no está disponible',
  },
  {
    origen: 'BaseNoDisponible',
    error: () => new BaseNoDisponible(),
    codigo: 503,
    title: 'Servicio no disponible',
    detail: 'La base de datos no está disponible',
  },
  {
    origen: 'ErrorDeIntegracion',
    error: () => new ErrorDeIntegracion({ cause: new Error('M6 respondió 401') }),
    codigo: 500,
    title: 'Error interno',
    detail: 'Ocurrió un error interno',
  },
  {
    origen: 'Deteniendose',
    error: () => new Deteniendose(),
    codigo: 503,
    title: 'Servicio no disponible',
    detail: 'El servicio se está deteniendo',
  },
  {
    origen: 'SolicitudIlegible',
    error: () => new SolicitudIlegible(),
    codigo: 400,
    title: 'Solicitud inválida',
    detail: 'La solicitud no se pudo leer',
  },
];

const MENSAJE_INTERNO =
  'duplicate key value violates unique constraint "clientes_email_key" en SELECT * FROM clientes WHERE email = \'ana@ejemplo.com\'';

// Los que no lanza nuestro código: Fastify, Node o cualquier librería. `aProblema` los reconoce por su `code`.
const AJENOS: Fila[] = [
  {
    origen: 'FST_ERR_CTP_INVALID_JSON_BODY',
    error: () => new errorCodes.FST_ERR_CTP_INVALID_JSON_BODY(),
    codigo: 400,
    title: 'Solicitud inválida',
    detail: 'El cuerpo no es JSON válido',
  },
  {
    origen: 'FST_ERR_CTP_EMPTY_JSON_BODY',
    error: () => new errorCodes.FST_ERR_CTP_EMPTY_JSON_BODY(),
    codigo: 400,
    title: 'Solicitud inválida',
    detail: 'El cuerpo no es JSON válido',
  },
  {
    origen: 'FST_ERR_BAD_URL',
    error: () => new errorCodes.FST_ERR_BAD_URL('%E0%A4%A'),
    codigo: 400,
    title: 'Solicitud inválida',
    detail: 'La URL no es válida, o un parámetro de la ruta supera los 100 caracteres',
  },
  {
    // Fastify le pone 414, pero el contrato no lo documenta: es un 400 (RNF-03.2).
    origen: 'FST_ERR_MAX_PARAM_LENGTH',
    error: () => new errorCodes.FST_ERR_MAX_PARAM_LENGTH('a'.repeat(101)),
    codigo: 400,
    title: 'Solicitud inválida',
    detail: 'La URL no es válida, o un parámetro de la ruta supera los 100 caracteres',
  },
  {
    origen: 'FST_ERR_CTP_INVALID_CONTENT_LENGTH',
    error: () => new errorCodes.FST_ERR_CTP_INVALID_CONTENT_LENGTH(),
    codigo: 400,
    title: 'Solicitud inválida',
    detail: 'La solicitud no se pudo leer',
  },
  {
    origen: 'HPE_INVALID_METHOD',
    error: () => errorDeNode('HPE_INVALID_METHOD'),
    codigo: 400,
    title: 'Solicitud inválida',
    detail: 'La solicitud no se pudo leer',
  },
  {
    origen: 'HPE_INVALID_CONTENT_LENGTH',
    error: () => errorDeNode('HPE_INVALID_CONTENT_LENGTH'),
    codigo: 400,
    title: 'Solicitud inválida',
    detail: 'La solicitud no se pudo leer',
  },
  {
    origen: 'ERR_HTTP_REQUEST_TIMEOUT',
    error: () => errorDeNode('ERR_HTTP_REQUEST_TIMEOUT'),
    codigo: 408,
    title: 'Tiempo agotado',
    detail: 'La solicitud no terminó de llegar a tiempo',
  },
  {
    origen: 'FST_ERR_CTP_BODY_TOO_LARGE',
    error: () => new errorCodes.FST_ERR_CTP_BODY_TOO_LARGE(),
    codigo: 413,
    title: 'Cuerpo demasiado grande',
    detail: 'El cuerpo supera 1 MiB',
  },
  {
    origen: 'FST_ERR_CTP_INVALID_MEDIA_TYPE',
    error: () => new errorCodes.FST_ERR_CTP_INVALID_MEDIA_TYPE(),
    codigo: 415,
    title: 'Tipo de contenido no soportado',
    detail: 'El cuerpo tiene que ser application/json',
  },
  {
    origen: 'HPE_HEADER_OVERFLOW',
    error: () => errorDeNode('HPE_HEADER_OVERFLOW'),
    codigo: 431,
    title: 'Encabezados demasiado grandes',
    detail: 'Los encabezados superan 16 KiB',
  },
  {
    origen: 'cualquier otro error',
    error: () => new Error(MENSAJE_INTERNO),
    codigo: 500,
    title: 'Error interno',
    detail: 'Ocurrió un error interno',
  },
];

const FILAS = [...NOMBRADOS, ...AJENOS];

describe('aProblema: cada fila de la tabla (RNF-03.1, RNF-03.2)', () => {
  it.each(FILAS)('$origen → $codigo', ({ error, codigo, title, detail, encabezados }) => {
    const respuesta = aProblema(error(), CON_QUERY);

    expect(respuesta.codigo).toBe(codigo);
    expect(respuesta.cuerpo).toEqual({ type: 'about:blank', title, status: codigo, detail, instance: RUTA });
    expect(Object.keys(respuesta.cuerpo)).toEqual(CLAVES_CON_INSTANCE);
    expect(respuesta.encabezados).toEqual({ ...encabezados, 'Content-Type': 'application/problem+json' });
  });

  it.each(FILAS)('$origen: sin la ruta, el cuerpo va sin instance', ({ error }) => {
    expect(Object.keys(aProblema(error()).cuerpo)).toEqual(CLAVES_SIN_INSTANCE);
  });

  it.each(AJENOS)('$origen: no repite el mensaje original del error', ({ error }) => {
    const original = error();
    const cuerpo = JSON.stringify(aProblema(original, RUTA).cuerpo);

    expect(original).toBeInstanceOf(Error);
    expect(cuerpo).not.toContain((original as Error).message);
  });
});

describe('aProblema: instance (RNF-03.1)', () => {
  it('es la ruta sin la query string', () => {
    expect(aProblema(new NoEncontrado(), CON_QUERY).cuerpo.instance).toBe(RUTA);
  });

  it.each([
    ['sin query string', RUTA, RUTA],
    ['con el signo ? al final', `${RUTA}?`, RUTA],
    ['con varios parámetros', `${RUTA}?a=1&b=2`, RUTA],
    ['con un segundo ? dentro de la query string', `${RUTA}?a=1?b=2`, RUTA],
    ['la raíz', '/?x=1', '/'],
  ])('%s', (_caso, ruta, esperada) => {
    expect(aProblema(new NoEncontrado(), ruta).cuerpo.instance).toBe(esperada);
  });

  it('nada de la query string aparece en ninguna parte de la respuesta', () => {
    for (const { error } of FILAS) {
      expect(JSON.stringify(aProblema(error(), CON_QUERY))).not.toMatch(/secreto|nombre=Ana/);
    }
  });

  it.each([undefined, ''])('sin ruta (%j), el cuerpo no tiene la clave instance', (ruta) => {
    const { cuerpo } = aProblema(new NoEncontrado(), ruta);

    expect('instance' in cuerpo).toBe(false);
  });
});

describe('Problema: el error de negocio del contrato (RNF-03.2)', () => {
  const propio = () =>
    new Problema({
      codigo: 422,
      type: 'https://ejemplo.test/errores/regla-de-negocio',
      title: 'Regla de negocio',
      detail: 'No se puede hacer eso',
    });

  it('usa su código, su type, su title y su detail', () => {
    expect(aProblema(propio(), CON_QUERY)).toEqual({
      codigo: 422,
      cuerpo: {
        type: 'https://ejemplo.test/errores/regla-de-negocio',
        title: 'Regla de negocio',
        status: 422,
        detail: 'No se puede hacer eso',
        instance: RUTA,
      },
      encabezados: { 'Content-Type': 'application/problem+json' },
    });
  });

  it('sin type propio, usa about:blank', () => {
    const problema = new Problema({ codigo: 418, title: 'Tetera', detail: 'Soy una tetera' });

    expect(aProblema(problema).cuerpo.type).toBe('about:blank');
  });

  it('suma sus encabezados, pero el Content-Type siempre es problem+json', () => {
    const problema = new Problema({
      codigo: 429,
      title: 'Demasiadas solicitudes',
      detail: 'Probá de nuevo más tarde',
      encabezados: { 'Retry-After': '30', 'Content-Type': 'text/plain' },
    });

    expect(aProblema(problema).encabezados).toEqual({
      'Retry-After': '30',
      'Content-Type': 'application/problem+json',
    });
  });

  it('cada llamada devuelve encabezados nuevos: cambiarlos no afecta al error', () => {
    const error = new MetodoNoPermitido(['GET']);
    aProblema(error).encabezados.Allow = 'POST';

    expect(aProblema(error).encabezados.Allow).toBe('GET');
    expect(error.encabezados).toEqual({ Allow: 'GET' });
  });
});

describe('errores con nombre', () => {
  it.each(NOMBRADOS)('$origen es un Problema y un Error, con su nombre y su detail como mensaje', ({ error, origen, detail, codigo }) => {
    const instancia = error();

    expect(instancia).toBeInstanceOf(Problema);
    expect(instancia).toBeInstanceOf(Error);
    expect(instancia).toMatchObject({ name: origen, message: detail, detail, codigo });
  });

  it('ModuloNoDisponible nombra el módulo que falló (RNF-13.3)', () => {
    expect(aProblema(new ModuloNoDisponible('M1')).cuerpo.detail).toBe('M1 no está disponible');
    expect(aProblema(new ModuloNoDisponible('M9')).cuerpo.detail).toBe('M9 no está disponible');
  });

  it('ModuloNoDisponible lleva Retry-After en segundos si se lo pasan (RF-2.4.6), y la causa sigue yendo aparte', () => {
    const causa = new Error('M6 respondió 500');
    const error = new ModuloNoDisponible('M6', { cause: causa, reintentarDespuesS: 5 });
    const respuesta = aProblema(error);

    expect(respuesta.codigo).toBe(503);
    expect(respuesta.encabezados).toEqual({ 'Retry-After': '5', 'Content-Type': 'application/problem+json' });
    expect(respuesta.cuerpo.detail).toBe('M6 no está disponible');
    expect(error.cause).toBe(causa);
  });

  it('sin Retry-After, el 503 de un módulo y el de la base quedan como antes: solo el Content-Type', () => {
    for (const error of [new ModuloNoDisponible('M6'), new ModuloNoDisponible('M6', { cause: new Error('x') }), new BaseNoDisponible()]) {
      expect(aProblema(error).encabezados).toEqual({ 'Content-Type': 'application/problem+json' });
    }
  });

  it('NoAutenticado dice el motivo que recibe y siempre pide Bearer (RNF-12.2)', () => {
    const respuesta = aProblema(new NoAutenticado('Falta el token'));

    expect(respuesta.cuerpo.detail).toBe('Falta el token');
    expect(respuesta.encabezados['WWW-Authenticate']).toBe('Bearer');
  });

  it('MetodoNoPermitido arma Allow con los métodos que recibe, sean una lista o un conjunto', () => {
    expect(aProblema(new MetodoNoPermitido(['GET'])).encabezados.Allow).toBe('GET');
    expect(aProblema(new MetodoNoPermitido(new Set(['PUT', 'DELETE']))).encabezados.Allow).toBe('PUT, DELETE');
  });

  it('Conflicto no tiene dónde guardar la restricción ni la consulta (RNF-08.1)', () => {
    const { cuerpo } = aProblema(new Conflicto(), CON_QUERY);

    expect(cuerpo).toEqual({
      type: 'about:blank',
      title: 'Conflicto',
      status: 409,
      detail: 'Ya existe un registro con esos datos',
      instance: RUTA,
    });
  });
});

describe('aProblema: error interno (RNF-03.3)', () => {
  const errorDePg = () =>
    Object.assign(new Error('duplicate key value violates unique constraint "clientes_email_key"'), {
      code: '23505',
      constraint: 'clientes_email_key',
      table: 'tabla_interna',
      detail: 'Key (email)=(ana@ejemplo.com) already exists.',
    });

  it('no trae el mensaje original, la traza ni la consulta', () => {
    const error = new Error(MENSAJE_INTERNO);
    const texto = JSON.stringify(aProblema(error, RUTA));

    expect(texto).not.toContain('clientes_email_key');
    expect(texto).not.toContain('SELECT');
    expect(texto).not.toContain('ana@ejemplo.com');
    expect(texto).not.toContain('at ');
    expect(texto).not.toContain(error.stack ?? 'sin traza');
  });

  it('un error de pg sin convertir (lo hace consultar()) no filtra la restricción ni los datos (RNF-08.1)', () => {
    const respuesta = aProblema(errorDePg(), RUTA);

    expect(respuesta.codigo).toBe(500);
    expect(JSON.stringify(respuesta)).not.toMatch(/clientes_email_key|tabla_interna|ana@ejemplo|23505|Key \(email\)|duplicate key/);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['un texto', 'algo falló'],
    ['un número', 42],
    ['un símbolo', Symbol('falla')],
    ['un objeto vacío', {}],
    ['un objeto con message', { message: 'algo falló' }],
    ['un error con statusCode 400 que no conoce', Object.assign(new Error('x'), { statusCode: 400 })],
    ['un error con statusCode 503 que no conoce', Object.assign(new Error('x'), { statusCode: 503 })],
    ['un código que no es texto', Object.assign(new Error('x'), { code: 400 })],
    ['un código desconocido', Object.assign(new Error('x'), { code: 'ESTO_NO_EXISTE' })],
  ])('%s → 500', (_caso, valor) => {
    const respuesta = aProblema(valor, RUTA);

    expect(respuesta.codigo).toBe(500);
    expect(respuesta.cuerpo.detail).toBe('Ocurrió un error interno');
  });

  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf'])(
    'el código %s no se confunde con un miembro de Object',
    (code) => {
      expect(aProblema(errorDeNode(code), RUTA).codigo).toBe(500);
    },
  );
});

describe('aProblema: validación (RNF-03.2)', () => {
  type Caso = { caso: string; esquema: object; datos: unknown; contexto?: string; detail: string };

  const objeto = (properties: Record<string, object>, extra: Record<string, unknown> = {}) => ({
    type: 'object',
    properties,
    ...extra,
  });

  // Lo que Fastify entrega al manejador de errores cuando falla la validación: los errores de Ajv y dónde estaban los datos.
  function errorDeValidacion(esquema: object, datos: unknown, contexto: string): Error {
    const validar = ajv.compile(esquema);
    if (validar(datos)) throw new Error('los datos cumplían el esquema: la prueba está mal armada');
    return Object.assign(new Error(`${contexto} mensaje original de Fastify, en inglés`), {
      code: 'FST_ERR_VALIDATION',
      statusCode: 400,
      validation: validar.errors,
      validationContext: contexto,
    });
  }

  const TIPOS = {
    string: 'un texto',
    integer: 'un número entero',
    number: 'un número',
    boolean: 'verdadero o falso',
    array: 'una lista',
    object: 'un objeto',
    null: 'nulo',
  };

  const CASOS: Caso[] = [
    {
      caso: 'falta un campo del cuerpo',
      esquema: objeto({ nombre: { type: 'string' } }, { required: ['nombre'] }),
      datos: {},
      detail: 'Falta el campo nombre en el cuerpo',
    },
    {
      caso: 'falta un campo de un objeto anidado',
      esquema: objeto({ direccion: objeto({ calle: { type: 'string' } }, { required: ['calle'] }) }),
      datos: { direccion: {} },
      detail: 'Falta el campo direccion.calle en el cuerpo',
    },
    {
      caso: 'falta un parámetro de la ruta',
      esquema: objeto({ id: { type: 'string' } }, { required: ['id'] }),
      datos: {},
      contexto: 'params',
      detail: 'Falta el parámetro id en la ruta',
    },
    {
      caso: 'falta un parámetro de la query string',
      esquema: objeto({ pagina: { type: 'string' } }, { required: ['pagina'] }),
      datos: {},
      contexto: 'querystring',
      detail: 'Falta el parámetro pagina en la query string',
    },
    {
      caso: 'falta un encabezado',
      esquema: objeto({ 'x-token': { type: 'string' } }, { required: ['x-token'] }),
      datos: {},
      contexto: 'headers',
      detail: 'Falta el encabezado x-token',
    },
    {
      caso: 'sobra un campo',
      esquema: objeto({ nombre: { type: 'string' } }, { additionalProperties: false }),
      datos: { nombre: 'Ana', extra: 1 },
      detail: 'El campo extra no está permitido en el cuerpo',
    },
    {
      caso: 'sobra un campo de un objeto anidado',
      esquema: objeto({ direccion: objeto({ calle: { type: 'string' } }, { additionalProperties: false }) }),
      datos: { direccion: { calle: 'San Martín', piso: 3 } },
      detail: 'El campo direccion.piso no está permitido en el cuerpo',
    },
    ...Object.entries(TIPOS).map(([tipo, texto]) => ({
      caso: `un campo que tiene que ser de tipo ${tipo}`,
      esquema: objeto({ x: { type: tipo } }),
      datos: { x: tipo === 'string' ? 5 : 'a' },
      detail: `El campo x del cuerpo tiene que ser ${texto}`,
    })),
    {
      caso: 'un campo que admite dos tipos',
      esquema: objeto({ x: { type: ['string', 'null'] } }),
      datos: { x: 5 },
      detail: 'El campo x del cuerpo tiene que ser un texto o nulo',
    },
    {
      caso: 'el cuerpo entero no es un objeto',
      esquema: objeto({}),
      datos: [],
      detail: 'El cuerpo tiene que ser un objeto',
    },
    {
      caso: 'un parámetro de la ruta de tipo entero',
      esquema: objeto({ id: { type: 'integer' } }),
      datos: { id: 'a' },
      contexto: 'params',
      detail: 'El parámetro id de la ruta tiene que ser un número entero',
    },
    {
      caso: 'un parámetro de la query string de tipo entero',
      esquema: objeto({ pagina: { type: 'integer' } }),
      datos: { pagina: 'a' },
      contexto: 'querystring',
      detail: 'El parámetro pagina de la query string tiene que ser un número entero',
    },
    {
      caso: 'un encabezado de tipo entero',
      esquema: objeto({ 'x-edad': { type: 'integer' } }),
      datos: { 'x-edad': 'a' },
      contexto: 'headers',
      detail: 'El encabezado x-edad tiene que ser un número entero',
    },
    {
      caso: 'un formato',
      esquema: objeto({ id: { type: 'string', format: 'uuid' } }),
      datos: { id: SECRETO },
      contexto: 'params',
      detail: 'El parámetro id de la ruta no tiene el formato uuid',
    },
    {
      caso: 'un valor fuera de la lista',
      esquema: objeto({ estado: { enum: ['ACTIVA', 'BLOQUEADA'] } }),
      datos: { estado: SECRETO },
      detail: 'El campo estado del cuerpo no es uno de los valores permitidos',
    },
    {
      caso: 'un valor fijo',
      esquema: objeto({ version: { const: 1 } }),
      datos: { version: 2 },
      detail: 'El campo version del cuerpo no tiene el valor esperado',
    },
    {
      caso: 'un texto demasiado corto',
      esquema: objeto({ nombre: { type: 'string', minLength: 3 } }),
      datos: { nombre: 'Al' },
      detail: 'El campo nombre del cuerpo tiene que tener al menos 3 caracteres',
    },
    {
      caso: 'un texto que no puede estar vacío',
      esquema: objeto({ nombre: { type: 'string', minLength: 1 } }),
      datos: { nombre: '' },
      detail: 'El campo nombre del cuerpo tiene que tener al menos 1 carácter',
    },
    {
      caso: 'un texto demasiado largo',
      esquema: objeto({ nombre: { type: 'string', maxLength: 5 } }),
      datos: { nombre: 'Alejandra' },
      detail: 'El campo nombre del cuerpo tiene que tener como máximo 5 caracteres',
    },
    {
      caso: 'un texto de un solo carácter como máximo',
      esquema: objeto({ letra: { type: 'string', maxLength: 1 } }),
      datos: { letra: 'ab' },
      detail: 'El campo letra del cuerpo tiene que tener como máximo 1 carácter',
    },
    {
      caso: 'un número menor que el mínimo',
      esquema: objeto({ edad: { type: 'integer', minimum: 18 } }),
      datos: { edad: 17 },
      detail: 'El campo edad del cuerpo tiene que ser mayor o igual que 18',
    },
    {
      caso: 'un número mayor que el máximo',
      esquema: objeto({ edad: { type: 'integer', maximum: 120 } }),
      datos: { edad: 121 },
      detail: 'El campo edad del cuerpo tiene que ser menor o igual que 120',
    },
    {
      caso: 'un texto que no cumple el patrón',
      esquema: objeto({ codigo: { type: 'string', pattern: '^[A-Z]{3}$' } }),
      datos: { codigo: SECRETO },
      detail: 'El campo codigo del cuerpo no tiene el formato esperado',
    },
    {
      caso: 'una lista con elementos repetidos',
      esquema: objeto({ etiquetas: { type: 'array', uniqueItems: true } }),
      datos: { etiquetas: ['a', 'a'] },
      detail: 'El campo etiquetas del cuerpo no puede tener elementos repetidos',
    },
    {
      caso: 'un cuerpo con un campo como mínimo',
      esquema: objeto({ nombre: { type: 'string' } }, { minProperties: 1 }),
      datos: {},
      detail: 'El cuerpo tiene que tener al menos 1 campo',
    },
    {
      caso: 'un cuerpo con dos campos como mínimo',
      esquema: objeto({ a: { type: 'string' }, b: { type: 'string' } }, { minProperties: 2 }),
      datos: { a: 'x' },
      detail: 'El cuerpo tiene que tener al menos 2 campos',
    },
    {
      caso: 'el elemento de una lista',
      esquema: objeto({ items: { type: 'array', items: objeto({ x: { type: 'integer' } }) } }),
      datos: { items: [{ x: 1 }, { x: 'a' }] },
      detail: 'El campo items.1.x del cuerpo tiene que ser un número entero',
    },
    {
      caso: 'un nombre con / y ~ (JSON Pointer)',
      esquema: objeto({ 'a/b~c': { type: 'string' } }),
      datos: { 'a/b~c': 5 },
      detail: 'El campo a/b~c del cuerpo tiene que ser un texto',
    },
    {
      // Ajv escribe el ~ como ~0: «~01» es «~1», no «/». Decodificar en el orden contrario lo confunde.
      caso: 'un nombre que contiene ~1 escrito tal cual',
      esquema: objeto({ 'a~1b': { type: 'string' } }),
      datos: { 'a~1b': 5 },
      detail: 'El campo a~1b del cuerpo tiene que ser un texto',
    },
    {
      caso: 'una regla que no tiene mensaje propio',
      esquema: objeto({ n: { type: 'integer', multipleOf: 5 } }),
      datos: { n: 7 },
      detail: 'El campo n del cuerpo no es válido',
    },
    {
      caso: 'un error sin campo fuera del cuerpo (no se puede nombrar)',
      esquema: objeto({ a: { type: 'string' } }, { minProperties: 1 }),
      datos: {},
      contexto: 'querystring',
      detail: 'La solicitud no es válida',
    },
  ];

  it.each(CASOS)('$caso', ({ esquema, datos, contexto = 'body', detail }) => {
    const respuesta = aProblema(errorDeValidacion(esquema, datos, contexto), CON_QUERY);

    expect(respuesta.codigo).toBe(400);
    expect(respuesta.cuerpo).toEqual({
      type: 'about:blank',
      title: 'Solicitud inválida',
      status: 400,
      detail,
      instance: RUTA,
    });
    expect(respuesta.encabezados).toEqual({ 'Content-Type': 'application/problem+json' });
  });

  it('no repite el mensaje de Fastify ni el valor que mandó quien llamó', () => {
    const esquema = objeto({ id: { type: 'string', format: 'uuid' } });
    const error = errorDeValidacion(esquema, { id: SECRETO }, 'params');
    const texto = JSON.stringify(aProblema(error, RUTA));

    expect(texto).not.toContain(SECRETO);
    expect(texto).not.toContain('mensaje original de Fastify');
  });

  it.each([
    ['sin validationContext', undefined],
    ['con un validationContext que no conoce', 'cookies'],
    ['con un validationContext que no es texto', 42],
  ])('%s, no puede decir dónde estaba el dato', (_caso, contexto) => {
    const error = errorDeValidacion(objeto({ x: { type: 'string' } }, { required: ['x'] }), {}, 'body');
    Object.assign(error, { validationContext: contexto });

    expect(aProblema(error, RUTA).cuerpo.detail).toBe('La solicitud no es válida');
  });

  it.each([
    ['una lista de errores vacía', { code: 'FST_ERR_VALIDATION', validation: [], validationContext: 'body' }],
    ['elementos que no son errores de Ajv', { validation: ['texto', null, 7], validationContext: 'body' }],
    ['un error de Ajv incompleto', { validation: [{ keyword: 'type' }], validationContext: 'body' }],
    ['FST_ERR_VALIDATION sin la lista de errores', { code: 'FST_ERR_VALIDATION', validationContext: 'body' }],
  ])('%s → 400 que no puede nombrar el campo', (_caso, propiedades) => {
    const respuesta = aProblema(Object.assign(new Error('x'), propiedades), RUTA);

    expect(respuesta.codigo).toBe(400);
    expect(respuesta.cuerpo.title).toBe('Solicitud inválida');
    expect(respuesta.cuerpo.detail).toBe('La solicitud no es válida');
  });
});
