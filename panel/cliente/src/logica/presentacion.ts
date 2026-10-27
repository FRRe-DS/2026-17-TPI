import type { DatosDeError } from '../api/errores.js';
import type { EstadoAccion } from './estados.js';

// La lógica de los componentes base (T18), sin React: qué se deshabilita, qué lee la región `aria-live`, qué filas tiene un error
// de M2 y qué describe a cada campo. Los componentes de `componentes/` solo la dibujan.

export const TEXTO_ESPERANDO = 'Enviando…';

// El botón que envía (RNF-15.2, RF-2.5.15): mientras espera, deshabilitado y con texto de espera, así un doble clic manda un
// solo pedido. Fuera de la espera siempre está habilitado, también tras «M2 no responde» (RNF-15.4).
export function modeloBoton(esperando: boolean, texto: string, textoEsperando = TEXTO_ESPERANDO) {
  return { deshabilitado: esperando, etiqueta: esperando ? textoEsperando : texto, esperando };
}

// Una frase con el error, para leer en voz alta: «Título (código). Detalle».
export function describirError(error: DatosDeError): string {
  if (error.sinRespuesta) return `${error.title}. Se puede reintentar.`;
  return error.detail === undefined ? `${error.title} (${error.estado}).` : `${error.title} (${error.estado}). ${error.detail}`;
}

export type Tono = 'ninguno' | 'espera' | 'hecho' | 'error';

// Lo que lee la región `aria-live` de una acción: nada quieta, que se envía, lo que se hizo o el error.
export function textoDelAviso(estado: EstadoAccion<unknown>): { tono: Tono; texto: string } {
  switch (estado.fase) {
    case 'inactiva':
      return { tono: 'ninguno', texto: '' };
    case 'esperando':
      return { tono: 'espera', texto: TEXTO_ESPERANDO };
    case 'hecha':
      return { tono: 'hecho', texto: estado.aviso };
    case 'fallida':
      return { tono: 'error', texto: describirError(estado.error) };
  }
}

// El error de M2 tal como vino (RNF-03.6), en filas de nombre y valor; las que no vinieron no se muestran. El folio es el
// `X-Request-Id`, el que se busca en los logs de M2.
export function filasDelError(error: DatosDeError): [string, string][] {
  const filas: [string, string | undefined][] = [
    ['Código', String(error.estado)],
    ['Tipo', error.type],
    ['Detalle', error.detail],
    ['Instancia', error.instance],
    ['Reintentar en', error.reintentarEnS === undefined ? undefined : `${error.reintentarEnS} s`],
    ['Folio', error.requestId],
  ];
  return filas.filter((fila): fila is [string, string] => fila[1] !== undefined);
}

// Los ids que asocian la ayuda y el error con su campo (RNF-15.3): `aria-describedby` los lista y `aria-invalid` marca el error.
export function atributosDeCampo(id: string, { ayuda, error }: { ayuda?: string | undefined; error?: string | undefined }) {
  const idAyuda = ayuda ? `${id}-ayuda` : undefined;
  const idError = error ? `${id}-error` : undefined;
  const ids = [idAyuda, idError].filter((valor) => valor !== undefined);
  return { idAyuda, idError, describidoPor: ids.length > 0 ? ids.join(' ') : undefined, invalido: idError !== undefined };
}

// El diálogo de confirmación (RF-2.2.7): mientras espera no se confirma dos veces ni se cierra a medias; fuera de la espera todo
// queda habilitado (RNF-15.4).
export function modeloDialogo(estado: EstadoAccion<unknown>) {
  const esperando = estado.fase === 'esperando';
  return { confirmarDeshabilitado: esperando, cancelarDeshabilitado: esperando, cierraConEscape: !esperando };
}

// El foco pasa al título de la pantalla al cambiar de ruta (RNF-15.3), no al cargar la primera: ahí el lector empieza por arriba.
export const debeEnfocarTitulo = (previa: string | undefined, actual: string): boolean => previa !== undefined && previa !== actual;
