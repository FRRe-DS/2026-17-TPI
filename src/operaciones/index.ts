import {
  actualizarCliente,
  crearBloqueo,
  crearCliente,
  levantarBloqueo,
  listarBloqueos,
  obtenerBloqueo,
  obtenerCliente,
  obtenerEstadoCuenta,
} from '../clientes/operaciones.js';
import type { Manejadores } from '../contrato/operaciones.js';
import {
  actualizarDireccion,
  crearDireccion,
  eliminarDireccion,
  listarDirecciones,
  obtenerDireccion,
} from '../direcciones/operaciones.js';
import { listarHistorialViajes } from '../historial/operaciones.js';
import { verificarSalud } from '../salud.js';
import { obtenerPreferencias, guardarPreferencias } from '../preferencias/operaciones.js';

// Los manejadores por operationId: el servicio expone solo las operaciones del contrato que tienen uno (RNF-03.4).
// Las rutas, la validación y los roles de cada una salen del contrato; acá solo se las asocia con su manejador, en el orden del
// contrato. Hoy: verificarSalud
// (GET /health, que el contrato v1 trae con ese nombre), las ocho de perfil y estado de cuenta (spec 004) y las cinco de
// direcciones (spec 005), las dos de preferencias (spec 006) y la del historial (spec 007). Las calificaciones llegan con la
// spec #8.
export const manejadores: Manejadores = {
  verificarSalud,
  crearCliente,
  obtenerCliente,
  actualizarCliente,
  listarDirecciones,
  crearDireccion,
  obtenerDireccion,
  actualizarDireccion,
  eliminarDireccion,
  obtenerPreferencias,
  guardarPreferencias,
  listarHistorialViajes,
  obtenerEstadoCuenta,
  listarBloqueos,
  crearBloqueo,
  obtenerBloqueo,
  levantarBloqueo,
};
