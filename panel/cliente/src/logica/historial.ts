import type { components } from '../generado/contrato.js';

// Lo que el historial dice de cada viaje (RF-2.4.12), sin React.

type Viaje = components['schemas']['ViajeResumen'];

// El estado que M6 informa cuando el viaje terminó bien; es el único que se puede calificar (el mismo que mira M2).
const COMPLETADO = 'COMPLETED';

const ESTADOS: Record<string, string> = { COMPLETED: 'Completado', IN_PROGRESS: 'En curso' };

// El estado llega de M6 sin traducir (contrato): lo conocido lleva su palabra, lo demás se muestra tal cual.
export const nombreDelEstado = (estado: string): string => ESTADOS[estado] ?? estado;

// «Calificar» solo en los completados que no están calificados. Sin el dato (el campo es opcional) no se asume que lo estén: M2
// rechazaría la repetida con `409`.
export const sePuedeCalificar = (viaje: Pick<Viaje, 'estado' | 'calificado'>): boolean => viaje.estado === COMPLETADO && viaje.calificado !== true;

export const textoDeCalificado = (calificado: boolean | undefined): string =>
  calificado === undefined ? 'Sin dato' : calificado ? 'Calificado' : 'Sin calificar';

const FECHA_Y_HORA = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/;
// El instante tal como lo trae M2, en UTC y sin milisegundos: es un dato, no una fecha para leer en voz alta.
export const instante = (iso: string): string => FECHA_Y_HORA.exec(iso)?.slice(1).join(' ') ?? iso;
