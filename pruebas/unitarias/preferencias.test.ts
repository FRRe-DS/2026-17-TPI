import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import type { Identidad } from '../../src/auth/tokens.js';
import type { BaseDeDatos } from '../../src/bd/pool.js';
import { SinPermiso } from '../../src/errores.js';
import * as servicio from '../../src/preferencias/servicio.js';
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

describe('rol efectivo y propiedad de preferencias (006/T4)', () => {
  const propio = '6f1c1d1e-3b0a-4f55-9a6b-0d7a8f4c2e11';
  const ajeno = '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d';
  class TocoLaBase extends Error {}
  const pool: BaseDeDatos = { tiempoBdMs: 2000, consultar: async () => { throw new TocoLaBase(); }, connect: async () => { throw new TocoLaBase(); } };
  const casos: { roles: Identidad['roles']; otro: boolean; leer: boolean; guardar: boolean }[] = [
    { roles: ['CLIENTE'], otro: false, leer: true, guardar: true },
    { roles: ['CLIENTE'], otro: true, leer: false, guardar: false },
    { roles: ['CLIENTE', 'OPERADOR'], otro: true, leer: true, guardar: false },
    { roles: ['CLIENTE', 'OPERADOR'], otro: false, leer: true, guardar: true },
    { roles: ['OPERADOR'], otro: true, leer: true, guardar: false },
    { roles: ['SERVICIO'], otro: false, leer: false, guardar: false },
    { roles: ['CONDUCTOR'], otro: false, leer: false, guardar: false },
    { roles: ['CLIENTE', 'SERVICIO'], otro: true, leer: false, guardar: false },
    { roles: ['CLIENTE', 'CLIENTE'], otro: true, leer: false, guardar: false },
  ];
  it.each(casos)('roles=$roles, ajeno=$otro: permisos antes de tocar la base', async ({ roles, otro, leer, guardar }) => {
    const identidad: Identidad = { sub: propio.toUpperCase(), roles };
    const id = otro ? ajeno : `urn:uuid:${propio.toUpperCase()}`;
    await expect(servicio.obtenerPreferencias(pool, identidad, ['CLIENTE', 'OPERADOR'], id)).rejects.toBeInstanceOf(leer ? TocoLaBase : SinPermiso);
    await expect(servicio.guardarPreferencias(pool, identidad, ['CLIENTE'], id, preferenciasPredeterminadas())).rejects.toBeInstanceOf(guardar ? TocoLaBase : SinPermiso);
  });
});
