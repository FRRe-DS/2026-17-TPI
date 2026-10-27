import { useEffect, useState } from 'react';
import { resolver, type Resolucion, type Rol } from '../rutas.js';

// La pantalla que corresponde al hash de la barra de direcciones y a la sesión. Si hace falta redirigir (sin sesión, o en la
// raíz), cambia el hash sin dejar la ruta vieja en el historial; el cambio vuelve a llegar por `hashchange`.
export function usarRuta(sesion: { rol: Rol } | undefined): Resolucion {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const alCambiar = () => setHash(window.location.hash);
    window.addEventListener('hashchange', alCambiar);
    return () => window.removeEventListener('hashchange', alCambiar);
  }, []);

  const resolucion = resolver(hash, sesion);
  const { redirigirA } = resolucion;
  useEffect(() => {
    if (redirigirA !== undefined) window.location.replace(redirigirA);
  }, [redirigirA]);
  return resolucion;
}
