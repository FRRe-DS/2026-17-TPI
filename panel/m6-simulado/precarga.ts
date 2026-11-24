import type { crearEstadoM6 } from './estado.js';
export function precargarM6(estado: ReturnType<typeof crearEstadoM6>, clientes: readonly string[]) {
  for (const cliente of clientes) estado.cargarEjemplo(cliente);
}
