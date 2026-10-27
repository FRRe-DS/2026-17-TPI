import type { DatosDeError } from '../api/errores.js';
import { filasDelError } from '../logica/presentacion.js';
import { BotonAccion } from './boton-accion.js';
import estilos from './error-de-m2.module.css';

type Props = {
  error: DatosDeError;
  alReintentar?: (() => void) | undefined;
  esperando?: boolean;
  // Lo que la pantalla dice de este rechazo en sus palabras (RF-2.5.16); el error de M2 sigue completo debajo.
  mensaje?: string | undefined;
};

// El error tal como lo devolvió M2 (RNF-03.6): título, código, tipo, detalle y folio, nunca reemplazado por otro texto. Si M2 no
// respondió, lo dice (RNF-15.4). «Reintentar» repite el mismo pedido (RNF-15.2) y nunca queda deshabilitado tras el error.
export function ErrorDeM2({ error, alReintentar, esperando = false, mensaje }: Props) {
  return (
    <div className={estilos.error}>
      {mensaje !== undefined && <p className={estilos.mensaje}>{mensaje}</p>}
      <p className={estilos.titulo}>{error.title}</p>
      {error.sinRespuesta && <p className={estilos.explicacion}>M2 no contestó a tiempo. Puede estar detenido o arrancando.</p>}
      <dl className={estilos.filas}>
        {filasDelError(error).map(([nombre, valor]) => (
          <div key={nombre} className={estilos.fila}>
            <dt>{nombre}</dt>
            <dd>{valor}</dd>
          </div>
        ))}
      </dl>
      {alReintentar !== undefined && (
        <div className={estilos.acciones}>
          <BotonAccion esperando={esperando} variante="contorno" onClick={alReintentar}>
            Reintentar
          </BotonAccion>
        </div>
      )}
    </div>
  );
}
