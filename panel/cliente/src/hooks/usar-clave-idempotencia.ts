import { useEffect, useState } from 'react';
import { crearClaveDeIdempotencia, type ClaveDeIdempotencia } from '../logica/clave-idempotencia.js';

// La clave de un formulario de alta (RF-2.5.15): se genera al abrirlo y se descarta al cerrarlo. Se la pasa a `usarAccion` en
// `clave`, que la conserva ante un error y la descarta tras un éxito.
export function usarClaveDeIdempotencia(): ClaveDeIdempotencia {
  const [clave] = useState(() => crearClaveDeIdempotencia());
  useEffect(() => {
    clave.abrir();
    return clave.descartar;
  }, [clave]);
  return clave;
}
