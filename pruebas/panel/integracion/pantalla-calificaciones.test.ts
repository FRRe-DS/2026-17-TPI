import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorDeApi } from '../../../panel/cliente/src/api/errores.js';
import type { ApiM2 } from '../../../panel/cliente/src/api/m2.js';
import { ErrorDeM2 } from '../../../panel/cliente/src/componentes/error-de-m2.js';
import { cuerpoDeCalificacion } from '../../../panel/cliente/src/logica/calificacion.js';
import { mensajeDeDetalle } from '../../../panel/cliente/src/logica/calificaciones.js';
import { CLIENTE_DE_EJEMPLO, cuerpoDeAlta } from '../../../panel/cliente/src/logica/campos-cliente.js';
import { cargarEjemplo } from '../../../panel/cliente/src/logica/ejemplo.js';
import { derivarUuid, idsDeEjemplo } from '../../../panel/m6-simulado/ids.js';
import { levantarPanelConM2, type PanelConM2 } from '../ayudas/panel-con-m2.js';

// «Mis calificaciones» (T27, RF-2.5.17) contra el panel de verdad: PostgreSQL, M2, el panel y el M6 simulado. Lo que se dibuja en el
// navegador lo recorre la prueba en navegador (T33).

let panel: PanelConM2;
beforeAll(async () => {
  panel = await levantarPanelConM2();
});
afterAll(async () => {
  await panel?.cerrar();
});

// Un cliente con `cuantos` viajes completados en el M6 simulado, todos calificados con `puntaje` = su número (1 a 5).
async function clienteConCalificaciones(cuantos: number): Promise<{ clienteId: string; api: ApiM2; ids: string[] }> {
  const clienteId = randomUUID();
  const api = panel.api(() => ({ rol: 'CLIENTE', sub: clienteId }));
  await api.crearCliente(cuerpoDeAlta(CLIENTE_DE_EJEMPLO), randomUUID());
  await cargarEjemplo({ api, viajes: panel.viajes }, clienteId, () => undefined);
  const plantilla = panel.estadoM6.buscar(idsDeEjemplo(clienteId).completado)!;
  const ids: string[] = [];
  for (let n = 1; n <= cuantos; n++) {
    const viaje = { ...plantilla, id: derivarUuid(`prueba|${clienteId}|${n}`), createdAt: `2026-10-0${n}T10:00:00.000Z` };
    panel.estadoM6.guardar(viaje);
    const creada = await api.calificarConductor(clienteId, cuerpoDeCalificacion(viaje.id, { puntaje: String(n), comentario: `Viaje ${n}` }), randomUUID());
    ids.push(creada.calificacionId);
  }
  return { clienteId, api, ids };
}

describe('la lista de mis calificaciones (RF-2.5.17)', () => {
  it('sin calificaciones, la lista viene vacía', async () => {
    const { clienteId, api } = await clienteConCalificaciones(0);

    expect(await api.listarCalificaciones(clienteId)).toMatchObject({ items: [], totalElementos: 0, totalPaginas: 0 });
  });

  it('trae las del cliente con puntaje, comentario y viaje, paginadas de a dos', async () => {
    const { clienteId, api, ids } = await clienteConCalificaciones(3);

    const primera = await api.listarCalificaciones(clienteId, { page: 0, size: 2 });
    const segunda = await api.listarCalificaciones(clienteId, { page: 1, size: 2 });

    expect([primera.totalElementos, primera.totalPaginas, primera.items.length, segunda.items.length]).toEqual([3, 2, 2, 1]);
    const todas = [...primera.items, ...segunda.items];
    expect(todas.map((c) => c.calificacionId).sort()).toEqual([...ids].sort());
    expect(new Set(todas.map((c) => c.calificacionId)).size).toBe(3);
    expect(todas.map((c) => [c.puntaje, c.comentario]).sort()).toEqual([[1, 'Viaje 1'], [2, 'Viaje 2'], [3, 'Viaje 3']]);
  });

  it('no trae las de otro cliente', async () => {
    const uno = await clienteConCalificaciones(2);
    const otro = await clienteConCalificaciones(1);

    const lista = await otro.api.listarCalificaciones(otro.clienteId);

    expect(lista.items.map((c) => c.calificacionId)).toEqual(otro.ids);
    expect(lista.items.map((c) => c.calificacionId)).not.toContain(uno.ids[0]);
  });

  it('pedir la lista de otro cliente es 403', async () => {
    const uno = await clienteConCalificaciones(1);
    const otro = await clienteConCalificaciones(0);

    await expect(otro.api.listarCalificaciones(uno.clienteId)).rejects.toMatchObject({ estado: 403 });
  });
});

describe('el detalle de una calificación (RF-2.5.17)', () => {
  it('la propia: todos sus datos, iguales a los de la lista', async () => {
    const { clienteId, api, ids } = await clienteConCalificaciones(2);

    const detalle = await api.obtenerCalificacion(clienteId, ids[1]!);

    expect(detalle).toMatchObject({ calificacionId: ids[1], puntaje: 2, comentario: 'Viaje 2' });
    expect(detalle.viajeId).toBeTruthy();
    expect(detalle.conductorId).toBeTruthy();
    expect((await api.listarCalificaciones(clienteId)).items).toContainEqual(detalle);
  });

  async function rechazo(promesa: Promise<unknown>): Promise<ErrorDeApi> {
    const error = await promesa.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ErrorDeApi);
    return error as ErrorDeApi;
  }

  it('la de otra persona pedida con el propio cliente: 404, se muestra como «no encontrada»', async () => {
    const uno = await clienteConCalificaciones(1);
    const otro = await clienteConCalificaciones(0);

    const error = await rechazo(otro.api.obtenerCalificacion(otro.clienteId, uno.ids[0]!));

    expect(error.estado).toBe(404);
    expect(mensajeDeDetalle(error)).toBe('Calificación no encontrada.');
  });

  it('la de otra persona pedida con el cliente de ella: 403, sin frase propia', async () => {
    const uno = await clienteConCalificaciones(1);
    const otro = await clienteConCalificaciones(0);

    const error = await rechazo(otro.api.obtenerCalificacion(uno.clienteId, uno.ids[0]!));

    expect(error.estado).toBe(403);
    expect(mensajeDeDetalle(error)).toBeUndefined();
  });

  it('una que no existe: 404 igual que la ajena, sin distinguirlas', async () => {
    const { clienteId, api } = await clienteConCalificaciones(1);

    const error = await rechazo(api.obtenerCalificacion(clienteId, randomUUID()));

    expect(error.estado).toBe(404);
    expect(mensajeDeDetalle(error)).toBe('Calificación no encontrada.');
  });

  it('el error del 404 se dibuja con la frase primero, el error de M2 completo y sin «Reintentar»', async () => {
    const { clienteId, api } = await clienteConCalificaciones(0);
    const error = await rechazo(api.obtenerCalificacion(clienteId, randomUUID()));

    const html = renderToStaticMarkup(createElement(ErrorDeM2, { error, mensaje: mensajeDeDetalle(error) }));

    expect(html.indexOf('Calificación no encontrada.')).toBeLessThan(html.indexOf(error.title));
    expect(html).toContain('404');
    expect(html).not.toContain('Reintentar');
  });
});
