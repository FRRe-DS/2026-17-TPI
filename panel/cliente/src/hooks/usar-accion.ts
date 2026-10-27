import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { crearAccion, estaEsperando, type EstadoAccion, type OpcionesAccion } from '../logica/estados.js';

// Toda acción que cambia algo en M2 (RNF-15.2): mientras espera, `esperando` es verdadero (el botón se deshabilita y un doble clic
// manda un solo pedido); al terminar bien, el estado trae el aviso; si falla, trae el error y `reintentar` repite el mismo pedido
// con la misma clave de idempotencia. Al salir de la pantalla se cancela lo que esté en curso.
export function usarAccion<A extends unknown[], R>(opciones: OpcionesAccion<A, R>) {
  // Siempre las opciones del último render, sin rehacer el controlador (que guarda el estado).
  const ultimas = useRef(opciones);
  useLayoutEffect(() => {
    ultimas.current = opciones;
  });
  const [accion] = useState(() =>
    crearAccion<A, R>({
      ejecutar: (contexto, ...argumentos) => ultimas.current.ejecutar(contexto, ...argumentos),
      aviso: (resultado) => {
        const { aviso } = ultimas.current;
        return typeof aviso === 'function' ? aviso(resultado) : aviso;
      },
      clave: opciones.clave,
    }),
  );
  useLayoutEffect(() => accion.detener, [accion]);

  const estado: EstadoAccion<R> = useSyncExternalStore(accion.suscribir, accion.estado, accion.estado);
  return { estado, esperando: estaEsperando(estado), enviar: accion.enviar, reintentar: accion.reintentar, reiniciar: accion.reiniciar };
}
