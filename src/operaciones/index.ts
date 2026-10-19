// Los manejadores por operationId: el servicio expone solo las operaciones del contrato que tienen uno (RNF-03.4).
// Esta spec suma el de verificarSalud; los de negocio llegan con las specs de cada módulo (#4 a #8).
export const manejadores: Readonly<Record<string, unknown>> = {};
