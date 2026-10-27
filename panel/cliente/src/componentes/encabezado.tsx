import type { Sesion } from '../fuentes/fuente-de-sesion.js';
import estilos from './encabezado.module.css';

// Cada fuente simulada con su nombre corto: «Sesión: simulado, pendiente de M1» (RNF-12.7).
export type Etiqueta = { de: string; texto: string };

type Props = { sesion: Sesion | undefined; etiquetas: Etiqueta[]; alCerrarSesion: () => void };

export function Encabezado({ sesion, etiquetas, alCerrarSesion }: Props) {
  return (
    <header className={estilos.encabezado}>
      <ul className={estilos.etiquetas} aria-label="Fuentes simuladas">
        {etiquetas.map(({ de, texto }) => (
          <li key={de} className={estilos.etiqueta}>
            {de}: {texto}
          </li>
        ))}
      </ul>
      {sesion !== undefined && (
        <div className={estilos.sesion}>
          <span className={estilos.rol}>{sesion.rol}</span>
          <span className={estilos.sub} title={sesion.sub}>
            {sesion.sub}
          </span>
          <button type="button" className={estilos.cerrar} onClick={alCerrarSesion}>
            Cerrar sesión
          </button>
        </div>
      )}
    </header>
  );
}
