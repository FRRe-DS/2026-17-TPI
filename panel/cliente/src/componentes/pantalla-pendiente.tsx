import estilos from './pantalla-pendiente.module.css';

// Lo que muestra una pantalla mientras no está construida (tramo D): el título y una hoja vacía.
export function PantallaPendiente({ titulo }: { titulo: string }) {
  return (
    <>
      <h1>{titulo}</h1>
      <section className={estilos.hoja} aria-label={titulo}>
        <p>Esta pantalla todavía no está construida.</p>
      </section>
    </>
  );
}
