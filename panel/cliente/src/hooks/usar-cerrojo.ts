import { useState, useSyncExternalStore } from 'react';
import { crearCerrojo, type Cerrojo } from '../logica/cerrojo.js';

// El cerrojo de la vista «Demostración»: un solo cerrojo por pantalla, y la clave de lo que está corriendo para que cada botón sepa
// si es el suyo («Ejecutando…») o el de otro (deshabilitado).
export function usarCerrojo(): { cerrojo: Cerrojo; activa: string | undefined } {
  const [cerrojo] = useState(() => crearCerrojo<string>());
  const activa = useSyncExternalStore(cerrojo.suscribir, cerrojo.activa, cerrojo.activa);
  return { cerrojo, activa };
}
