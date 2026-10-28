import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ApiM2 } from '../../../panel/cliente/src/api/m2.js';
import { CLIENTE_DE_EJEMPLO, cuerpoDeAlta } from '../../../panel/cliente/src/logica/campos-cliente.js';
import { crearConfirmacion } from '../../../panel/cliente/src/logica/confirmacion.js';
import { cuerpoDeDireccion, DIRECCION_NUEVA } from '../../../panel/cliente/src/logica/direcciones.js';
import { levantarPanelConM2, type PanelConM2 } from '../ayudas/panel-con-m2.js';

// «Eliminar» una dirección con confirmación (T23, RF-2.2.7) contra el panel de verdad: PostgreSQL real, M2 y el servidor del panel.
// La confirmación es la de la pantalla (`crearConfirmacion`) y el pedido es `eliminarDireccion` de M2. Lo que se dibuja (el diálogo,
// el foco, Escape) lo recorre la prueba en navegador (T34).

let panel: PanelConM2;
beforeAll(async () => {
  panel = await levantarPanelConM2();
});
afterAll(async () => {
  await panel?.cerrar();
});

type Direccion = Awaited<ReturnType<ApiM2['crearDireccion']>>;

// Un cliente con tres direcciones, y la confirmación armada como la pantalla de direcciones. `eliminar` cuenta los pedidos a M2.
async function conTresDirecciones() {
  const clienteId = randomUUID();
  const api = panel.api(() => ({ rol: 'CLIENTE', sub: clienteId }));
  await api.crearCliente(cuerpoDeAlta(CLIENTE_DE_EJEMPLO), randomUUID());
  const direcciones: Direccion[] = [];
  for (const n of [1, 2, 3]) direcciones.push(await api.crearDireccion(clienteId, cuerpoDeDireccion({ ...DIRECCION_NUEVA, texto: `Calle ${n}` }), randomUUID()));
  const eliminar = vi.fn((direccion: Direccion, senal: AbortSignal) => api.eliminarDireccion(clienteId, direccion.direccionId, { senal }));
  const confirmacion = crearConfirmacion<Direccion, void>({ ejecutar: eliminar, aviso: 'Dirección eliminada.' });
  const textos = async () => (await api.listarDirecciones(clienteId)).items.map((d) => d.texto).sort();
  return { clienteId, api, direcciones, eliminar, confirmacion, textos };
}

describe('«Cancelar» no hace ningún pedido y la dirección sigue en la lista (RF-2.2.7)', () => {
  it('pedir la confirmación y cancelar deja las tres direcciones, sin ningún pedido a M2', async () => {
    const { direcciones, eliminar, confirmacion, textos } = await conTresDirecciones();

    confirmacion.pedir(direcciones[1]!);
    expect(confirmacion.estado().objetivo).toBe(direcciones[1]);
    confirmacion.cancelar();

    expect(eliminar).not.toHaveBeenCalled();
    expect(await textos()).toEqual(['Calle 1', 'Calle 2', 'Calle 3']);
    const { rows } = await panel.pool.query('SELECT count(*)::int AS n FROM direcciones_cliente WHERE direccion_id = $1', [direcciones[1]!.direccionId]);
    expect(rows[0]).toEqual({ n: 1 });
  });

  it('cancelar y volver a pedir otra no arrastra nada de la anterior', async () => {
    const { direcciones, eliminar, confirmacion, textos } = await conTresDirecciones();

    confirmacion.pedir(direcciones[0]!);
    confirmacion.cancelar();
    confirmacion.pedir(direcciones[2]!);
    await confirmacion.confirmar();

    expect(eliminar).toHaveBeenCalledExactlyOnceWith(direcciones[2], expect.any(AbortSignal));
    expect(await textos()).toEqual(['Calle 1', 'Calle 2']);
  });
});

describe('«Eliminar» solo llama a M2 al confirmar (RF-2.2.7)', () => {
  it('confirmar borra esa dirección y las otras quedan; el aviso dice lo que se hizo', async () => {
    const { clienteId, api, direcciones, eliminar, confirmacion, textos } = await conTresDirecciones();

    confirmacion.pedir(direcciones[1]!);
    expect(eliminar).not.toHaveBeenCalled();
    await confirmacion.confirmar();

    expect(eliminar).toHaveBeenCalledOnce();
    expect(await textos()).toEqual(['Calle 1', 'Calle 3']);
    await expect(api.obtenerDireccion(clienteId, direcciones[1]!.direccionId)).rejects.toMatchObject({ estado: 404 });
    expect(confirmacion.estado()).toMatchObject({ objetivo: undefined, accion: { fase: 'hecha', aviso: 'Dirección eliminada.' } });
    expect((await api.listarDirecciones(clienteId)).totalElementos).toBe(2);
  });

  it('un doble clic en «Eliminar» manda un solo pedido', async () => {
    const { direcciones, eliminar, confirmacion } = await conTresDirecciones();
    confirmacion.pedir(direcciones[0]!);

    await Promise.all([confirmacion.confirmar(), confirmacion.confirmar()]);

    expect(eliminar).toHaveBeenCalledOnce();
  });

  it('borrar las tres deja la lista vacía', async () => {
    const { api, clienteId, direcciones, confirmacion } = await conTresDirecciones();

    for (const direccion of direcciones) {
      confirmacion.pedir(direccion);
      await confirmacion.confirmar();
    }

    expect(await api.listarDirecciones(clienteId)).toMatchObject({ items: [], totalElementos: 0 });
  });
});

describe('si M2 rechaza el borrado', () => {
  it('una dirección que ya no existe: el diálogo queda abierto con el 404 de M2, sin tocar las demás, y se puede cancelar', async () => {
    const { api, clienteId, direcciones, confirmacion, textos } = await conTresDirecciones();
    await api.eliminarDireccion(clienteId, direcciones[0]!.direccionId);

    confirmacion.pedir(direcciones[0]!);
    await confirmacion.confirmar();

    expect(confirmacion.estado().objetivo).toBe(direcciones[0]);
    expect(confirmacion.estado().accion).toMatchObject({ fase: 'fallida', error: { estado: 404, sinRespuesta: false } });
    expect(await textos()).toEqual(['Calle 2', 'Calle 3']);

    confirmacion.cancelar();
    expect(confirmacion.estado()).toEqual({ objetivo: undefined, accion: { fase: 'inactiva' } });
  });

  it('la dirección de otro cliente es un 404 y a su dueño no le pasa nada', async () => {
    const mia = await conTresDirecciones();
    const ajena = await conTresDirecciones();

    mia.confirmacion.pedir(ajena.direcciones[0]!);
    await mia.confirmacion.confirmar();

    expect(mia.confirmacion.estado().accion).toMatchObject({ fase: 'fallida', error: { estado: 404 } });
    expect(await ajena.textos()).toEqual(['Calle 1', 'Calle 2', 'Calle 3']);
  });
});
