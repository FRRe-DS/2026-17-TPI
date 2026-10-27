import type { ReactNode } from 'react';
import { modeloBoton } from '../logica/presentacion.js';
import estilos from './boton-accion.module.css';

type Props = {
  esperando: boolean;
  // `principal` para la acción de la hoja; `contorno` para lo secundario; `peligro` para lo que no se deshace, que queda
  // contorneado en ladrillo hasta que recibe el foco o el puntero.
  variante?: 'principal' | 'contorno' | 'peligro';
  tipo?: 'button' | 'submit';
  textoEsperando?: string;
  onClick?: () => void;
  children: ReactNode;
};

// El botón que envía un pedido a M2 (RNF-15.2): mientras espera queda deshabilitado, con `aria-busy` y el texto de espera, así un
// doble clic manda un solo pedido (RF-2.5.15). Fuera de la espera nunca está deshabilitado (RNF-15.4).
export function BotonAccion({ esperando, variante = 'principal', tipo = 'button', textoEsperando, onClick, children }: Props) {
  const modelo = modeloBoton(esperando, '', textoEsperando);

  return (
    <button
      type={tipo}
      className={`${estilos.boton} ${estilos[variante]}`}
      disabled={modelo.deshabilitado}
      aria-busy={modelo.esperando || undefined}
      onClick={onClick}
    >
      {modelo.esperando ? (
        <>
          <span className={estilos.giro} aria-hidden="true" />
          {modelo.etiqueta}
        </>
      ) : (
        children
      )}
    </button>
  );
}
