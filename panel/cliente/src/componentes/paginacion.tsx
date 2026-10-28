import { hayAnterior, haySiguiente, textoDePagina, type DatosDePagina } from '../logica/paginacion.js';
import estilos from './paginacion.module.css';

type Props = { pagina: DatosDePagina; alCambiar: (pagina: number) => void; nombre: string };

// Los controles de una lista paginada (RF-2.2.6, RF-2.4.12, RF-2.5.17). Con una sola página solo dice cuántos hay. En los extremos,
// el botón que no lleva a ningún lado queda deshabilitado (no es una espera, RNF-15.4).
export function Paginacion({ pagina, alCambiar, nombre }: Props) {
  return (
    <nav className={estilos.paginacion} aria-label={`Páginas de ${nombre}`}>
      <p className={estilos.texto}>{textoDePagina(pagina)}</p>
      {pagina.totalPaginas > 1 && (
        <div className={estilos.botones}>
          <button type="button" className={estilos.boton} disabled={!hayAnterior(pagina)} onClick={() => alCambiar(pagina.page - 1)}>
            Anterior
          </button>
          <button type="button" className={estilos.boton} disabled={!haySiguiente(pagina)} onClick={() => alCambiar(pagina.page + 1)}>
            Siguiente
          </button>
        </div>
      )}
    </nav>
  );
}
