import type { Contrato } from './cargar.js';

// Una operación del contrato. Sin operationId no puede tener manejador (se buscan por ese nombre), así que queda pendiente.
export type Operacion = { operationId?: string; metodo: string; ruta: string };

export type OperacionesDelContrato = {
  implementadas: (Operacion & { operationId: string })[];
  pendientes: Operacion[];
};

// Los métodos de un Path Item de OpenAPI 3.1. Las demás claves de una ruta (parameters, summary, servers, $ref, x-…) no
// son operaciones.
const METODOS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

const esObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === 'object' && valor !== null && !Array.isArray(valor);

// Reparte las operaciones de paths, en el orden del contrato, según tengan o no manejador (RNF-03.4). Las pendientes no
// hacen fallar la prueba de contrato (RNF-07.2). La ruta queda como está en el contrato, con {param}.
export function listarOperaciones(contrato: Contrato, manejadores: Readonly<Record<string, unknown>>): OperacionesDelContrato {
  const listas: OperacionesDelContrato = { implementadas: [], pendientes: [] };
  if (!esObjeto(contrato.paths)) return listas;

  for (const [ruta, item] of Object.entries(contrato.paths)) {
    if (!esObjeto(item)) continue;
    for (const [clave, operacion] of Object.entries(item)) {
      if (!METODOS.has(clave) || !esObjeto(operacion)) continue;
      const metodo = clave.toUpperCase();
      const { operationId } = operacion;
      if (typeof operationId !== 'string') listas.pendientes.push({ metodo, ruta });
      // hasOwn y no `in`: un operationId como toString no tiene que encontrar el de Object.prototype.
      else if (Object.hasOwn(manejadores, operationId)) listas.implementadas.push({ operationId, metodo, ruta });
      else listas.pendientes.push({ operationId, metodo, ruta });
    }
  }
  return listas;
}
