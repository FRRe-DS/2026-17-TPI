import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { crearCuentaRegresiva } from '../logica/cuenta-regresiva.js';

const sinSuscribir = () => () => undefined;
const sinValor = () => undefined;

// Los segundos que faltan para volver a intentar, o `undefined` si no hay cuenta. La cuenta empieza de nuevo cuando cambia `clave`
// (un error nuevo, aunque traiga los mismos segundos) y se corta al salir de la pantalla.
export function usarCuentaRegresiva(segundos: number | undefined, clave: unknown): number | undefined {
  const cuenta = useMemo(() => (segundos === undefined ? undefined : crearCuentaRegresiva(segundos)), [segundos, clave]);
  useEffect(() => {
    cuenta?.iniciar();
    return cuenta?.detener;
  }, [cuenta]);
  const restantes = cuenta?.restantes ?? sinValor;
  return useSyncExternalStore(cuenta?.suscribir ?? sinSuscribir, restantes, restantes);
}
