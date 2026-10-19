import _Ajv2020, { type AnySchema } from 'ajv/dist/2020.js';
import _addFormats from 'ajv-formats';
import type { FastifySchemaCompiler } from 'fastify';
import type { Contrato } from './cargar.js';

// Con module nodenext, los dos paquetes llegan como CommonJS: la clase y la función están en .default.
const Ajv2020 = _Ajv2020.default;
const addFormats = _addFormats.default;

// Los esquemas de las rutas apuntan al contrato con $ref: 'contrato#/components/…' o 'contrato#/paths/…'.
export const ID_CONTRATO = 'contrato';

// Palabras de OpenAPI 3.1 que no son JSON Schema, para que el modo estricto no las rechace: las de un Schema Object y los
// campos de primer nivel del documento, porque Ajv compila el documento entero antes de resolver un $ref hacia adentro.
const PALABRAS_DE_OPENAPI = [
  ...['example', 'discriminator', 'xml', 'externalDocs'],
  ...['openapi', 'info', 'jsonSchemaDialect', 'servers', 'paths', 'webhooks', 'components', 'security', 'tags'],
];

// La ruta, la query string y los encabezados llegan como texto: se convierten al tipo del esquema. El cuerpo, no.
const PARTES_DE_TEXTO = new Set(['params', 'querystring', 'headers']);

// logger: false para que Ajv no escriba avisos sueltos en la consola (RNF-14.5). Lo que el modo estricto rechaza, como
// una palabra o un formato desconocido, igual hace fallar la compilación.
function crearAjv(contrato: Contrato, convertirTipos: boolean) {
  const ajv = new Ajv2020({
    coerceTypes: convertirTipos ? 'array' : false,
    useDefaults: true,
    allErrors: false,
    logger: false,
  });
  addFormats(ajv);
  ajv.addVocabulary(PALABRAS_DE_OPENAPI);
  ajv.addSchema(contrato, ID_CONTRATO);
  return ajv;
}

// El compilador de Fastify (app.setValidatorCompiler): elige la instancia según la parte de la solicitud que se valida.
export function crearCompilador(contrato: Contrato): FastifySchemaCompiler<unknown> {
  const sinConversion = crearAjv(contrato, false);
  const conConversion = crearAjv(contrato, true);
  return ({ schema, httpPart }) =>
    (PARTES_DE_TEXTO.has(httpPart ?? '') ? conConversion : sinConversion).compile(schema as AnySchema);
}
