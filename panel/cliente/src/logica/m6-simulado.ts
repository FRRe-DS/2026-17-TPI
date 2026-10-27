import type { Escenario, ModoM6, NombreDeEscenario } from '../api/panel.js';

// Lo que dice la pantalla del M6 simulado (RNF-13.5, RNF-12.7), sin React: los modos, los escenarios y lo que M2 va a responder
// al calificar con cada uno según el modo.

export const MODOS: { valor: ModoM6; etiqueta: string; explicacion: string }[] = [
  { valor: 'normal', etiqueta: 'Normal', explicacion: 'M6 responde enseguida.' },
  { valor: 'lento', etiqueta: 'Lento', explicacion: 'M6 tarda más de lo que M2 espera: M2 corta y responde 503.' },
  { valor: 'caido', etiqueta: 'Caído', explicacion: 'M6 no acepta conexiones: M2 responde 503.' },
];

export const NOMBRE_DEL_ESCENARIO: Record<NombreDeEscenario, string> = {
  completado: 'Viaje completado',
  enCurso: 'Viaje en curso',
  ajeno: 'Viaje de otro cliente',
  inexistente: 'Viaje que no existe',
};

const SIGNIFICADO: Record<Escenario['respuestaDeM2'], string> = {
  201: '201: M2 guarda la calificación.',
  422: '422: el viaje todavía no está completado.',
  404: '404: viaje no encontrado.',
};

// Con M6 caído o lento, M2 no llega a saber nada del viaje: responde 503 con `Retry-After` para cualquiera de los cuatro.
export function respuestaEsperada(escenario: Pick<Escenario, 'respuestaDeM2'>, modo: ModoM6): string {
  return modo === 'normal' ? SIGNIFICADO[escenario.respuestaDeM2] : '503: M6 no contesta; M2 manda Retry-After.';
}

export const nombreDelModo = (modo: ModoM6): string => MODOS.find((m) => m.valor === modo)?.etiqueta ?? modo;
