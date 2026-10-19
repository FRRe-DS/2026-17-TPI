import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cargarContrato, RUTA_CONTRATO, type Contrato } from '../../src/contrato/cargar.js';
import { crearCompilador, ID_CONTRATO } from '../../src/contrato/validacion.js';
import { aProblema } from '../../src/errores.js';

const RUTA_PRUEBA = fileURLToPath(new URL('../ayudas/contrato-prueba.yml', import.meta.url));
const contrato = cargarContrato(RUTA_PRUEBA);
const compilar = crearCompilador(contrato);

// Como lo llama Fastify: un esquema por cada parte de la solicitud que valida.
const validador = (httpPart: string | undefined, schema: unknown) =>
  compilar({ schema, httpPart, method: 'GET', url: '/pruebas' });

// Un `$ref` a un esquema del contrato. Lo que está dentro de `paths` va escapado como JSON Pointer (~1 por /, ~0 por
// ~) y con { y } codificados (%7B y %7D), como lo arma registrarOperaciones.
const ref = (puntero: string) => ({ $ref: `${ID_CONTRATO}#${puntero}` });

const RUTA_PARAMETROS = '/paths/~1pruebas~1clientes~1%7BclienteId%7D~1direcciones~1%7BdireccionId%7D';
const CLIENTE_NUEVO = ref('/components/schemas/ClienteNuevo');
const CLIENTE_ID = ref('/components/parameters/ClienteId/schema');
const DIRECCION_ID = ref(`${RUTA_PARAMETROS}/parameters/2/schema`);
const PAGINA = ref('/components/parameters/Pagina/schema');
const ETIQUETAS = ref(`${RUTA_PARAMETROS}/get/parameters/1/schema`);
const VERSION = ref(`${RUTA_PARAMETROS}/get/parameters/2/schema`);

const UUID = '00000000-0000-4000-8000-000000000001';
const CLIENTE = { nombre: 'Ana', fechaNacimiento: '1990-05-17' };

// Un contrato armado en la prueba, con un solo esquema en components (X).
const conEsquema = (esquema: object, raiz: object = {}): Contrato => ({
  openapi: '3.1.0',
  info: { title: 'Contrato armado en la prueba', version: '0.0.0' },
  ...raiz,
  components: { schemas: { X: esquema } },
});
const compilarX = (esquema: object, raiz?: object) =>
  crearCompilador(conEsquema(esquema, raiz))({ schema: ref('/components/schemas/X'), httpPart: 'body', method: 'POST', url: '/x' });

describe('cargarContrato', () => {
  let carpeta: string;
  const archivo = (nombre: string, texto: string) => {
    const ruta = join(carpeta, nombre);
    writeFileSync(ruta, texto);
    return ruta;
  };

  beforeAll(() => {
    carpeta = mkdtempSync(join(tmpdir(), 'm2-contrato-'));
  });
  afterAll(() => rmSync(carpeta, { recursive: true, force: true }));

  it('sin argumentos, lee contrato/openapi.yml del repositorio, con ruta absoluta', () => {
    expect(isAbsolute(RUTA_CONTRATO)).toBe(true);
    expect(RUTA_CONTRATO.endsWith(join('contrato', 'openapi.yml'))).toBe(true);
    expect(cargarContrato()).toEqual(cargarContrato(RUTA_CONTRATO));
  });

  it('carga y compila el contrato de main, aunque solo tenga info, y es OpenAPI 3.1', () => {
    const principal = cargarContrato();
    // Lo mismo que hace Ajv antes de resolver el primer $ref al contrato: compilar el documento entero como esquema.
    const validar = crearCompilador(principal)({ schema: { $ref: ID_CONTRATO }, httpPart: 'body', method: 'GET', url: '/' });

    expect(principal.openapi).toMatch(/^3\.1\./);
    expect(principal.info).toBeTypeOf('object');
    expect(validar({})).toBe(true);
  });

  it('carga el contrato de prueba con sus rutas', () => {
    expect(Object.keys(contrato.paths as object)).toContain('/pruebas/clientes/{clienteId}/direcciones/{direccionId}');
  });

  it('las fechas del YAML quedan como texto (YAML 1.2), como las espera format: date', () => {
    const ruta = archivo('fecha.yml', 'openapi: 3.1.0\nfecha: 2026-10-18\n');

    expect(cargarContrato(ruta).fecha).toBe('2026-10-18');
  });

  it.each([
    ['no existe', null, /ENOENT/],
    ['no es YAML válido', 'openapi: [3.1.0\n', /Flow sequence|end with a \]/],
    ['tiene una clave repetida', 'openapi: 3.1.0\nopenapi: 3.1.1\n', /unique|Map keys/],
    ['tiene un aviso de YAML (etiqueta sin resolver)', 'openapi: !version 3.1.0\n', /Unresolved tag/],
    ['está vacío', '', /no es un objeto/],
    ['es una lista', '- openapi\n- info\n', /no es un objeto/],
    ['es un texto', 'openapi\n', /no es un objeto/],
  ])('falla si el archivo %s, y el error nombra el archivo', (_caso, texto, motivo) => {
    const ruta = texto === null ? join(carpeta, 'no-existe.yml') : archivo(`caso-${Math.random()}.yml`, texto);

    expect(() => cargarContrato(ruta)).toThrow(`No se pudo leer el contrato ${ruta}: `);
    expect(() => cargarContrato(ruta)).toThrow(motivo);
  });
});

