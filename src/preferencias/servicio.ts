import { autorizar } from '../auth/permisos.js';
import type { Identidad } from '../auth/tokens.js';
import type { BaseDeDatos } from '../bd/pool.js';
import type { Consultar } from '../bd/transaccion.js';
import { exigirPropietario, normalizarUuid } from '../clientes/servicio.js';
import type { Preferencias } from './modelo.js';
import * as repositorio from './repositorio.js';

const delPool = (pool: BaseDeDatos): Consultar => (sql, parametros) => pool.consultar(sql, parametros);

// Reutiliza la regla común: CLIENTE+OPERADOR lee ajeno, pero PUT solo admite
// CLIENTE y exige dueño. Los rechazos van antes de cualquier acceso a la base.
function exigirAcceso(identidad: Identidad, rolesOperacion: readonly string[], clienteId: string): void {
  autorizar(identidad.roles, rolesOperacion);
  exigirPropietario(identidad, clienteId, rolesOperacion);
}

export async function obtenerPreferencias(
  pool: BaseDeDatos, identidad: Identidad, rolesOperacion: readonly string[], clienteId: string,
): Promise<Preferencias> {
  exigirAcceso(identidad, rolesOperacion, clienteId);
  return repositorio.obtenerPreferencias(delPool(pool), normalizarUuid(clienteId));
}

export async function guardarPreferencias(
  pool: BaseDeDatos, identidad: Identidad, rolesOperacion: readonly string[], clienteId: string, datos: Preferencias,
): Promise<Preferencias> {
  exigirAcceso(identidad, rolesOperacion, clienteId);
  return repositorio.guardarPreferencias(delPool(pool), normalizarUuid(clienteId), datos);
}
