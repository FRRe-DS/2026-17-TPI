import estilos from './pantalla-pendiente.module.css';
import { Titulo } from './titulo.js';

// Lo que muestra una pantalla mientras no está construida (tramo D): el título y una hoja vacía.
export function PantallaPendiente({ titulo }: { titulo: string }) {
  return (
    <>
      <Titulo>{titulo}</Titulo>
      <section className={estilos.hoja} aria-label={titulo}>
        <p>Esta pantalla todavía no está construida.</p>
      </section>
    </>
  );
}