describe('crearCompilador: $ref al contrato (RNF-03.2)', () => {
  it('compila un esquema de components por $ref y valida con él', () => {
    const validar = validador('body', CLIENTE_NUEVO);

    expect(validar(CLIENTE)).toBe(true);
    expect(validar({ fechaNacimiento: '1990-05-17' })).toBe(false);
    expect(validar.errors?.[0]).toMatchObject({ keyword: 'required', params: { missingProperty: 'nombre' } });
  });

  it('resuelve los $ref internos del contrato (#/components/…)', () => {
    const validar = validador('body', CLIENTE_NUEVO);

    expect(validar({ ...CLIENTE, direccion: { calle: 'San Martín 100' } })).toBe(true);
    expect(validar({ ...CLIENTE, direccion: {} })).toBe(false);
    expect(validar.errors?.[0]).toMatchObject({ keyword: 'required', instancePath: '/direccion' });
  });

  it('compila un esquema definido dentro de paths, con el JSON Pointer escapado', () => {
    const validar = validador('params', DIRECCION_ID);

    expect(validar(UUID)).toBe(true);
    expect(validar('no-es-un-uuid')).toBe(false);
  });

  it('compila un objeto con un $ref por propiedad, como lo arma registrarOperaciones', () => {
    const validar = validador('params', {
      type: 'object',
      properties: { clienteId: CLIENTE_ID, direccionId: DIRECCION_ID },
      required: ['clienteId', 'direccionId'],
    });

    expect(validar({ clienteId: UUID, direccionId: UUID })).toBe(true);
    expect(validar({ clienteId: UUID, direccionId: 'abc' })).toBe(false);
    expect(validar.errors?.[0]).toMatchObject({ keyword: 'format', instancePath: '/direccionId' });
  });

  it('falla al compilar un $ref a algo que no existe', () => {
    expect(() => validador('body', ref('/components/schemas/NoExiste'))).toThrow(/can't resolve reference/);
  });

  it('falla al compilar un $ref dentro de paths sin escapar', () => {
    const sinEscapar = ref('/paths//pruebas/clientes/{clienteId}/direcciones/{direccionId}/parameters/2/schema');

    expect(() => validador('params', sinEscapar)).toThrow();
  });

  it('compila cada esquema de components del contrato de prueba y del de main', () => {
    for (const fuente of [contrato, cargarContrato()]) {
      const esquemas = (fuente.components as { schemas?: object } | undefined)?.schemas ?? {};
      const compilarDe = crearCompilador(fuente);
      for (const nombre of Object.keys(esquemas)) {
        expect(() =>
          compilarDe({ schema: ref(`/components/schemas/${nombre}`), httpPart: 'body', method: 'POST', url: '/x' }),
        ).not.toThrow();
      }
    }
  });
});

describe('crearCompilador: formatos (RNF-03.2)', () => {
  it('rechaza un uuid inválido', () => {
    const validar = validador('params', CLIENTE_ID);

    expect(validar(UUID)).toBe(true);
    expect(validar('no-es-un-uuid')).toBe(false);
    expect(validar.errors?.[0]).toMatchObject({ keyword: 'format', params: { format: 'uuid' } });
  });

  it.each(['2026-02-30', '2026-13-01', '18/10/2026', '2026-10-18T10:00:00Z'])('rechaza la fecha inválida %s', (fecha) => {
    const validar = validador('body', CLIENTE_NUEVO);

    expect(validar({ ...CLIENTE, fechaNacimiento: fecha })).toBe(false);
    expect(validar.errors?.[0]).toMatchObject({ keyword: 'format', params: { format: 'date' } });
  });

  it('acepta una fecha válida, también el 29 de febrero de un año bisiesto', () => {
    const validar = validador('body', CLIENTE_NUEVO);

    expect(validar({ ...CLIENTE, fechaNacimiento: '2024-02-29' })).toBe(true);
  });

  it('rechaza una fecha y hora inválida', () => {
    const validar = compilarX({ type: 'string', format: 'date-time' });

    expect(validar('2026-10-18T10:00:00Z')).toBe(true);
    expect(validar('2026-10-18T25:00:00Z')).toBe(false);
  });

  it.each([
    ['uuid', 'string'],
    ['date', 'string'],
    ['date-time', 'string'],
    ['uri-reference', 'string'],
    ['int32', 'integer'],
    ['int64', 'integer'],
    ['float', 'number'],
    ['double', 'number'],
    ['byte', 'string'],
    ['binary', 'string'],
    ['password', 'string'],
  ])('conoce el formato %s (del borrador del contrato v1 o de OpenAPI)', (formato, tipo) => {
    expect(() => compilarX({ type: tipo, format: formato })).not.toThrow();
  });

  it('falla al compilar un formato desconocido', () => {
    expect(() => compilarX({ type: 'string', format: 'desconocido' })).toThrow(/unknown format "desconocido"/);
  });
});

describe('crearCompilador: conversión de tipos (RNF-03.2)', () => {
  const numerico = { type: 'object', properties: { n: { type: 'integer' }, b: { type: 'boolean' } } };

  it.each(['params', 'querystring', 'headers'])('en %s convierte el texto al tipo del esquema', (parte) => {
    const datos = { n: '5', b: 'true' };

    expect(validador(parte, numerico)(datos)).toBe(true);
    expect(datos).toEqual({ n: 5, b: true });
  });

  it('en el cuerpo no convierte: un texto no es un número', () => {
    const datos = { n: '5', b: 'true' };

    expect(validador('body', numerico)(datos)).toBe(false);
    expect(datos).toEqual({ n: '5', b: 'true' });
  });

  it.each([undefined, 'otra'])('sin una parte conocida (%s), no convierte', (parte) => {
    expect(validador(parte, numerico)({ n: '5' })).toBe(false);
  });

  it('convierte a través de un $ref al contrato, en la query string y en los encabezados', () => {
    const query = { pagina: '3' };
    const encabezados = { 'x-version': '2', host: 'localhost' };

    expect(validador('querystring', { type: 'object', properties: { pagina: PAGINA } })(query)).toBe(true);
    expect(validador('headers', { type: 'object', properties: { 'x-version': VERSION } })(encabezados)).toBe(true);
    expect(query).toEqual({ pagina: 3 });
    expect(encabezados).toEqual({ 'x-version': 2, host: 'localhost' });
  });

  it('en la query string, un solo valor pasa a lista si el esquema pide una lista', () => {
    const query = { etiquetas: 'a' };

    expect(validador('querystring', { type: 'object', properties: { etiquetas: ETIQUETAS } })(query)).toBe(true);
    expect(query).toEqual({ etiquetas: ['a'] });
  });

  it('las dos instancias no se mezclan: compilar primero para la query string no hace convertir al cuerpo', () => {
    validador('querystring', numerico);

    expect(validador('body', numerico)({ n: '5' })).toBe(false);
  });
});

describe('crearCompilador: palabras de OpenAPI (RNF-03.2)', () => {
  it('acepta example en un esquema del contrato', () => {
    expect(() => validador('body', CLIENTE_NUEVO)).not.toThrow();
  });

  it.each([
    ['example', { type: 'string', example: 'Ana' }],
    ['discriminator', { type: 'object', properties: { tipo: { type: 'string' } }, discriminator: { propertyName: 'tipo' } }],
    ['xml', { type: 'object', xml: { name: 'cliente' } }],
    ['externalDocs', { type: 'string', externalDocs: { url: 'https://ejemplo.test/docs' } }],
  ])('acepta %s dentro de un esquema', (_palabra, esquema) => {
    expect(() => compilarX(esquema)).not.toThrow();
  });

  it('acepta todos los campos de primer nivel de un documento OpenAPI 3.1', () => {
    const raiz = {
      jsonSchemaDialect: 'https://spec.openapis.org/oas/3.1/dialect/base',
      servers: [{ url: '/' }],
      paths: {},
      webhooks: {},
      security: [{ bearerAuth: [] }],
      tags: [{ name: 'Pruebas' }],
      externalDocs: { url: 'https://ejemplo.test/docs' },
    };

    expect(compilarX({ type: 'string' }, raiz)('texto')).toBe(true);
  });

  it('sigue en modo estricto: una palabra que no es de JSON Schema ni de OpenAPI hace fallar la compilación', () => {
    expect(() => compilarX({ type: 'string', minLenght: 1 })).toThrow(/unknown keyword: "minLenght"/);
  });
});

describe('crearCompilador: opciones de Ajv (RNF-03.2)', () => {
  it('completa los valores por defecto, en la query string y en el cuerpo', () => {
    const conDefault = { type: 'object', properties: { pagina: { type: 'integer', default: 1 } } };
    const query = {};
    const cuerpo = {};

    expect(validador('querystring', conDefault)(query)).toBe(true);
    expect(validador('body', conDefault)(cuerpo)).toBe(true);
    expect(query).toEqual({ pagina: 1 });
    expect(cuerpo).toEqual({ pagina: 1 });
  });

  it('completa un valor por defecto escrito al lado de un $ref (el que queda detrás del $ref no se aplica)', () => {
    const query = {};
    const validar = validador('querystring', { type: 'object', properties: { pagina: { ...PAGINA, default: 1 } } });

    expect(validar(query)).toBe(true);
    expect(query).toEqual({ pagina: 1 });
  });

  it('informa un solo error aunque haya varios (allErrors: false)', () => {
    const validar = validador('body', CLIENTE_NUEVO);

    expect(validar({ nombre: '', fechaNacimiento: 'ayer', extra: 1 })).toBe(false);
    expect(validar.errors).toHaveLength(1);
  });

  it('rechaza un campo de más, en vez de borrarlo', () => {
    const datos = { ...CLIENTE, extra: 1 };

    expect(validador('body', CLIENTE_NUEVO)(datos)).toBe(false);
    expect(datos).toEqual({ ...CLIENTE, extra: 1 });
  });

  it('no escribe avisos en la consola, que solo lleva logs en JSON (RNF-14.5)', () => {
    const consola = (['log', 'warn', 'error'] as const).map((nivel) => vi.spyOn(console, nivel).mockImplementation(() => {}));
    try {
      // Sin type: object, el modo estricto de Ajv avisa que a properties le falta el tipo.
      compilarX({ properties: { nombre: { type: 'string' } } });

      for (const espia of consola) expect(espia).not.toHaveBeenCalled();
    } finally {
      for (const espia of consola) espia.mockRestore();
    }
  });

  it('el error que deja es el que entiende aProblema', () => {
    const validar = validador('body', CLIENTE_NUEVO);
    validar({ fechaNacimiento: '1990-05-17' });
    const error = Object.assign(new Error('body must have required property nombre'), {
      validation: validar.errors,
      validationContext: 'body',
    });

    expect(aProblema(error, '/pruebas/clientes').cuerpo.detail).toBe('Falta el campo nombre en el cuerpo');
  });
});
