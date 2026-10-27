import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ErrorDeApi } from '../../../panel/cliente/src/api/errores.js';
import type { ApiM2 } from '../../../panel/cliente/src/api/m2.js';
import { DependenciaNoDisponible } from '../../../panel/cliente/src/componentes/dependencia-no-disponible.js';
import { CLIENTE_DE_EJEMPLO, cuerpoDeAlta } from '../../../panel/cliente/src/logica/campos-cliente.js';
import { cargarEjemplo } from '../../../panel/cliente/src/logica/ejemplo.js';
import { segundosDeCuenta } from '../../../panel/cliente/src/logica/cuenta-regresiva.js';
import { sePuedeCalificar } from '../../../panel/cliente/src/logica/historial.js';
import { FilaDeViaje } from '../../../panel/cliente/src/pantallas/historial.js';
import { idsDeEjemplo } from '../../../panel/m6-simulado/ids.js';
import { levantarPanelConM2, REINTENTAR_DESPUES_S, type PanelConM2 } from '../ayudas/panel-con-m2.js';

// La pantalla `historial` (T25, RF-2.4.12, RF-2.4.13) contra el panel de verdad: PostgreSQL, M2, el panel y el M6 simulado, también
// en modo `caido` y `lento`. Lo que se dibuja en el navegador lo recorre la prueba en navegador (T33).

let panel: PanelConM2;
beforeAll(async () => {
  panel = await levantarPanelConM2();
});
afterEach(async () => {
  await panel.ponerModo('normal');
});
afterAll(async () => {
  await panel?.cerrar();
});

async function clienteConEjemplo(): Promise<{ clienteId: string; api: ApiM2 }> {
  const clienteId = randomUUID();
  const api = panel.api(() => ({ rol: 'CLIENTE', sub: clienteId }));
  await api.crearCliente(cuerpoDeAlta(CLIENTE_DE_EJEMPLO), randomUUID());
  await cargarEjemplo({ api, viajes: panel.viajes }, clienteId, () => undefined);
  return { clienteId, api };
}

const enlaceDeCalificar = (viajeId: string) => `href="#/calificar/${viajeId}"`;

describe('el historial con estado y «calificado» (RF-2.4.12)', () => {
  it('el completado se ofrece para calificar y el en curso no', async () => {
    const { clienteId, api } = await clienteConEjemplo();
    const ids = idsDeEjemplo(clienteId);

    const { items } = await api.listarHistorialViajes(clienteId);
    const html = (viajeId: string) => renderToStaticMarkup(createElement(FilaDeViaje, { viaje: items.find((v) => v.viajeId === viajeId)! }));

    expect(items).toHaveLength(2);
    expect(html(ids.completado)).toContain(enlaceDeCalificar(ids.completado));
    expect(html(ids.completado)).toContain('Completado');
    expect(html(ids.completado)).toContain('Sin calificar');
    expect(html(ids.enCurso)).not.toContain('href=');
    expect(html(ids.enCurso)).toContain('En curso');
  });

  it('tras calificar, el viaje figura como calificado y ya no se ofrece', async () => {
    const { clienteId, api } = await clienteConEjemplo();
    const ids = idsDeEjemplo(clienteId);

    await api.calificarConductor(clienteId, { viajeId: ids.completado, puntaje: 5 }, randomUUID());
    const { items } = await api.listarHistorialViajes(clienteId);

    const completado = items.find((v) => v.viajeId === ids.completado)!;
    expect(completado.calificado).toBe(true);
    expect(sePuedeCalificar(completado)).toBe(false);
    const html = renderToStaticMarkup(createElement(FilaDeViaje, { viaje: completado }));
    expect(html).toContain('Calificado');
    expect(html).not.toContain('href=');
  });

  it('un cliente sin viajes recibe una página vacía', async () => {
    const clienteId = randomUUID();
    const api = panel.api(() => ({ rol: 'CLIENTE', sub: clienteId }));
    await api.crearCliente(cuerpoDeAlta(CLIENTE_DE_EJEMPLO), randomUUID());

    const pagina = await api.listarHistorialViajes(clienteId);

    expect(pagina).toMatchObject({ items: [], totalElementos: 0 });
  });

  it('pide de a una página: con tamaño 1 hay dos páginas', async () => {
    const { clienteId, api } = await clienteConEjemplo();

    const primera = await api.listarHistorialViajes(clienteId, { page: 0, size: 1 });
    const segunda = await api.listarHistorialViajes(clienteId, { page: 1, size: 1 });

    expect([primera.totalPaginas, primera.items.length, segunda.items.length]).toEqual([2, 1, 1]);
    expect(primera.items[0]?.viajeId).not.toBe(segunda.items[0]?.viajeId);
  });

  it('un cliente no ve el historial de otro (403)', async () => {
    const uno = await clienteConEjemplo();
    const otro = await clienteConEjemplo();

    await expect(otro.api.listarHistorialViajes(uno.clienteId)).rejects.toMatchObject({ estado: 403 });
  });
});

