import type { Disponibilidad } from '../api/panel.js';

// La salud de M2 en vivo al apagar y encender la base (spec 072, T13, RNF-13.4). Un reductor puro: el temporizador es
// `hooks/usar-sondeo` y el pedido es `consultarSaludDeM2`. La secuencia:
//   quieto → apagando → observando(último estado) → encendiendo(desde) → recuperada | no-volvio
// Mientras se observa o se espera se sondea cada 2 s, para que se vea a M2 sin base en vivo. Al encender se espera hasta 60 s,
// contados desde que se pulsó el botón, a que la salud vuelva a `200`.

export const INTERVALO_DE_SONDEO_MS = 2000;
export const ESPERA_MAXIMA_MS = 60_000;

// El último código de la salud de M2: `null` si no respondió, `undefined` si todavía no se consultó.
export type UltimoEstado = number | null | undefined;

export type EstadoSalud =
  | { fase: 'quieto' }
  | { fase: 'apagando' }
  | { fase: 'observando'; ultimo: UltimoEstado }
  | { fase: 'encendiendo'; desde: number; ultimo: UltimoEstado }
  | { fase: 'recuperada'; tardoMs: number }
  | { fase: 'no-volvio'; ultimo: UltimoEstado };

export type EventoDeSalud =
  | { tipo: 'apagar-pulsado' }
  | { tipo: 'apagada' }
  | { tipo: 'encender-pulsado'; ahora: number }
  // Una consulta de la salud de M2 terminó: `estado` null es que no respondió.
  | { tipo: 'salud'; estado: number | null; ahora: number }
  // El comando de apagar o de encender falló.
  | { tipo: 'fallo' }
  | { tipo: 'reiniciar' };

export const estadoInicial: EstadoSalud = { fase: 'quieto' };

// Un evento que no corresponde al estado no lo cambia (devuelve el mismo objeto): por ejemplo, apagar dos veces seguidas.
export function reducir(estado: EstadoSalud, evento: EventoDeSalud): EstadoSalud {
  switch (evento.tipo) {
    case 'apagar-pulsado':
      return estado.fase === 'apagando' || estado.fase === 'encendiendo' ? estado : { fase: 'apagando' };
    case 'apagada':
      return estado.fase === 'apagando' ? { fase: 'observando', ultimo: undefined } : estado;
    case 'encender-pulsado':
      if (estado.fase === 'apagando' || estado.fase === 'encendiendo') return estado;
      return { fase: 'encendiendo', desde: evento.ahora, ultimo: estado.fase === 'observando' || estado.fase === 'no-volvio' ? estado.ultimo : undefined };
    case 'fallo':
      if (estado.fase === 'apagando') return { fase: 'quieto' };
      return estado.fase === 'encendiendo' ? { fase: 'observando', ultimo: estado.ultimo } : estado;
    case 'salud': {
      if (estado.fase === 'observando') return { fase: 'observando', ultimo: evento.estado };
      if (estado.fase !== 'encendiendo') return estado;
      const pasado = evento.ahora - estado.desde;
      // Un 200 a último momento manda sobre el tiempo.
      if (evento.estado === 200) return { fase: 'recuperada', tardoMs: pasado };
      return pasado >= ESPERA_MAXIMA_MS ? { fase: 'no-volvio', ultimo: evento.estado } : { fase: 'encendiendo', desde: estado.desde, ultimo: evento.estado };
    }
    case 'reiniciar':
      return estado.fase === 'quieto' ? estado : estadoInicial;
  }
}

export const debeSondear = (estado: EstadoSalud): boolean => estado.fase === 'observando' || estado.fase === 'encendiendo';

const SEGUNDOS = ESPERA_MAXIMA_MS / 1000;
const comoDijo = (ultimo: UltimoEstado): string => (ultimo === null || ultimo === undefined ? 'sin respuesta' : String(ultimo));

