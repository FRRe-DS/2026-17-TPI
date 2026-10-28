import _Ajv2020 from 'ajv/dist/2020.js';
import _addFormats from 'ajv-formats';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { tokenDeServicio } from '../../../src/auth/tokens.js';
import { cargarContrato } from '../../../src/contrato/cargar.js';
import { errorM6, pagina, resumen } from '../../../panel/m6-simulado/cuerpos.js';
import { CLIENTE, CONFIG_M6, crearM6, viaje } from '../ayudas/m6.js';

// Lo que responde el M6 simulado cumple `contrato/dependencias/m6.yml`, como el M6 de las pruebas de M2
// (pruebas/unitarias/m6-simulado.test.ts): se valida con Ajv contra los esquemas del contrato del Grupo 12 (RNF-13.7).
const Ajv2020 = _Ajv2020.default;
const addFormats = _addFormats.default;

const ajv = new Ajv2020({ strict: false, allErrors: true, logger: false });
addFormats(ajv);
ajv.addSchema(cargarContrato(fileURLToPath(new URL('../../../contrato/dependencias/m6.yml', import.meta.url))), 'm6');

const errores = (nombre: string, cuerpo: unknown) => {
  const validar = ajv.getSchema(`m6#/components/schemas/${nombre}`);
  if (validar === undefined) throw new Error(`m6.yml no tiene el esquema ${nombre}`);
  return validar(JSON.parse(JSON.stringify(cuerpo)) as unknown) ? [] : (validar.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
};

const COMPLETADO = '11111111-1111-4111-8111-111111111111';
const EN_CURSO = '22222222-2222-4222-8222-222222222222';
const DE_M2 = { 'x-request-id': 'pedido-de-m2' };

const abiertas: ReturnType<typeof crearM6>['app'][] = [];
function m6(viajes: Parameters<typeof crearM6>[0] = []) {
  const creado = crearM6(viajes);
  abiertas.push(creado.app);
  return creado.app;
}
afterEach(async () => {
  await Promise.all(abiertas.splice(0).map((app) => app.close()));
});

const comoM2 = async () => ({ authorization: `Bearer ${await tokenDeServicio(CONFIG_M6)}`, ...DE_M2 });

describe('los cuerpos del M6 simulado cumplen m6.yml (RNF-13.7)', () => {
  it('el validador distingue: un cuerpo roto no cumple', () => {
    expect(errores('Trip', { ...viaje(COMPLETADO), state: 'TERMINADO' })).not.toEqual([]);
    expect(errores('TripSummaryPage', { items: [] })).not.toEqual([]);
    expect(errores('ErrorResponse', { code: 'X', message: 'sin timestamp' })).not.toEqual([]);
  });

  it('los armadores dan cuerpos válidos', () => {
    expect(errores('Trip', viaje(COMPLETADO))).toEqual([]);
    expect(errores('Trip', viaje(EN_CURSO, { state: 'IN_PROGRESS', distanceKm: null, durationMinutes: null }))).toEqual([]);
    expect(errores('TripSummary', resumen(viaje(COMPLETADO)))).toEqual([]);
    expect(errores('TripSummaryPage', pagina([resumen(viaje(COMPLETADO))], 1, 20, 1))).toEqual([]);
    expect(errores('ErrorResponse', errorM6('NOT_FOUND', 'No existe'))).toEqual([]);
    expect(errores('ErrorResponse', errorM6('NOT_FOUND', 'No existe', 'id-1'))).toEqual([]);
  });

  it('un resumen no lleva coordenadas (RF-4.7)', () => {
    expect(Object.keys(resumen(viaje(COMPLETADO))).filter((clave) => /Latitude|Longitude/.test(clave))).toEqual([]);
  });

  it('GET /api/v1/trips responde una TripSummaryPage válida', async () => {
    const respuesta = await m6([viaje(COMPLETADO), viaje(EN_CURSO, { state: 'IN_PROGRESS', driverId: undefined })]).inject({
      method: 'GET',
      url: `/api/v1/trips?clientId=${CLIENTE}`,
      headers: await comoM2(),
    });

    expect(respuesta.statusCode).toBe(200);
    expect(errores('TripSummaryPage', respuesta.json())).toEqual([]);
    expect(respuesta.json<{ items: unknown[] }>().items).toHaveLength(2);
  });

  it('GET /api/v1/trips/{id} responde un Trip válido', async () => {
    const respuesta = await m6([viaje(COMPLETADO)]).inject({ method: 'GET', url: `/api/v1/trips/${COMPLETADO}`, headers: await comoM2() });

    expect(respuesta.statusCode).toBe(200);
    expect(errores('Trip', respuesta.json())).toEqual([]);
    expect(respuesta.json()).toEqual(viaje(COMPLETADO));
  });

  it.each([
    ['401', async () => ({ ...DE_M2 }), `/api/v1/trips/${COMPLETADO}`],
    ['404', comoM2, '/api/v1/trips/44444444-4444-4444-8444-444444444444'],
    ['400', comoM2, '/api/v1/trips'],
  ] as const)('un %s responde un ErrorResponse válido, con el id de correlación', async (codigo, encabezados, url) => {
    const respuesta = await m6([viaje(COMPLETADO)]).inject({ method: 'GET', url, headers: await encabezados() });

    expect(String(respuesta.statusCode)).toBe(codigo);
    expect(respuesta.headers['content-type']).toMatch(/^application\/json/);
    expect(errores('ErrorResponse', respuesta.json())).toEqual([]);
    expect(respuesta.json()).toMatchObject({ correlationId: 'pedido-de-m2' });
  });
});
