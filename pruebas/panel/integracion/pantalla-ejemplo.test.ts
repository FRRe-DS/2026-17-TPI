import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorDeApi } from '../../../panel/cliente/src/api/errores.js';
import type { ApiM2 } from '../../../panel/cliente/src/api/m2.js';
import { crearApiPanel } from '../../../panel/cliente/src/api/panel.js';
import { crearViajesSimulados } from '../../../panel/cliente/src/fuentes/viajes-simulados.js';
import { CLIENTE_DE_EJEMPLO, cuerpoDeAlta } from '../../../panel/cliente/src/logica/campos-cliente.js';
import { cargarEjemplo, PREFERENCIAS_DE_EJEMPLO, type InformeDePaso } from '../../../panel/cliente/src/logica/ejemplo.js';
import { idsDeEjemplo } from '../../../panel/m6-simulado/ids.js';
import { levantarPanelConM2, type PanelConM2 } from '../ayudas/panel-con-m2.js';

// «Cargar ejemplo» (T21, RF-2.1.10, RF-2.1.11) contra el panel de verdad: PostgreSQL, M2, el panel y el M6 simulado. Lo que
// dibuja la pantalla lo recorre la prueba en navegador (T33).

let panel: PanelConM2;
beforeAll(async () => {
  panel = await levantarPanelConM2();
});
afterAll(async () => {
  await panel?.cerrar();
});

async function clienteNuevo(): Promise<{ clienteId: string; api: ApiM2 }> {
  const clienteId = randomUUID();
  const api = panel.api(() => ({ rol: 'CLIENTE', sub: clienteId }));
  await api.crearCliente(cuerpoDeAlta(CLIENTE_DE_EJEMPLO), randomUUID());
  return { clienteId, api };
}

const estados = (pasos: InformeDePaso[]) => pasos.map((p) => `${p.id}:${p.estado}`);

describe('«Cargar ejemplo» sobre un cliente (RF-2.1.10)', () => {
  it('deja tres direcciones (una FAVORITA y dos RECIENTE), las preferencias y dos viajes en el M6', async () => {
    const { clienteId, api } = await clienteNuevo();
    let ultimo: InformeDePaso[] = [];

    const { escenarios } = await cargarEjemplo({ api, viajes: panel.viajes }, clienteId, (pasos) => (ultimo = pasos));

    expect(estados(ultimo)).toEqual(['direccion-1:hecho', 'direccion-2:hecho', 'direccion-3:hecho', 'preferencias:hecho', 'viajes:hecho']);
    const direcciones = await api.listarDirecciones(clienteId);
    expect(direcciones.totalElementos).toBe(3);
    expect(direcciones.items.map((d) => d.tipo).sort()).toEqual(['FAVORITA', 'RECIENTE', 'RECIENTE']);
    expect(await api.obtenerPreferencias(clienteId)).toMatchObject(PREFERENCIAS_DE_EJEMPLO);
    expect(panel.estadoM6.listar({ clientId: clienteId })).toHaveLength(2);
    // Los escenarios traen los ids fijos de ese cliente: el completado y el en curso, más el ajeno y el inexistente.
    const ids = idsDeEjemplo(clienteId);
    expect(escenarios.map((e) => [e.nombre, e.respuestaDeM2])).toEqual([['completado', 201], ['enCurso', 422], ['ajeno', 404], ['inexistente', 404]]);
    expect(escenarios.find((e) => e.nombre === 'completado')?.viajeId).toBe(ids.completado);
  });

  it('M2 ve los viajes del M6: el historial trae el completado y el en curso, sin calificar', async () => {
    const { clienteId, api } = await clienteNuevo();
    await cargarEjemplo({ api, viajes: panel.viajes }, clienteId, () => undefined);

    const { items } = await api.listarHistorialViajes(clienteId);

    const ids = idsDeEjemplo(clienteId);
    expect(items.map((v) => [v.viajeId, v.estado, v.calificado]).sort()).toEqual(
      [[ids.completado, 'COMPLETED', false], [ids.enCurso, 'IN_PROGRESS', false]].sort(),
    );
  });
});

describe('repetir el botón no duplica nada (RF-2.1.11)', () => {
  it('dos cargas seguidas dejan las mismas tres direcciones, las mismas preferencias y los mismos dos viajes', async () => {
    const { clienteId, api } = await clienteNuevo();

    const primera = await cargarEjemplo({ api, viajes: panel.viajes }, clienteId, () => undefined);
    const antes = await api.listarDirecciones(clienteId);
    const segunda = await cargarEjemplo({ api, viajes: panel.viajes }, clienteId, () => undefined);
    const despues = await api.listarDirecciones(clienteId);

    expect(despues.totalElementos).toBe(3);
    expect(despues.items).toEqual(antes.items);
    expect(segunda).toEqual(primera);
    expect(panel.estadoM6.listar({ clientId: clienteId })).toHaveLength(2);
    const { rows } = await panel.pool.query('SELECT count(*)::int AS n FROM direcciones_cliente WHERE cliente_id = $1', [clienteId]);
    expect(rows[0]).toEqual({ n: 3 });
  });

  it('el ejemplo de un cliente no toca a otro', async () => {
    const uno = await clienteNuevo();
    const otro = await clienteNuevo();

    await cargarEjemplo({ api: uno.api, viajes: panel.viajes }, uno.clienteId, () => undefined);

    expect((await otro.api.listarDirecciones(otro.clienteId)).totalElementos).toBe(0);
    expect(panel.estadoM6.listar({ clientId: otro.clienteId })).toHaveLength(0);
  });
});

describe('con el canal de control del M6 caído (RF-2.1.11)', () => {
  // El panel responde 502 cuando no llega al canal (probado en `m6-control.test.ts`); acá lo que importa es lo que pasa del lado
  // de M2 y de la pantalla cuando el paso de los viajes falla.
  const canalCaido = crearViajesSimulados(
    crearApiPanel({
      fetch: async () =>
        new Response(JSON.stringify({ type: '/panel/errores/m6-control-no-responde', title: 'Canal de control del M6 simulado no disponible', status: 502 }), {
          status: 502,
          headers: { 'content-type': 'application/problem+json' },
        }),
    }),
  );

  it('se cargan direcciones y preferencias, el paso de viajes falla, y reintentar completa sin duplicar', async () => {
    const { clienteId, api } = await clienteNuevo();
    let ultimo: InformeDePaso[] = [];

    const fallo = cargarEjemplo({ api, viajes: canalCaido }, clienteId, (pasos) => (ultimo = pasos));

    await expect(fallo).rejects.toBeInstanceOf(ErrorDeApi);
    await expect(fallo).rejects.toMatchObject({ estado: 502, type: '/panel/errores/m6-control-no-responde' });
    expect(estados(ultimo)).toEqual(['direccion-1:hecho', 'direccion-2:hecho', 'direccion-3:hecho', 'preferencias:hecho', 'viajes:fallido']);
    expect((await api.listarDirecciones(clienteId)).totalElementos).toBe(3);
    expect(panel.estadoM6.listar({ clientId: clienteId })).toHaveLength(0);

    // «Reintentar»: el canal vuelve y la misma carga deja todo, con las direcciones sin repetir.
    await cargarEjemplo({ api, viajes: panel.viajes }, clienteId, (pasos) => (ultimo = pasos));

    expect(estados(ultimo).every((p) => p.endsWith(':hecho'))).toBe(true);
    expect((await api.listarDirecciones(clienteId)).totalElementos).toBe(3);
    expect(panel.estadoM6.listar({ clientId: clienteId })).toHaveLength(2);
  });
});
