import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiM2 } from '../../../panel/cliente/src/api/m2.js';
import { CLIENTE_DE_EJEMPLO, cuerpoDeAlta } from '../../../panel/cliente/src/logica/campos-cliente.js';
import type { UltimoPedido } from '../../../panel/cliente/src/logica/ultimo-pedido.js';
import { levantarPanelConM2, type PanelConM2 } from '../ayudas/panel-con-m2.js';

// El detalle técnico (T31, RNF-14.9) contra el panel de verdad: lo que el cliente de M2 hace queda en `/panel/pedidos`, con el
// folio de la franja del pie, el `Authorization` enmascarado y un `curl` que no lleva el token.

let panel: PanelConM2;
beforeAll(async () => {
  panel = await levantarPanelConM2();
});
afterAll(async () => {
  await panel?.cerrar();
});

function clienteNuevo(): { clienteId: string; api: ApiM2; vistos: UltimoPedido[] } {
  const clienteId = randomUUID();
  const vistos: UltimoPedido[] = [];
  const api = panel.api(() => ({ rol: 'CLIENTE', sub: clienteId }), (pedido) => vistos.push(pedido));
  return { clienteId, api, vistos };
}

describe('los pedidos hechos desde cualquier pantalla quedan registrados (RNF-14.9)', () => {
  it('con método, ruta, código, duración y folio; el más nuevo primero', async () => {
    const { clienteId, api } = clienteNuevo();
    await api.crearCliente(cuerpoDeAlta(CLIENTE_DE_EJEMPLO), randomUUID());
    await api.obtenerCliente(clienteId);
    await api.listarDirecciones(clienteId, { page: 0, size: 5 });

    const { pedidos } = await panel.apiPanel.listarPedidos();

    expect(pedidos.slice(0, 3).map((p) => [p.metodo, p.ruta, p.estado])).toEqual([
      ['GET', `/api/v1/clientes/${clienteId}/direcciones?page=0&size=5`, 200],
      ['GET', `/api/v1/clientes/${clienteId}`, 200],
      ['POST', '/api/v1/clientes', 201],
    ]);
    for (const p of pedidos.slice(0, 3)) {
      expect(p.duracionMs).toBeGreaterThanOrEqual(0);
      expect(p.requestId).toMatch(/\S+/);
      expect(p.hora).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('el folio es el que ve la franja del pie: el X-Request-Id de la respuesta', async () => {
    const { clienteId, api, vistos } = clienteNuevo();
    await api.crearCliente(cuerpoDeAlta(CLIENTE_DE_EJEMPLO), randomUUID());
    await api.obtenerCliente(clienteId);

    const { pedidos } = await panel.apiPanel.listarPedidos();

    expect(vistos).toHaveLength(2);
    expect(vistos[1]).toMatchObject({ metodo: 'GET', estado: 200, requestId: pedidos[0]!.requestId });
    expect(vistos[0]!.requestId).toBe(pedidos[1]!.requestId);
  });

  it('un rechazo de M2 también queda, con su código', async () => {
    const { clienteId, api } = clienteNuevo();

    await expect(api.obtenerCliente(clienteId)).rejects.toMatchObject({ estado: 404 });

    expect((await panel.apiPanel.listarPedidos()).pedidos[0]).toMatchObject({ metodo: 'GET', estado: 404 });
  });

  it('un POST guarda su cuerpo y la Idempotency-Key, y el curl los repite', async () => {
    const { clienteId, api } = clienteNuevo();
    const clave = randomUUID();
    await api.crearCliente(cuerpoDeAlta(CLIENTE_DE_EJEMPLO), clave);

    const pedido = (await panel.apiPanel.listarPedidos()).pedidos[0]!;

    expect(JSON.parse(pedido.cuerpo!)).toMatchObject({ nombre: CLIENTE_DE_EJEMPLO.nombre });
    expect(pedido.encabezados).toMatchObject({ 'Idempotency-Key': clave });
    expect(pedido.curl).toContain('-X POST');
    expect(pedido.curl).toContain(`Idempotency-Key: ${clave}`);
    expect(pedido.curl).toContain("-d '");
    expect(pedido.curl).toContain("'http://localhost:8082/api/v1/clientes'");
    expect(clienteId).toBeTruthy();
  });
});

describe('el token nunca se muestra (RNF-19.3)', () => {
  it('el Authorization sale enmascarado y el curl usa $TOKEN', async () => {
    const { clienteId, api } = clienteNuevo();
    await api.obtenerCliente(clienteId).catch(() => undefined);

    const pedido = (await panel.apiPanel.listarPedidos()).pedidos[0]!;

    expect(pedido.encabezados.Authorization).toBe('Bearer ••••');
    expect(pedido.curl).toContain('"Authorization: Bearer $TOKEN"');
  });

  it('en toda la respuesta no aparece ningún JWT', async () => {
    const { clienteId, api } = clienteNuevo();
    await api.crearCliente(cuerpoDeAlta(CLIENTE_DE_EJEMPLO), randomUUID());
    await api.obtenerCliente(clienteId);

    const { pedidos } = await panel.apiPanel.listarPedidos();

    expect(JSON.stringify(pedidos)).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./);
  });
});

describe('los últimos 50', () => {
  it('con 60 pedidos más, la lista tiene 50 y el último hecho va primero; pedir la lista no se agrega', async () => {
    const { clienteId, api } = clienteNuevo();
    for (let i = 0; i < 60; i++) await api.obtenerCliente(clienteId).catch(() => undefined);
    await api.listarDirecciones(clienteId).catch(() => undefined);

    const primera = (await panel.apiPanel.listarPedidos()).pedidos;
    const segunda = (await panel.apiPanel.listarPedidos()).pedidos;

    expect(primera).toHaveLength(50);
    expect(primera[0]!.ruta).toBe(`/api/v1/clientes/${clienteId}/direcciones`);
    expect(segunda).toEqual(primera);
  });
});
