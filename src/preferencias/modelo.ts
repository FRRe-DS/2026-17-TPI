import type { components } from '../generado/contrato.js';

export type Preferencias = components['schemas']['Preferencias'];
export const TIPOS_VEHICULO = ['AUTO', 'MOTO'] as const satisfies readonly components['schemas']['TipoVehiculo'][];
export const CANALES = ['EMAIL', 'SMS', 'PUSH'] as const satisfies readonly components['schemas']['CanalComunicacion'][];
export const ACCESIBILIDAD = ['SILLA_DE_RUEDAS', 'ASISTENCIA_VISUAL', 'ASISTENCIA_AUDITIVA', 'ANIMAL_DE_ASISTENCIA'] as const satisfies readonly components['schemas']['NecesidadAccesibilidad'][];

export type FilaPreferencias = {
  tipos_vehiculo: Preferencias['tiposVehiculo'];
  canales: Preferencias['canales'];
  accesibilidad: Preferencias['accesibilidad'];
  observaciones_accesibilidad: string | null;
};

// Cada GET sin fila recibe listas nuevas, sin efectos en la base (RF-2.3.2).
export function preferenciasPredeterminadas(): Preferencias {
  return { tiposVehiculo: [], canales: [], accesibilidad: [] };
}

export function aPreferencias(fila: FilaPreferencias): Preferencias {
  return {
    tiposVehiculo: [...fila.tipos_vehiculo],
    canales: [...fila.canales],
    accesibilidad: [...fila.accesibilidad],
    ...(fila.observaciones_accesibilidad === null ? {} : { observacionesAccesibilidad: fila.observaciones_accesibilidad }),
  };
}
