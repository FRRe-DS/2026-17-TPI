import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { marcadaEn, menuDe } from '../logica/menu.js';
import { enlace, type Rol, type Ruta } from '../rutas.js';
import estilos from './menu-lateral.module.css';

type Props = { rol: Rol | undefined; ruta: Ruta };

// La clave de la ruta: el menú abierto en el teléfono se cierra solo al cambiar de pantalla, también con «atrás».
const claveDe = (ruta: Ruta) => ('id' in ruta ? `${ruta.pantalla}/${ruta.id}` : ruta.pantalla);

export function MenuLateral({ rol, ruta }: Props) {
  const idMenu = useId();
  const boton = useRef<HTMLButtonElement>(null);
  const [abiertoEn, setAbiertoEn] = useState<string | undefined>(undefined);
  const abierto = abiertoEn === claveDe(ruta);
  const marcada = marcadaEn(ruta);

  const cerrarConEscape = (evento: KeyboardEvent) => {
    if (evento.key !== 'Escape' || !abierto) return;
    setAbiertoEn(undefined);
    boton.current?.focus();
  };

  return (
    <aside className={estilos.lateral}>
      <div className={estilos.barra}>
        <p className={estilos.marca}>
          M2 · Clientes<span className={estilos.grupo}>Grupo 17 · TPI 2026</span>
        </p>
        <button
          ref={boton}
          type="button"
          className={estilos.alternar}
          aria-expanded={abierto}
          aria-controls={idMenu}
          onClick={() => setAbiertoEn(abierto ? undefined : claveDe(ruta))}
        >
          <svg className={estilos.icono} viewBox="0 0 20 20" aria-hidden="true">
            {abierto ? <path d="M5 5l10 10M15 5L5 15" /> : <path d="M3 6h14M3 10h14M3 14h14" />}
          </svg>
          Menú
        </button>
      </div>
      <nav id={idMenu} aria-label="Pantallas" className={abierto ? `${estilos.menu} ${estilos.abierto}` : estilos.menu} onKeyDown={cerrarConEscape}>
        {menuDe(rol).map((grupo, indice) => (
          <section key={grupo.titulo} className={estilos.seccion} aria-labelledby={`${idMenu}-${indice}`}>
            <h2 id={`${idMenu}-${indice}`} className={estilos.titulo}>
              {grupo.titulo}
            </h2>
            <ul>
              {grupo.elementos.map(({ pantalla, etiqueta }) => (
                <li key={pantalla}>
                  <a
                    href={enlace(pantalla)}
                    className={estilos.elemento}
                    aria-current={marcada === pantalla ? 'page' : undefined}
                    onClick={() => setAbiertoEn(undefined)}
                  >
                    {etiqueta}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
    </aside>
  );
}
