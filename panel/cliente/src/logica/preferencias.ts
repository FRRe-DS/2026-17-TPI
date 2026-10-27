import type { components } from '../generado/contrato.js';

// Las preferencias del cliente tal como se escriben en el formulario (RF-2.3.6), sin React: solo los valores que admite el contrato,
// y el cuerpo de `guardarPreferencias`. Un `PUT` reemplaza todo, así que siempre se mandan las tres listas completas.

type Esquemas = components['schemas'];
export type Preferencias = Esquemas['Preferencias'];

export type Opcion<V extends string = string> = { valor: V; etiqueta: string };

// Los valores son los de los enumerados del contrato y en su orden; una prueba lo comprueba contra el YAML.
export const TIPOS_DE_VEHICULO: Opcion<Esquemas['TipoVehiculo']>[] = [
  { valor: 'AUTO', etiqueta: 'Auto' },
  { valor: 'MOTO', etiqueta: 'Moto' },
];
export const CANALES: Opcion<Esquemas['CanalComunicacion']>[] = [
  { valor: 'EMAIL', etiqueta: 'Correo electrónico' },
  { valor: 'SMS', etiqueta: 'Mensaje de texto (SMS)' },
  { valor: 'PUSH', etiqueta: 'Notificación en la app' },
];
export const NECESIDADES_DE_ACCESIBILIDAD: Opcion<Esquemas['NecesidadAccesibilidad']>[] = [
  { valor: 'SILLA_DE_RUEDAS', etiqueta: 'Silla de ruedas' },
  { valor: 'ASISTENCIA_VISUAL', etiqueta: 'Asistencia visual' },
  { valor: 'ASISTENCIA_AUDITIVA', etiqueta: 'Asistencia auditiva' },
  { valor: 'ANIMAL_DE_ASISTENCIA', etiqueta: 'Animal de asistencia' },
];

export const LARGO_MAXIMO_OBSERVACIONES = 255;

export type CamposPreferencias = {
  tiposVehiculo: string[];
  canales: string[];
  accesibilidad: string[];
  observaciones: string;
};
export type ErroresDePreferencias = Partial<Record<keyof CamposPreferencias, string>>;

// Lo que trae el formulario al abrir: las preferencias de M2 (vacías si el cliente nunca las guardó).
export const camposDePreferencias = (preferencias: Preferencias): CamposPreferencias => ({
  tiposVehiculo: [...preferencias.tiposVehiculo],
  canales: [...preferencias.canales],
  accesibilidad: [...preferencias.accesibilidad],
  observaciones: preferencias.observacionesAccesibilidad ?? '',
});

// Marca o desmarca un valor. La lista queda siempre en el orden del contrato, sin repetidos, y un valor que no es de `opciones` no entra.
export function alternarOpcion(opciones: Opcion[], actuales: readonly string[], valor: string, marcado: boolean): string[] {
  const seleccionados = new Set(actuales);
  if (marcado) seleccionados.add(valor);
  else seleccionados.delete(valor);
  return opciones.map((opcion) => opcion.valor).filter((conocido) => seleccionados.has(conocido));
}

// Un mensaje por campo con problema; sin problemas, un objeto vacío. Las listas no tienen errores posibles: solo se ofrecen valores
// válidos y vacío significa «cualquiera» o «ninguno».
export function validarPreferencias(campos: CamposPreferencias): ErroresDePreferencias {
  return campos.observaciones.trim().length > LARGO_MAXIMO_OBSERVACIONES ? { observaciones: `Hasta ${LARGO_MAXIMO_OBSERVACIONES} caracteres.` } : {};
}

// El cuerpo de `guardarPreferencias`: las tres listas siempre, y las observaciones solo si se escribieron (si no, M2 las borra).
export function cuerpoDePreferencias(campos: CamposPreferencias): Preferencias {
  const observaciones = campos.observaciones.trim();
  return {
    tiposVehiculo: [...campos.tiposVehiculo] as Preferencias['tiposVehiculo'],
    canales: [...campos.canales] as Preferencias['canales'],
    accesibilidad: [...campos.accesibilidad] as Preferencias['accesibilidad'],
    ...(observaciones === '' ? {} : { observacionesAccesibilidad: observaciones }),
  };
}
