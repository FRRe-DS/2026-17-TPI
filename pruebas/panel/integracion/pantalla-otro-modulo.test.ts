import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiM2 } from '../../../panel/cliente/src/api/m2.js';
import { OPERACIONES } from '../../../panel/cliente/src/api/m2.js';
import { CLIENTE_DE_EJEMPLO, cuerpoDeAlta } from '../../../panel/cliente/src/logica/campos-cliente.js';
import { levantarPanelConM2, type PanelConM2 } from '../ayudas/panel-con-m2.js';

// La vista de otro módulo (T30, RF-2.6.7) contra el panel de verdad: PostgreSQL, M2 y el servidor del panel, pidiendo como SERVICIO
// con el identificador por defecto.

let panel: PanelConM2;
beforeAll(async () => {
  panel = await levantarPanelConM2();
});
afterAll(async () => {
  await panel?.cerrar();
});

const modulo = (): ApiM2 => panel.api(() => ({ rol: 'SERVICIO', sub: 'm5-despacho' }));
const operador = (): ApiM2 => panel.api(() => ({ rol: 'OPERADOR', sub: 'operador-1' }));

async function clienteNuevo(): Promise<string> {
  const clienteId = randomUUID();
  await panel.api(() => ({ rol: 'CLIENTE', sub: clienteId })).crearCliente(cuerpoDeAlta(CLIENTE_DE_EJEMPLO), randomUUID());
  return clienteId;
}

describe('consultar el estado de cuenta de cualquier cliente (RF-2.6.7)', () => {
  it('de un cliente activo', async () => {
    const clienteId = await clienteNuevo();

    expect(await modulo().obtenerEstadoCuenta(clienteId)).toEqual({ clienteId, estado: 'ACTIVO', bloqueosVigentes: [] });
  });

  it('de uno bloqueado, con sus bloqueos vigentes; al levantarlo, vuelve a activo', async () => {
    const clienteId = await clienteNuevo();
    const bloqueo = await operador().crearBloqueo(clienteId, { motivo: 'Fraude' }, randomUUID());

    expect(await modulo().obtenerEstadoCuenta(clienteId)).toMatchObject({ estado: 'BLOQUEADO', bloqueosVigentes: [{ bloqueoId: bloqueo.bloqueoId, motivo: 'Fraude' }] });
    await operador().levantarBloqueo(clienteId, bloqueo.bloqueoId, { motivo: 'Resuelto' });
    expect((await modulo().obtenerEstadoCuenta(clienteId)).estado).toBe('ACTIVO');
  });

  it('el módulo no necesita ser el cliente: consulta el de dos clientes distintos con el mismo identificador', async () => {
    const [uno, dos] = [await clienteNuevo(), await clienteNuevo()];

    expect((await modulo().obtenerEstadoCuenta(uno)).clienteId).toBe(uno);
    expect((await modulo().obtenerEstadoCuenta(dos)).clienteId).toBe(dos);
  });

  it('un UUID que no existe da 404', async () => {
    await expect(modulo().obtenerEstadoCuenta(randomUUID())).rejects.toMatchObject({ estado: 404 });
  });
});

describe('no puede hacer nada más: M2 responde 403 a todo lo demás', () => {
  it('cada otra operación del contrato, salvo la verificación de salud y el estado de cuenta, es 403 para el SERVICIO', async () => {
    const clienteId = await clienteNuevo();
    const api = modulo();
    const otro = randomUUID();
    const llamadas: Record<string, () => Promise<unknown>> = {
      crearCliente: () => api.crearCliente(cuerpoDeAlta(CLIENTE_DE_EJEMPLO), randomUUID()),
      obtenerCliente: () => api.obtenerCliente(clienteId),
      actualizarCliente: () => api.actualizarCliente(clienteId, { nombre: 'X' }),
      listarDirecciones: () => api.listarDirecciones(clienteId),
      crearDireccion: () => api.crearDireccion(clienteId, { tipo: 'RECIENTE', texto: 'X' }, randomUUID()),
      obtenerDireccion: () => api.obtenerDireccion(clienteId, otro),
      actualizarDireccion: () => api.actualizarDireccion(clienteId, otro, { texto: 'X' }),
      eliminarDireccion: () => api.eliminarDireccion(clienteId, otro),
      obtenerPreferencias: () => api.obtenerPreferencias(clienteId),
      guardarPreferencias: () => api.guardarPreferencias(clienteId, { tiposVehiculo: [], canales: [], accesibilidad: [] }),
      listarHistorialViajes: () => api.listarHistorialViajes(clienteId),
      listarCalificaciones: () => api.listarCalificaciones(clienteId),
      calificarConductor: () => api.calificarConductor(clienteId, { viajeId: otro, puntaje: 5 }, randomUUID()),
      obtenerCalificacion: () => api.obtenerCalificacion(clienteId, otro),
      listarBloqueos: () => api.listarBloqueos(clienteId),
      crearBloqueo: () => api.crearBloqueo(clienteId, { motivo: 'X' }, randomUUID()),
      obtenerBloqueo: () => api.obtenerBloqueo(clienteId, otro),
      levantarBloqueo: () => api.levantarBloqueo(clienteId, otro, { motivo: 'X' }),
    };
    const sinProbar = Object.keys(OPERACIONES).filter((n) => !(n in llamadas) && n !== 'obtenerEstadoCuenta' && n !== 'verificarSalud');
    expect(sinProbar).toEqual([]);

    const resultados = await Promise.all(Object.entries(llamadas).map(async ([nombre, llamar]) => [nombre, await llamar().then(() => 'ok', (e: { estado?: number }) => e.estado)] as const));

    expect(resultados.filter(([, resultado]) => resultado !== 403)).toEqual([]);
  });
});
