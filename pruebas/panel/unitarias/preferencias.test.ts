import { describe, expect, it } from 'vitest';
import { cargarContrato } from '../../../src/contrato/cargar.js';
import {
  alternarOpcion,
  CANALES,
  camposDePreferencias,
  cuerpoDePreferencias,
  LARGO_MAXIMO_OBSERVACIONES,
  NECESIDADES_DE_ACCESIBILIDAD,
  TIPOS_DE_VEHICULO,
  validarPreferencias,
  type CamposPreferencias,
} from '../../../panel/cliente/src/logica/preferencias.js';

// Las preferencias del cliente (T24, RF-2.3.6): solo se ofrecen los valores que admite el contrato, y lo que se manda es lo
// que el contrato describe. El recorrido contra M2 real, en `pruebas/panel/integracion/pantalla-preferencias.test.ts`.

const esquemas = (cargarContrato().components as { schemas: Record<string, { enum?: string[]; maxLength?: number }> }).schemas;
const valores = (opciones: { valor: string }[]) => opciones.map((o) => o.valor);
const VACIAS: CamposPreferencias = { tiposVehiculo: [], canales: [], accesibilidad: [], observaciones: '' };

describe('las opciones son exactamente las del contrato (RF-2.3.6)', () => {
  it('tipos de vehículo', () => expect(valores(TIPOS_DE_VEHICULO)).toEqual(esquemas.TipoVehiculo!.enum));
  it('canales de comunicación', () => expect(valores(CANALES)).toEqual(esquemas.CanalComunicacion!.enum));
  it('necesidades de accesibilidad', () => expect(valores(NECESIDADES_DE_ACCESIBILIDAD)).toEqual(esquemas.NecesidadAccesibilidad!.enum));

  it('las observaciones llegan hasta el máximo del contrato', () => {
    const contrato = (cargarContrato().components as { schemas: { Preferencias: { properties: { observacionesAccesibilidad: { maxLength: number } } } } }).schemas;
    expect(LARGO_MAXIMO_OBSERVACIONES).toBe(contrato.Preferencias.properties.observacionesAccesibilidad.maxLength);
    expect(LARGO_MAXIMO_OBSERVACIONES).toBe(255);
  });

  it('cada opción trae un texto para leer, en español', () => {
    for (const { valor, etiqueta } of [...TIPOS_DE_VEHICULO, ...CANALES, ...NECESIDADES_DE_ACCESIBILIDAD]) {
      expect(etiqueta, valor).not.toBe(valor);
      expect(etiqueta.length).toBeGreaterThan(2);
    }
  });
});

describe('camposDePreferencias: lo que trae escrito el formulario', () => {
  it('lo de M2, con las observaciones vacías si no hay', () => {
    expect(camposDePreferencias({ tiposVehiculo: ['AUTO'], canales: ['EMAIL'], accesibilidad: [] })).toEqual({
      tiposVehiculo: ['AUTO'],
      canales: ['EMAIL'],
      accesibilidad: [],
      observaciones: '',
    });
    expect(camposDePreferencias({ tiposVehiculo: [], canales: [], accesibilidad: ['SILLA_DE_RUEDAS'], observacionesAccesibilidad: 'Rampa' }).observaciones).toBe('Rampa');
  });
});

describe('alternarOpcion: marcar y desmarcar', () => {
  it('marcar agrega y desmarcar saca, sin repetir', () => {
    expect(alternarOpcion(TIPOS_DE_VEHICULO, [], 'AUTO', true)).toEqual(['AUTO']);
    expect(alternarOpcion(TIPOS_DE_VEHICULO, ['AUTO'], 'AUTO', true)).toEqual(['AUTO']);
    expect(alternarOpcion(TIPOS_DE_VEHICULO, ['AUTO'], 'AUTO', false)).toEqual([]);
    expect(alternarOpcion(TIPOS_DE_VEHICULO, [], 'AUTO', false)).toEqual([]);
  });

  it('queda siempre en el orden del contrato, sin importar en qué orden se marcó', () => {
    const primero = alternarOpcion(CANALES, alternarOpcion(CANALES, [], 'PUSH', true), 'EMAIL', true);

    expect(primero).toEqual(['EMAIL', 'PUSH']);
  });

  it('un valor que no es del contrato no entra', () => {
    expect(alternarOpcion(CANALES, ['EMAIL'], 'TELEGRAMA', true)).toEqual(['EMAIL']);
  });
});

describe('cuerpoDePreferencias: lo que se manda a guardarPreferencias', () => {
  it('las tres listas, aunque estén vacías, y las observaciones solo si se escribieron', () => {
    expect(cuerpoDePreferencias(VACIAS)).toEqual({ tiposVehiculo: [], canales: [], accesibilidad: [] });
    expect(cuerpoDePreferencias({ ...VACIAS, accesibilidad: ['SILLA_DE_RUEDAS'], observaciones: '  Necesito rampa ' })).toEqual({
      tiposVehiculo: [],
      canales: [],
      accesibilidad: ['SILLA_DE_RUEDAS'],
      observacionesAccesibilidad: 'Necesito rampa',
    });
    expect(cuerpoDePreferencias({ ...VACIAS, observaciones: '    ' })).not.toHaveProperty('observacionesAccesibilidad');
  });

  it('no comparte las listas con lo escrito', () => {
    const campos = { ...VACIAS, canales: ['EMAIL'] };

    expect(cuerpoDePreferencias(campos).canales).not.toBe(campos.canales);
  });
});

describe('validarPreferencias', () => {
  it('lo vacío es válido: «cualquiera» y «ninguno» son valores', () => {
    expect(validarPreferencias(VACIAS)).toEqual({});
  });

  it('las observaciones llegan hasta 255 caracteres', () => {
    expect(validarPreferencias({ ...VACIAS, observaciones: 'o'.repeat(255) })).toEqual({});
    expect(validarPreferencias({ ...VACIAS, observaciones: 'o'.repeat(256) })).toEqual({ observaciones: 'Hasta 255 caracteres.' });
  });

  it('los espacios de los extremos no cuentan', () => {
    expect(validarPreferencias({ ...VACIAS, observaciones: ` ${'o'.repeat(255)} ` })).toEqual({});
  });
});
