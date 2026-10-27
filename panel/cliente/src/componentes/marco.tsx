import { useEffect, useRef, type ReactNode } from 'react';
import type { Sesion } from '../fuentes/fuente-de-sesion.js';
import { debeEnfocarTitulo } from '../logica/presentacion.js';
import { claveDeRuta, type Ruta } from '../rutas.js';
import { Encabezado, type Etiqueta } from './encabezado.js';
import { FranjaTecnica, type UltimoPedido } from './franja-tecnica.js';
import { MenuLateral } from './menu-lateral.js';
import estilos from './marco.module.css';

type Props = {
  sesion: Sesion | undefined;
  ruta: Ruta;
  etiquetas: Etiqueta[];
  ultimo: UltimoPedido | undefined;
  alCerrarSesion: () => void;
  children: ReactNode;
};

// La estructura de toda vista (T17): menú por rol a la izquierda, encabezado con las etiquetas de lo simulado (RNF-12.7), la
// pantalla y, al pie, la franja con el último pedido a M2. Debajo de 960 px el menú pasa arriba y se abre con un botón.
export function Marco({ sesion, ruta, etiquetas, ultimo, alCerrarSesion, children }: Props) {
  const contenido = useRef<HTMLElement>(null);

  // Al cambiar de ruta el foco pasa al título de la pantalla nueva (RNF-15.3): el lector anuncia dónde se está y el teclado
  // sigue desde ahí. Cada pantalla dibuja su `Titulo` desde el primer momento, antes de cargar nada.
  const clave = claveDeRuta(ruta);
  const previa = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (debeEnfocarTitulo(previa.current, clave)) contenido.current?.querySelector('h1')?.focus();
    previa.current = clave;
  }, [clave]);

  return (
    <div className={estilos.marco}>
      <button type="button" className={estilos.salto} onClick={() => contenido.current?.focus()}>
        Ir al contenido
      </button>
      <MenuLateral rol={sesion?.rol} ruta={ruta} />
      <Encabezado sesion={sesion} etiquetas={etiquetas} alCerrarSesion={alCerrarSesion} />
      <main ref={contenido} tabIndex={-1} className={estilos.contenido}>
        {children}
      </main>
      <FranjaTecnica ultimo={ultimo} conSesion={sesion !== undefined} />
    </div>
  );
}
