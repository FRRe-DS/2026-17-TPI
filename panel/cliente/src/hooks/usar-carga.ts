import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { crearCarga, type EstadoCarga, type OpcionesCarga } from '../logica/estados.js';

// Toda carga de una pantalla (RNF-15): `cargando → listo | vacio | error`. El pedido se repite cuando cambia algo de `dependencias`
// (el cliente, la página…) y con `reintentar`, que llama a la misma función otra vez. Al salir de la pantalla se cancela el pedido.
export function usarCarga<T>(
  cargar: OpcionesCarga<T>['cargar'],
  dependencias: readonly unknown[],
  esVacio?: OpcionesCarga<T>['esVacio'],
): { estado: EstadoCarga<T>; reintentar: () => void } {
  // Un controlador por conjunto de dependencias: `cargar` de ese render es el que ve, así no queda un pedido con datos viejos.
  // Las dependencias las indica quien llama.
  const carga = useMemo(() => crearCarga<T>({ cargar, esVacio }), dependencias);
  useEffect(() => {
    carga.iniciar();
    return carga.detener;
  }, [carga]);
  return { estado: useSyncExternalStore(carga.suscribir, carga.estado), reintentar: carga.reintentar };
}
