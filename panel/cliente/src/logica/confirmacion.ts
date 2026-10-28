import { crearAccion, estaEsperando, type EstadoAccion } from './estados.js';

// La confirmación de lo que no se deshace (RF-2.2.7), sin React: la persona pide la acción sobre algo (`pedir`), ve el diálogo y
// elige. «Cancelar» cierra sin llamar a M2; solo `confirmar` hace el pedido, y mientras espera no se confirma dos veces ni se cierra.
// Si M2 rechaza, el diálogo sigue abierto con el error y confirmar de nuevo repite el mismo pedido; si sale bien, se cierra solo y
// queda el aviso. Se apoya en `crearAccion`, así que el doble clic, la espera y los errores son los de toda acción (RNF-15.2).

export type EstadoDeConfirmacion<T, R> = { objetivo: T | undefined; accion: EstadoAccion<R> };

export type OpcionesConfirmacion<T, R> = {
  // El pedido sobre el objetivo elegido, con la señal para cancelarlo al salir de la pantalla.
  ejecutar: (objetivo: T, senal: AbortSignal) => Promise<R>;
  aviso: string | ((resultado: R) => string);
};

export function crearConfirmacion<T, R>({ ejecutar, aviso }: OpcionesConfirmacion<T, R>) {
  const accion = crearAccion<[T], R>({ ejecutar: ({ senal }, objetivo) => ejecutar(objetivo, senal), aviso });
  let objetivo: T | undefined;
  let instantanea: EstadoDeConfirmacion<T, R> = { objetivo, accion: accion.estado() };
  const oyentes = new Set<() => void>();

  // Un estado nuevo solo si cambió algo: `useSyncExternalStore` compara por identidad.
  function actualizar() {
    const estadoDeLaAccion = accion.estado();
    if (instantanea.objetivo === objetivo && instantanea.accion === estadoDeLaAccion) return;
    instantanea = { objetivo, accion: estadoDeLaAccion };
    oyentes.forEach((oyente) => oyente());
  }

  // Si la acción salió bien, el diálogo se cierra en el mismo cambio, sin pasar por «abierto y hecho».
  accion.suscribir(() => {
    if (accion.estado().fase === 'hecha') objetivo = undefined;
    actualizar();
  });

  return {
    estado: () => instantanea,
    suscribir(oyente: () => void): () => void {
      oyentes.add(oyente);
      return () => void oyentes.delete(oyente);
    },
    // Abre la confirmación sobre `nuevo`. No llama a M2. Con un pedido en curso se ignora.
    pedir(nuevo: T) {
      if (estaEsperando(accion.estado())) return;
      objetivo = nuevo;
      accion.reiniciar();
      actualizar();
    },
    // Cierra sin llamar a M2 y borra el error o el aviso. Con un pedido en curso se ignora.
    cancelar() {
      if (estaEsperando(accion.estado())) return;
      objetivo = undefined;
      accion.reiniciar();
      actualizar();
    },
    // El único que llama a M2: sobre el objetivo abierto. Repetirlo tras un error repite el mismo pedido.
    async confirmar(): Promise<void> {
      if (objetivo === undefined) return;
      await accion.enviar(objetivo);
    },
    // Al salir de la pantalla: cancela el pedido en curso y no avisa más.
    detener: accion.detener,
  };
}
