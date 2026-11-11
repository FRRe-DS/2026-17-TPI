import _Ajv2020 from 'ajv/dist/2020.js';
import _addFormats from 'ajv-formats';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cargarContrato } from '../../src/contrato/cargar.js';
import { errorDeM6, paginaDeM6, resumenDeM6, viajeDeM6 } from '../ayudas/m6-simulado.js';

// El M6 simulado de las pruebas cumple `contrato/dependencias/m6.yml` (spec 008, criterios de finalización): lo que arma
// `pruebas/ayudas/m6-simulado.ts` se valida contra los esquemas del contrato de M6, con Ajv como el resto del servicio.

// Con module nodenext, los dos paquetes llegan como CommonJS: la clase y la función están en .default.
const Ajv2020 = _Ajv2020.default;
const addFormats = _addFormats.default;

const RUTA_M6 = fileURLToPath(new URL('../../contrato/dependencias/m6.yml', import.meta.url));
const ID = 'm6';

// strict: false porque el documento trae palabras de OpenAPI (`example`, `paths`…) que no son JSON Schema.
const ajv = new Ajv2020({ strict: false, allErrors: true, logger: false });
addFormats(ajv);
ajv.addSchema(cargarContrato(RUTA_M6), ID);

const esquema = (nombre: string) => {
  const validar = ajv.getSchema(`${ID}#/components/schemas/${nombre}`);
  if (validar === undefined) throw new Error(`m6.yml no tiene el esquema ${nombre}`);
  return validar;
};
const errores = (nombre: string, cuerpo: unknown) => {
  const validar = esquema(nombre);
  return validar(JSON.parse(JSON.stringify(cuerpo)) as unknown) ? [] : (validar.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
};

const CLIENTE = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const CONDUCTOR = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
const VIAJE = '5c4b3a29-1807-4f6e-9d5c-4b3a29180765';

describe('el M6 simulado cumple contrato/dependencias/m6.yml', () => {
  it('el validador distingue: un viaje con el estado mal formado no cumple Trip', () => {
    expect(errores('Trip', viajeDeM6(VIAJE, CLIENTE, CONDUCTOR, { state: 7 }))).not.toEqual([]);
    expect(errores('Trip', viajeDeM6(VIAJE, CLIENTE, CONDUCTOR, { driverId: 'conductor-7' }))).not.toEqual([]);
    expect(errores('Problem', { code: 'VALIDATION', message: 'sin el resto' })).not.toEqual([]);
    expect(errores('Problem', errorDeM6(404, 'con un code que no está en la lista', { code: 'NOT_FOUND' }))).not.toEqual([]);
  });

  // Desde la versión `35b3c4d` (ADR 096) el contrato exige `driverId` y no tiene `CANCELLED_BY_*`. M2 igual acepta un viaje
  // así (RF-2.4.1, RF-2.5): eso lo cubren sus pruebas, que lo arman a propósito fuera del contrato.
  it('lo que el contrato ya no admite no cumple: sin conductor o con un estado de la versión anterior', () => {
    expect(errores('Trip', viajeDeM6(VIAJE, CLIENTE, CONDUCTOR, { driverId: undefined }))).not.toEqual([]);
    expect(errores('Trip', viajeDeM6(VIAJE, CLIENTE, CONDUCTOR, { state: 'CANCELLED_BY_CLIENT' }))).not.toEqual([]);
    expect(errores('TripSummary', resumenDeM6(1, CLIENTE, CONDUCTOR, { driverId: undefined }))).not.toEqual([]);
  });

  it('GET /trips/{tripId}: el viaje completado, en curso y cancelado cumple Trip', () => {
    expect(errores('Trip', viajeDeM6(VIAJE, CLIENTE, CONDUCTOR))).toEqual([]);
    expect(errores('Trip', viajeDeM6(VIAJE, CLIENTE, CONDUCTOR, { state: 'IN_PROGRESS', distanceKm: null, durationMinutes: null }))).toEqual([]);
    expect(errores('Trip', viajeDeM6(VIAJE, CLIENTE, CONDUCTOR, { state: 'CANCELLED', distanceKm: null, durationMinutes: null }))).toEqual([]);
  });

  it('GET /trips: la página con sus viajes cumple TripSummaryPage', () => {
    const items = [resumenDeM6(1, CLIENTE, CONDUCTOR), resumenDeM6(2, CLIENTE, CONDUCTOR, { state: 'CANCELLED', distanceKm: null, durationMinutes: null })];
    expect(errores('TripSummaryPage', paginaDeM6(items, 42))).toEqual([]);
    expect(errores('TripSummaryPage', paginaDeM6([], 0))).toEqual([]);
  });

  it.each([400, 401, 403, 404, 409, 422, 429])('un %i de M6 cumple Problem', (estado) => {
    expect(errores('Problem', errorDeM6(estado))).toEqual([]);
    expect(errores('Problem', errorDeM6(estado, 'otro mensaje', { correlationId: 'id-de-correlacion' }))).toEqual([]);
  });
});
