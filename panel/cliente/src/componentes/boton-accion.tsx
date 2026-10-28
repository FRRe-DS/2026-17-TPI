import { useRef, type ReactNode } from 'react';
import { modeloBoton } from '../logica/presentacion.js';
import estilos from './boton-accion.module.css';

type Props = {
  esperando: boolean;
  // `principal` para la acción de la hoja; `contorno` para lo secundario; `peligro` para lo que no se deshace, que queda
  // contorneado en ladrillo hasta que recibe el foco o el puntero.
  variante?: 'principal' | 'contorno' | 'peligro';
  tipo?: 'button' | 'submit';
  textoEsperando?: string;
  // Deshabilitado sin estar esperando: por ejemplo, otra acción de la pantalla está en curso o falta Docker. Quien lo usa dice por qué
  // en la pantalla (RNF-15.4).
  deshabilitado?: boolean;
  onClick?: () => void;
  children: ReactNode;
};

// El botón que envía un pedido a M2 (RNF-15.2): mientras espera queda deshabilitado, con `aria-busy` y el texto de espera, así un
// doble clic manda un solo pedido (RF-2.5.15). Fuera de la espera nunca está deshabilitado (RNF-15.4), salvo que la pantalla lo pida con
// `deshabilitado` y diga por qué.
export function BotonAccion({ esperando, variante = 'principal', tipo = 'button', textoEsperando, deshabilitado = false, onClick, children }: Props) {
  const modelo = modeloBoton(esperando, '', textoEsperando);
  // El fundido es para el cambio de estado, no para la primera vez que se dibuja: al abrir una pantalla los botones ya están.
  const previo = useRef(modelo.esperando);
  const cambio = useRef(false);
  if (previo.current !== modelo.esperando) {
    previo.current = modelo.esperando;
    cambio.current = true;
  }

  return (
    <button
      type={tipo}
      className={`${estilos.boton} ${estilos[variante]}`}
      disabled={modelo.deshabilitado || deshabilitado}
      aria-busy={modelo.esperando || undefined}
      onClick={onClick}
    >
      {/* La clave cambia con la espera: el contenido nuevo entra con su fundido en vez de reemplazar al viejo de golpe. La espera
          entra desde abajo y el texto vuelve desde arriba, como una rueda que gira hacia adelante y regresa. */}
      <span
        key={modelo.esperando ? 'esperando' : 'listo'}
        className={cambio.current ? `${estilos.contenido} ${modelo.esperando ? estilos.entra : estilos.vuelve}` : estilos.contenido}
      >
        {modelo.esperando ? (
          <>
            <svg className={estilos.giro} viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6.5" />
            </svg>
            {modelo.etiqueta}
          </>
        ) : (
          children
        )}
      </span>
    </button>
  );
}
