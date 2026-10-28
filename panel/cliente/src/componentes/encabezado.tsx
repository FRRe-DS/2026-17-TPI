import type { Sesion } from '../fuentes/fuente-de-sesion.js';
import estilos from './encabezado.module.css';

// Cada fuente simulada con su nombre corto: «Sesión: simulado, pendiente de M1» (RNF-12.7).
export type Etiqueta = { de: string; texto: string };

type Props = { sesion: Sesion | undefined; etiquetas: Etiqueta[]; alCerrarSesion: () => void };

export function Encabezado({ sesion, etiquetas, alCerrarSesion }: Props) {
  return (
    <header className={estilos.encabezado}>
      {/* La banda de entorno de prueba (RNF-12.7): en toda vista, arriba de todo, dice qué fuentes son simuladas. */}
      <div className={estilos.banda}>
        <svg className={estilos.icono} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3 2.5 20h19L12 3Z" />
          <path d="M12 10v4M12 17.2v.1" />
        </svg>
        <div className={estilos.texto}>
          <b>Entorno de prueba.</b>{' '}
          <ul className={estilos.etiquetas} aria-label="Fuentes simuladas">
            {etiquetas.map(({ de, texto }) => (
              <li key={de} className={estilos.etiqueta}>
                {de}: {texto}
              </li>
            ))}
          </ul>
        </div>
      </div>
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
