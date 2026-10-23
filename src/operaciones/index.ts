import type { Manejadores } from '../contrato/operaciones.js';
import { verificarSalud } from '../salud.js';

// Los manejadores por operationId: el servicio expone solo las operaciones del contrato que tienen uno (RNF-03.4).
// Esta spec suma el de verificarSalud (GET /health, que el contrato v1 trae con ese nombre); los de negocio llegan con las
// specs de cada módulo (#4 a #8).
export const manejadores: Manejadores = { verificarSalud };