describe.each([['caido' as const], ['lento' as const]])('con el M6 simulado en modo %s (RF-2.4.13)', (modo) => {
  async function fallo(): Promise<ErrorDeApi> {
    const { clienteId, api } = await clienteConEjemplo();
    await panel.ponerModo(modo);
    const error = await api.listarHistorialViajes(clienteId).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ErrorDeApi);
    return error as ErrorDeApi;
  }

  it('M2 responde 503 con los segundos de Retry-After, y el panel los toma para la cuenta', async () => {
    const error = await fallo();

    expect(error).toMatchObject({ estado: 503, sinRespuesta: false, reintentarEnS: REINTENTAR_DESPUES_S });
    expect(segundosDeCuenta(error)).toBe(REINTENTAR_DESPUES_S);
  });

  it('la pantalla explica que depende del módulo de viajes, cuenta los segundos y ofrece «Reintentar»', async () => {
    const error = await fallo();

    const html = renderToStaticMarkup(createElement(DependenciaNoDisponible, { error, que: 'El historial', alReintentar: () => undefined }));

    expect(html).toContain('El historial depende del módulo de viajes (M6)');
    expect(html).toContain(`Podés reintentar en ${REINTENTAR_DESPUES_S} s.`);
    expect(html).toContain('role="timer"');
    expect(html).toContain('Reintentar');
    expect(html).toContain(error.title);
    expect(html).toContain('503');
  });

  it('al volver el M6, el mismo pedido trae el historial', async () => {
    const { clienteId, api } = await clienteConEjemplo();
    await panel.ponerModo(modo);
    await expect(api.listarHistorialViajes(clienteId)).rejects.toMatchObject({ estado: 503 });

    await panel.ponerModo('normal');

    expect((await api.listarHistorialViajes(clienteId)).totalElementos).toBe(2);
  });

  it('el resto de las pantallas sigue andando: el perfil y las direcciones responden', async () => {
    const { clienteId, api } = await clienteConEjemplo();
    await panel.ponerModo(modo);

    expect((await api.obtenerCliente(clienteId)).clienteId).toBe(clienteId);
    expect((await api.listarDirecciones(clienteId)).totalElementos).toBe(3);
    expect(await api.obtenerPreferencias(clienteId)).toBeDefined();
  });
});

describe('DependenciaNoDisponible sin Retry-After', () => {
  it('explica y ofrece «Reintentar», sin cuenta', () => {
    const error = new ErrorDeApi({ sinRespuesta: false, estado: 503, type: '/errores/dependencia-no-disponible', title: 'Dependencia no disponible' });

    const html = renderToStaticMarkup(createElement(DependenciaNoDisponible, { error, que: 'El historial', alReintentar: () => undefined }));

    expect(html).toContain('depende del módulo de viajes');
    expect(html).not.toContain('role="timer"');
    expect(html).toContain('Reintentar');
  });
});
