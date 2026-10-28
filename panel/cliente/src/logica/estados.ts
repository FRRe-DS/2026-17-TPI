import { ErrorDeApi } from '../api/errores.js';
import type { ClaveDeIdempotencia } from './clave-idempotencia.js';

// Los estados de toda pantalla que carga datos o hace una acción (RNF-15, RNF-15.2, RNF-15.4), sin React: reductores puros y dos
// controladores chicos que los usan. Los hooks `usar-carga` y `usar-accion` solo los conectan con `useSyncExternalStore`, así
// la lógica se prueba sin navegador. Cada pantalla dibuja el estado con `componentes/estado-pantalla` y `boton-accion` (T18).

// Todo lo que falle se muestra como un `ErrorDeApi`, también un error nuestro: la pantalla tiene un solo caso de error.
function comoErrorDeApi(error: unknown): ErrorDeApi {
  if (error instanceof ErrorDeApi) return error;
  const detail = error instanceof Error ? error.message : undefined;
  return new ErrorDeApi({ sinRespuesta: false, estado: 0, type: 'about:blank', title: 'Error inesperado en el panel', detail });
}

const esCancelacion = (error: unknown, senal: AbortSignal) => senal.aborted && !(error instanceof ErrorDeApi);

type Oyente = () => void;
function crearSuscripciones() {
  const oyentes = new Set<Oyente>();
  return {
    suscribir(oyente: Oyente): () => void {
      oyentes.add(oyente);
      return () => void oyentes.delete(oyente);
    },
    avisar: () => oyentes.forEach((oyente) => oyente()),
  };
}

// ---- Carga ----

// `pedido` numera cada intento: lo que contesta un pedido viejo no pisa al nuevo.
export type EstadoCarga<T> =
  | { fase: 'cargando'; pedido: number }
  | { fase: 'listo'; datos: T; pedido: number }
  | { fase: 'vacio'; pedido: number }
  | { fase: 'error'; error: ErrorDeApi; pedido: number };

export type EventoCarga<T> =
  | { tipo: 'iniciar' }
  | { tipo: 'llegaron'; pedido: number; datos: T; vacio: boolean }
  | { tipo: 'fallo'; pedido: number; error: ErrorDeApi };

export function reducirCarga<T>(estado: EstadoCarga<T>, evento: EventoCarga<T>): EstadoCarga<T> {
  if (evento.tipo === 'iniciar') return { fase: 'cargando', pedido: estado.pedido + 1 };
  if (evento.pedido !== estado.pedido) return estado;
  if (evento.tipo === 'fallo') return { fase: 'error', error: evento.error, pedido: estado.pedido };
  return evento.vacio ? { fase: 'vacio', pedido: estado.pedido } : { fase: 'listo', datos: evento.datos, pedido: estado.pedido };
}

export type OpcionesCarga<T> = {
  // El pedido. «Reintentar» llama a esta misma función otra vez; la señal se aborta cuando otro pedido o `detener` lo reemplazan.
  cargar: (senal: AbortSignal) => Promise<T>;
  // Si el resultado no tiene nada que mostrar (una lista sin elementos). Sin esto, todo resultado es `listo`.
  esVacio?: (datos: T) => boolean;
};

export function crearCarga<T>({ cargar, esVacio }: OpcionesCarga<T>) {
  let estado: EstadoCarga<T> = { fase: 'cargando', pedido: 0 };
  let control: AbortController | undefined;
  let detenida = false;
  const { suscribir, avisar } = crearSuscripciones();

  const aplicar = (evento: EventoCarga<T>) => {
    const siguiente = reducirCarga(estado, evento);
    if (siguiente === estado) return;
    estado = siguiente;
    avisar();
  };

  function iniciar() {
    detenida = false;
    control?.abort();
    const mio = new AbortController();
    control = mio;
    aplicar({ tipo: 'iniciar' });
    const pedido = estado.pedido;
    cargar(mio.signal).then(
      (datos) => {
        if (!detenida && !mio.signal.aborted) aplicar({ tipo: 'llegaron', pedido, datos, vacio: esVacio?.(datos) ?? false });
      },
      (error: unknown) => {
        if (!detenida && !esCancelacion(error, mio.signal)) aplicar({ tipo: 'fallo', pedido, error: comoErrorDeApi(error) });
      },
    );
  }

  return {
    estado: () => estado,
    suscribir,
    iniciar,
    reintentar: iniciar,
    // Al salir de la pantalla: cancela el pedido y no avisa más. `iniciar` la vuelve a poner en marcha.
    detener() {
      detenida = true;
      control?.abort();
    },
  };
}

