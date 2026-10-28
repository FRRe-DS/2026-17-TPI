import type { EstadoAccion } from '../logica/estados.js';
import { textoDelAviso } from '../logica/presentacion.js';
import estilos from './aviso.module.css';

// La región `aria-live` de una acción (RNF-15.2). Existe siempre, vacía mientras no pasa nada, para que el lector de pantalla la
// registre antes de que cambie. Lo hecho se ve como aviso; la espera y el error solo se leen, porque ya los muestran el botón y el
// bloque del error.
export function Aviso({ estado }: { estado: EstadoAccion<unknown> }) {
  const { tono, texto } = textoDelAviso(estado);

  return (
    <div role="status" aria-live="polite" className={tono === 'hecho' ? estilos.hecho : estilos.oculto}>
      {tono === 'hecho' && (
        <svg className={estilos.icono} viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      )}
      {texto}
    </div>
  );
}
