import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { crearConfirmacion, type OpcionesConfirmacion } from '../logica/confirmacion.js';
import { estaEsperando } from '../logica/estados.js';

// La confirmación de una acción que no se deshace (RF-2.2.7): `objetivo` es lo que se está confirmando (o `undefined` si no hay
// diálogo abierto) y `accion` el estado del pedido, para el diálogo. Usa siempre las opciones del último render, como `usarAccion`.
export function usarConfirmacion<T, R>(opciones: OpcionesConfirmacion<T, R>) {
  const ultimas = useRef(opciones);
  useLayoutEffect(() => {
    ultimas.current = opciones;
  });
  const [confirmacion] = useState(() =>
    crearConfirmacion<T, R>({
      ejecutar: (objetivo, senal) => ultimas.current.ejecutar(objetivo, senal),
      aviso: (resultado) => {
        const { aviso } = ultimas.current;
        return typeof aviso === 'function' ? aviso(resultado) : aviso;
      },
    }),
  );
  useLayoutEffect(() => confirmacion.detener, [confirmacion]);

  const estado = useSyncExternalStore(confirmacion.suscribir, confirmacion.estado);
  return {
    objetivo: estado.objetivo,
    accion: estado.accion,
    esperando: estaEsperando(estado.accion),
    pedir: confirmacion.pedir,
    cancelar: confirmacion.cancelar,
    confirmar: () => void confirmacion.confirmar(),
  };
}