// ---- Acción ----

export type EstadoAccion<R> =
  | { fase: 'inactiva' }
  | { fase: 'esperando' }
  | { fase: 'hecha'; aviso: string; resultado: R }
  | { fase: 'fallida'; error: ErrorDeApi };

export type EventoAccion<R> =
  | { tipo: 'enviar' }
  | { tipo: 'exito'; aviso: string; resultado: R }
  | { tipo: 'fallo'; error: ErrorDeApi }
  | { tipo: 'reiniciar' };

// Mientras espera, el control que la envió queda deshabilitado; en cualquier otra fase, no (RNF-15.2, RNF-15.4).
export const estaEsperando = <R>(estado: EstadoAccion<R>): boolean => estado.fase === 'esperando';

export function reducirAccion<R>(estado: EstadoAccion<R>, evento: EventoAccion<R>): EstadoAccion<R> {
  switch (evento.tipo) {
    case 'enviar':
      return estado.fase === 'esperando' ? estado : { fase: 'esperando' };
    case 'exito':
      return estado.fase === 'esperando' ? { fase: 'hecha', aviso: evento.aviso, resultado: evento.resultado } : estado;
    case 'fallo':
      return estado.fase === 'esperando' ? { fase: 'fallida', error: evento.error } : estado;
    case 'reiniciar':
      return { fase: 'inactiva' };
  }
}

export type ContextoDeAccion = { clave: string | undefined; senal: AbortSignal };

export type OpcionesAccion<A extends unknown[], R> = {
  // El pedido a M2. Recibe la clave de idempotencia (si la acción tiene una) y una señal, y después los argumentos de `enviar`.
  ejecutar: (contexto: ContextoDeAccion, ...argumentos: A) => Promise<R>;
  // Lo que se avisa al terminar bien.
  aviso: string | ((resultado: R) => string);
  // Solo las altas: se descarta tras un éxito y se conserva ante un error o un tiempo agotado (RF-2.5.15).
  clave?: ClaveDeIdempotencia;
};

export function crearAccion<A extends unknown[], R>({ ejecutar, aviso, clave }: OpcionesAccion<A, R>) {
  let estado: EstadoAccion<R> = { fase: 'inactiva' };
  let ultimosArgumentos: A | undefined;
  let control: AbortController | undefined;
  let detenida = false;
  const { suscribir, avisar } = crearSuscripciones();

  const aplicar = (evento: EventoAccion<R>) => {
    const siguiente = reducirAccion(estado, evento);
    if (siguiente === estado) return;
    estado = siguiente;
    avisar();
  };

  async function enviar(...argumentos: A): Promise<void> {
    // Un doble clic llega acá con el pedido en curso: no se manda otro.
    if (estaEsperando(estado)) return;
    detenida = false;
    ultimosArgumentos = argumentos;
    const mio = new AbortController();
    control = mio;
    aplicar({ tipo: 'enviar' });
    try {
      const resultado = await ejecutar({ clave: clave?.obtener(), senal: mio.signal }, ...argumentos);
      clave?.descartar();
      if (!detenida) aplicar({ tipo: 'exito', aviso: typeof aviso === 'function' ? aviso(resultado) : aviso, resultado });
    } catch (error) {
      if (!detenida && !esCancelacion(error, mio.signal)) aplicar({ tipo: 'fallo', error: comoErrorDeApi(error) });
    }
  }

  return {
    estado: () => estado,
    suscribir,
    enviar,
    // «Reintentar»: el mismo pedido con los mismos argumentos y, si hay, la misma clave.
    reintentar: () => (ultimosArgumentos === undefined ? Promise.resolve() : enviar(...ultimosArgumentos)),
    reiniciar: () => aplicar({ tipo: 'reiniciar' }),
    detener() {
      detenida = true;
      control?.abort();
    },
  };
}
