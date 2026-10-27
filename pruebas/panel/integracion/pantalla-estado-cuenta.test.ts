import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiM2 } from '../../../panel/cliente/src/api/m2.js';
import { FichaDeCuenta } from '../../../panel/cliente/src/componentes/ficha-de-cuenta.js';
import { CLIENTE_DE_EJEMPLO, cuerpoDeAlta } from '../../../panel/cliente/src/logica/campos-cliente.js';
import { cargarEjemplo } from '../../../panel/cliente/src/logica/ejemplo.js';
import { levantarPanelConM2, type PanelConM2 } from '../ayudas/panel-con-m2.js';

// La pantalla `estado-cuenta` del cliente (T28, RF-2.6.5) contra el panel de verdad: PostgreSQL, M2 y el servidor del panel. El
// operador bloquea con su propio cliente de M2, como lo hará T29.

let panel: PanelConM2;
beforeAll(async () => {
  panel = await levantarPanelConM2();
});
afterAll(async () => {
  await panel?.cerrar();
});

const OPERADOR = 'operador-de-prueba';

async function clienteNuevo(): Promise<{ clienteId: string; api: ApiM2; operador: ApiM2 }> {
  const clienteId = randomUUID();
  const api = panel.api(() => ({ rol: 'CLIENTE', sub: clienteId }));
  await api.crearCliente(cuerpoDeAlta(CLIENTE_DE_EJEMPLO), randomUUID());
  return { clienteId, api, operador: panel.api(() => ({ rol: 'OPERADOR', sub: OPERADOR })) };
}

describe('el estado de cuenta del cliente (RF-2.6.5)', () => {
  it('un cliente nuevo está activo y sin bloqueos', async () => {
    const { clienteId, api } = await clienteNuevo();

    const cuenta = await api.obtenerEstadoCuenta(clienteId);

    expect(cuenta).toEqual({ clienteId, estado: 'ACTIVO', bloqueosVigentes: [] });
    const html = renderToStaticMarkup(createElement(FichaDeCuenta, { cuenta }));
    expect(html).toContain('ACTIVO');
    expect(html).toContain('Activo: puede solicitar viajes.');
    expect(html).toContain('No hay bloqueos vigentes.');
  });

  it('con un bloqueo vigente está bloqueado, y la ficha lo dice con palabras y muestra el motivo', async () => {
    const { clienteId, api, operador } = await clienteNuevo();
    await operador.crearBloqueo(clienteId, { motivo: 'Pagos pendientes' }, randomUUID());

    const cuenta = await api.obtenerEstadoCuenta(clienteId);

    expect(cuenta.estado).toBe('BLOQUEADO');
    expect(cuenta.bloqueosVigentes).toHaveLength(1);
    const html = renderToStaticMarkup(createElement(FichaDeCuenta, { cuenta }));
    expect(html).toContain('BLOQUEADO');
    expect(html).toContain('Bloqueado: no puede solicitar viajes');
    expect(html).toContain('Pagos pendientes');
    expect(html).toContain('Hasta que se levante');
    expect(html).toContain(OPERADOR);
  });

  it('un bloqueo con fecha de fin la muestra', async () => {
    const { clienteId, api, operador } = await clienteNuevo();
    const hasta = new Date(Date.now() + 86_400_000).toISOString();
    await operador.crearBloqueo(clienteId, { motivo: 'Revisión', hasta }, randomUUID());

    const html = renderToStaticMarkup(createElement(FichaDeCuenta, { cuenta: await api.obtenerEstadoCuenta(clienteId) }));

    expect(html).toContain(`Hasta ${hasta.slice(0, 10)} ${hasta.slice(11, 19)} (UTC)`);
  });

  it('dos bloqueos vigentes se listan los dos; al levantar uno sigue bloqueado, al levantar el otro vuelve a activo', async () => {
    const { clienteId, api, operador } = await clienteNuevo();
    const uno = await operador.crearBloqueo(clienteId, { motivo: 'Primero' }, randomUUID());
    const dos = await operador.crearBloqueo(clienteId, { motivo: 'Segundo' }, randomUUID());
    expect((await api.obtenerEstadoCuenta(clienteId)).bloqueosVigentes).toHaveLength(2);

    await operador.levantarBloqueo(clienteId, uno.bloqueoId, { motivo: 'Resuelto' });
    expect(await api.obtenerEstadoCuenta(clienteId)).toMatchObject({ estado: 'BLOQUEADO', bloqueosVigentes: [{ bloqueoId: dos.bloqueoId }] });

    await operador.levantarBloqueo(clienteId, dos.bloqueoId, { motivo: 'Resuelto' });
    expect(await api.obtenerEstadoCuenta(clienteId)).toEqual({ clienteId, estado: 'ACTIVO', bloqueosVigentes: [] });
  });

  it('un cliente bloqueado sigue pudiendo ver todas sus pantallas', async () => {
    const { clienteId, api, operador } = await clienteNuevo();
    await cargarEjemplo({ api, viajes: panel.viajes }, clienteId, () => undefined);
    await operador.crearBloqueo(clienteId, { motivo: 'Fraude' }, randomUUID());

    expect((await api.obtenerEstadoCuenta(clienteId)).estado).toBe('BLOQUEADO');
    expect((await api.obtenerCliente(clienteId)).estado).toBe('BLOQUEADO');
    expect((await api.listarDirecciones(clienteId)).totalElementos).toBe(3);
    expect((await api.obtenerPreferencias(clienteId)).canales).toEqual(['EMAIL', 'PUSH']);
    expect((await api.listarHistorialViajes(clienteId)).totalElementos).toBe(2);
    expect((await api.listarCalificaciones(clienteId)).totalElementos).toBe(0);
  });

  it('un cliente no ve el estado de cuenta de otro (403) y no puede bloquearse ni bloquear', async () => {
    const uno = await clienteNuevo();
    const otro = await clienteNuevo();

    await expect(otro.api.obtenerEstadoCuenta(uno.clienteId)).rejects.toMatchObject({ estado: 403 });
    await expect(uno.api.crearBloqueo(uno.clienteId, { motivo: 'Yo' }, randomUUID())).rejects.toMatchObject({ estado: 403 });
  });

  it('un cliente sin perfil recibe 404', async () => {
    const clienteId = randomUUID();
    const api = panel.api(() => ({ rol: 'CLIENTE', sub: clienteId }));

    await expect(api.obtenerEstadoCuenta(clienteId)).rejects.toMatchObject({ estado: 404 });
  });
});
