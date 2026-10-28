import { useEffect, useId, useRef, type ReactNode, type SyntheticEvent } from 'react';
import type { EstadoAccion } from '../logica/estados.js';
import { modeloDialogo } from '../logica/presentacion.js';
import { BotonAccion } from './boton-accion.js';
import { ErrorDeM2 } from './error-de-m2.js';
import estilos from './dialogo-confirmar.module.css';

type Props = {
  abierto: boolean;
  titulo: string;
  // El texto del botón que confirma, con el verbo de la acción: «Eliminar», «Bloquear».
  confirmar: string;
  estado: EstadoAccion<unknown>;
  alConfirmar: () => void;
  alCancelar: () => void;
  // El mensaje: qué se va a hacer y sobre qué.
  children: ReactNode;
};

// La confirmación de lo que no se deshace (RF-2.2.7), en un `<dialog>` modal: el foco queda adentro y empieza en «Cancelar», que
// cierra sin llamar a M2. Mientras espera no se confirma dos veces ni se cierra; si falla, muestra el error y la acción pasa a
// «Reintentar» (RNF-15.2, RNF-15.4).
export function DialogoConfirmar({ abierto, titulo, confirmar, estado, alConfirmar, alCancelar, children }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const id = useId();
  const modelo = modeloDialogo(estado);

  useEffect(() => {
    const elemento = dialogo.current;
    if (elemento === null) return;
    if (abierto && !elemento.open) elemento.showModal();
    if (!abierto && elemento.open) elemento.close();
  }, [abierto]);

  // Escape dispara `cancel`: lo maneja el panel para que el estado de React y el del diálogo no se separen.
  const alEscape = (evento: SyntheticEvent) => {
    evento.preventDefault();
    if (modelo.cierraConEscape) alCancelar();
  };

  return (
    <dialog ref={dialogo} className={estilos.dialogo} aria-labelledby={`${id}-titulo`} aria-describedby={`${id}-mensaje`} onCancel={alEscape}>
      <h2 id={`${id}-titulo`} className={estilos.titulo}>
        {titulo}
      </h2>
      <div id={`${id}-mensaje`} className={estilos.mensaje}>
        {children}
      </div>
      {estado.fase === 'fallida' && (
        <div role="alert" className={estilos.error}>
          <ErrorDeM2 error={estado.error} />
        </div>
      )}
      <div className={estilos.acciones}>
        <button type="button" className={estilos.cancelar} disabled={modelo.cancelarDeshabilitado} onClick={alCancelar} autoFocus>
          Cancelar
        </button>
        <BotonAccion esperando={modelo.confirmarDeshabilitado} variante="peligro" onClick={alConfirmar}>
          {estado.fase === 'fallida' ? 'Reintentar' : confirmar}
        </BotonAccion>
      </div>
    </dialog>
  );
}
