import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { aPreferencias, preferenciasPredeterminadas, TIPOS_VEHICULO, CANALES, ACCESIBILIDAD } from '../../src/preferencias/modelo.js';

describe('modelo de preferencias (006/T2)', () => {
  it('cada predeterminado tiene listas nuevas e independientes', () => {
    const uno = preferenciasPredeterminadas();
    uno.tiposVehiculo.push('AUTO'); uno.canales.push('SMS'); uno.accesibilidad.push('SILLA_DE_RUEDAS');
    expect(preferenciasPredeterminadas()).toEqual({ tiposVehiculo: [], canales: [], accesibilidad: [] });
  });
  it.each([null, '', 'Observación ficticia'])('mapea observaciones %j y copia los arreglos de pg', (observaciones) => {
    const fila = { tipos_vehiculo: ['AUTO' as const], canales: ['PUSH' as const], accesibilidad: [], observaciones_accesibilidad: observaciones };
    const datos = aPreferencias(fila);
    expect(datos).toEqual({ tiposVehiculo: ['AUTO'], canales: ['PUSH'], accesibilidad: [], ...(observaciones === null ? {} : { observacionesAccesibilidad: observaciones }) });
    expect(datos.tiposVehiculo).not.toBe(fila.tipos_vehiculo);
    expect(datos.canales).not.toBe(fila.canales);
    expect(datos.accesibilidad).not.toBe(fila.accesibilidad);
  });
  it('mantiene los enumerados sincronizados con OpenAPI', () => {
    const contrato = parse(readFileSync(new URL('../../contrato/openapi.yml', import.meta.url), 'utf8')) as { components: { schemas: Record<string, { enum: string[] }> } };
    expect(TIPOS_VEHICULO).toEqual(contrato.components.schemas.TipoVehiculo?.enum);
    expect(CANALES).toEqual(contrato.components.schemas.CanalComunicacion?.enum);
    expect(ACCESIBILIDAD).toEqual(contrato.components.schemas.NecesidadAccesibilidad?.enum);
  });
});