// Lo que dice la vista de cada estado.
export function textoDeSalud(estado: EstadoSalud): string {
  switch (estado.fase) {
    case 'quieto':
      return 'Todavía no apagaste ni encendiste la base desde esta vista.';
    case 'apagando':
      return 'Apagando la base…';
    case 'observando':
      if (estado.ultimo === undefined) return 'Base apagada. Consultando la salud de M2…';
      if (estado.ultimo === null) return 'Base apagada. M2 no responde.';
      if (estado.ultimo === 503) return 'Base apagada. M2 responde 503: no puede atender sin su base.';
      return estado.ultimo === 200 ? 'Base apagada. M2 todavía responde 200.' : `Base apagada. M2 responde ${estado.ultimo}.`;
    case 'encendiendo':
      if (estado.ultimo === undefined) return `Encendiendo la base. Esperando a que M2 vuelva a responder 200 (hasta ${SEGUNDOS} s)…`;
      return `Encendiendo la base. ${estado.ultimo === null ? 'M2 no responde' : `M2 responde ${estado.ultimo}`}; esperando el 200 (hasta ${SEGUNDOS} s)…`;
    case 'recuperada': {
      if (estado.tardoMs < 1000) return 'M2 volvió a responder 200 en menos de 1 s.';
      const segundos = Math.round(estado.tardoMs / 1000);
      return segundos === 1 ? 'M2 volvió a responder 200 al segundo.' : `M2 volvió a responder 200 a los ${segundos} s.`;
    }
    case 'no-volvio':
      return `M2 no volvió a responder 200 en ${SEGUNDOS} s (último estado: ${comoDijo(estado.ultimo)}).`;
  }
}

type Boton = { esperando: boolean; deshabilitado: boolean };
export type ModeloControlBase = {
  apagar: Boton;
  encender: Boton;
  // Por qué no se pueden usar los dos botones, o que todavía se está averiguando. Sin aviso, se usan.
  aviso?: { texto: string; comoActivar?: string };
  // Cómo está M2: `bien` si respondió 200, `mal` si respondió otra cosa o nada, `neutro` si todavía no se sabe.
  tono: 'neutro' | 'bien' | 'mal';
};

function tonoDe(estado: EstadoSalud): ModeloControlBase['tono'] {
  if (estado.fase === 'recuperada') return 'bien';
  if (estado.fase === 'no-volvio') return 'mal';
  if (estado.fase !== 'observando' && estado.fase !== 'encendiendo') return 'neutro';
  if (estado.ultimo === undefined) return 'neutro';
  return estado.ultimo === 200 ? 'bien' : 'mal';
}

// Los botones de la sección «Base de datos» (spec 072, T16, RNF-13.4, RNF-13.6, RNF-15.6). `docker` es `undefined` mientras se
// consulta; `activa` es la clave del cerrojo de la vista. «Apagar» espera mientras se apaga y «Encender», hasta que M2 vuelve o se
// cumplen los 60 s, también después de que el comando terminó. Otra ejecución de la vista los deshabilita sin espera.
export function modeloControlBase(docker: Disponibilidad | undefined, salud: EstadoSalud, activa: string | undefined): ModeloControlBase {
  const tono = tonoDe(salud);
  const quietos = { esperando: false, deshabilitado: true };
  if (docker === undefined) return { apagar: quietos, encender: quietos, aviso: { texto: 'Consultando si el panel puede usar Docker…' }, tono };
  if (!docker.disponible) {
    const texto = `Apagar y encender la base no están disponibles${docker.motivo === undefined ? '' : `: ${docker.motivo}`}.`;
    return { apagar: quietos, encender: quietos, aviso: docker.comoActivar === undefined ? { texto } : { texto, comoActivar: docker.comoActivar }, tono };
  }
  const apagando = activa === 'base:apagar' || salud.fase === 'apagando';
  const encendiendo = activa === 'base:encender' || salud.fase === 'encendiendo';
  const ocupada = activa !== undefined || apagando || encendiendo;
  return {
    apagar: { esperando: apagando, deshabilitado: ocupada },
    encender: { esperando: encendiendo, deshabilitado: ocupada },
    tono,
  };
}
