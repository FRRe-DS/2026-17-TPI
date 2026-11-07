import _Ajv2020 from 'ajv/dist/2020.js';
import _addFormats from 'ajv-formats';
import { cargarContrato } from '../../../src/contrato/cargar.js';

// Valida un cuerpo contra un esquema de contrato/openapi.yml (components/schemas/<nombre>), con las mismas palabras de OpenAPI
// que acepta src/contrato/validacion.ts. Devuelve los errores como texto; vacío si el cuerpo cumple el contrato.
const Ajv2020 = _Ajv2020.default;
const addFormats = _addFormats.default;
const ID = 'contrato';
const PALABRAS_DE_OPENAPI = [
  ...['example', 'discriminator', 'xml', 'externalDocs'],
  ...['openapi', 'info', 'jsonSchemaDialect', 'servers', 'paths', 'webhooks', 'components', 'security', 'tags'],
];

let ajv: InstanceType<typeof Ajv2020> | undefined;

function instancia() {
  if (ajv === undefined) {
    ajv = new Ajv2020({ allErrors: true, logger: false });
    addFormats(ajv);
    ajv.addVocabulary(PALABRAS_DE_OPENAPI);
    ajv.addSchema(cargarContrato(), ID);
  }
  return ajv;
}

export function validarContraContrato(esquema: string, cuerpo: unknown): string[] {
  const validar = instancia().getSchema(`${ID}#/components/schemas/${esquema}`);
  if (validar === undefined) throw new Error(`El contrato no tiene el esquema «${esquema}».`);
  if (validar(cuerpo)) return [];
  return (validar.errors ?? []).map((e) => `${e.instancePath === '' ? '(cuerpo)' : e.instancePath} ${e.message ?? 'no cumple'}`);
}
