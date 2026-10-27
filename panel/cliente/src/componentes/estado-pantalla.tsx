import type { ReactNode } from 'react';
import type { ErrorDeApi } from '../api/errores.js';
import type { EstadoCarga } from '../logica/estados.js';
import { ErrorDeM2 } from './error-de-m2.js';
import estilos from './estado-pantalla.module.css';

type Props<T> = {
  estado: EstadoCarga<T>;
  // Lo que se muestra cuando la carga trajo una lista vacía: con las palabras de la pantalla, no un «Sin datos».
  vacio: ReactNode;
  alReintentar: () => void;
  // Un error que la pantalla muestra a su manera (el 503 de otro módulo); si devuelve `undefined`, se muestra el de siempre.
  errorPropio?: (error: ErrorDeApi, alReintentar: () => void) => ReactNode;
  children: (datos: T) => ReactNode;
};

// Lo que carga una pantalla (RNF-15): esperando, vacío, el error de M2 con «Reintentar» o los datos. El título de la pantalla
// va afuera, así está desde el primer momento y recibe el foco al cambiar de ruta.
export function EstadoPantalla<T>({ estado, vacio, alReintentar, errorPropio, children }: Props<T>) {
  switch (estado.fase) {
    case 'cargando':
      return (
        <div className={estilos.cargando} aria-busy="true">
          <span className={estilos.giro} aria-hidden="true" />
          Cargando…
        </div>
      );
    case 'vacio':
      return <p className={estilos.vacio}>{vacio}</p>;
    case 'error':
      return (
        errorPropio?.(estado.error, alReintentar) ?? (
          <div role="alert">
            <ErrorDeM2 error={estado.error} alReintentar={alReintentar} />
          </div>
        )
      );
    case 'listo':
      return <>{children(estado.datos)}</>;
  }
}
