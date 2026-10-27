import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorDeApi } from '../../../panel/cliente/src/api/errores.js';
import type { ApiM2 } from '../../../panel/cliente/src/api/m2.js';
import { calcularCambios, camposDePerfil, guardarCambios, validarEdicion } from '../../../panel/cliente/src/logica/cambios.js';
import { CLIENTE_DE_EJEMPLO, cuerpoDeAlta } from '../../../panel/cliente/src/logica/campos-cliente.js';
import { levantarPanelConM2, type PanelConM2 } from '../ayudas/panel-con-m2.js';

// La pantalla `perfil` (T20, RF-2.1.8, RF-2.1.9) contra el panel de verdad: PostgreSQL real, M2 y el servidor del panel. Lo que
// hace la pantalla está en `logica/cambios.ts`; lo que se dibuja lo recorre la prueba en navegador (T33).

let panel: PanelConM2;
beforeAll(async () => {
  panel = await levantarPanelConM2();
});
afterAll(async () => {
  await panel?.cerrar();
});

// Un cliente que ya entró: su perfil existe y las pantallas piden como él.
async function clienteExistente(): Promise<{ clienteId: string; api: ApiM2 }> {
  const clienteId = randomUUID();
  const api = panel.api(() => ({ rol: 'CLIENTE', sub: clienteId }));
  await api.crearCliente(cuerpoDeAlta(CLIENTE_DE_EJEMPLO), randomUUID());
  return { clienteId, api };
}

describe('ver el perfil (RF-2.1.8)', () => {
  it('obtenerCliente trae lo que se creó, con su estado y sus fechas', async () => {
    const { clienteId, api } = await clienteExistente();

    const perfil = await api.obtenerCliente(clienteId);

    expect(perfil).toMatchObject({ clienteId, ...cuerpoDeAlta(CLIENTE_DE_EJEMPLO), estado: 'ACTIVO' });
    expect(perfil.creadoEn).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(camposDePerfil(perfil)).toEqual(CLIENTE_DE_EJEMPLO);
  });

  it('un cliente que no existe es un 404', async () => {
    const otro = randomUUID();
    const api = panel.api(() => ({ rol: 'CLIENTE', sub: otro }));

    await expect(api.obtenerCliente(otro)).rejects.toMatchObject({ estado: 404 });
  });

  it('otro CLIENTE no ve el perfil ajeno', async () => {
    const { clienteId } = await clienteExistente();
    const intruso = panel.api(() => ({ rol: 'CLIENTE', sub: randomUUID() }));

    await expect(intruso.obtenerCliente(clienteId)).rejects.toBeInstanceOf(ErrorDeApi);
  });

  it('el CONDUCTOR entra al perfil y ve el error de M2, no uno del panel', async () => {
    const conductor = panel.api(() => ({ rol: 'CONDUCTOR', sub: 'conductor-1' }));

    const error = await conductor.obtenerCliente('conductor-1').catch((e: ErrorDeApi) => e);

    expect(error).toBeInstanceOf(ErrorDeApi);
    expect(error).toMatchObject({ sinRespuesta: false });
    expect([400, 403]).toContain((error as ErrorDeApi).estado);
  });
});

describe('guardar solo lo que cambió (RF-2.1.8)', () => {
  it('cambiar el teléfono guarda ese campo y deja los demás; M2 devuelve el perfil nuevo', async () => {
    const { clienteId, api } = await clienteExistente();
    const antes = await api.obtenerCliente(clienteId);

    const resultado = await guardarCambios(api, antes, { ...camposDePerfil(antes), telefono: '+5491100000000' });

    expect(resultado).toMatchObject({ tipo: 'guardado', perfil: { nombre: 'Ana', apellido: 'Gómez', telefono: '+5491100000000', fechaNacimiento: '1990-05-14' } });
    expect(await api.obtenerCliente(clienteId)).toEqual((resultado as { perfil: unknown }).perfil);
  });

  it('cambiar dos campos guarda los dos', async () => {
    const { clienteId, api } = await clienteExistente();
    const antes = await api.obtenerCliente(clienteId);

    await guardarCambios(api, antes, { ...camposDePerfil(antes), nombre: ' Beatriz ', fechaNacimiento: '1985-12-31' });

    expect(await api.obtenerCliente(clienteId)).toMatchObject({ nombre: 'Beatriz', apellido: 'Gómez', fechaNacimiento: '1985-12-31' });
  });

  it('sin cambios no hay pedido: el perfil queda igual, también su `actualizadoEn`', async () => {
    const { clienteId, api } = await clienteExistente();
    const antes = await api.obtenerCliente(clienteId);

    expect(await guardarCambios(api, antes, camposDePerfil(antes))).toEqual({ tipo: 'sin-cambios' });

    expect(await api.obtenerCliente(clienteId)).toEqual(antes);
  });

  it('completar la fecha de un perfil que no la tenía', async () => {
    const clienteId = randomUUID();
    const api = panel.api(() => ({ rol: 'CLIENTE', sub: clienteId }));
    await api.crearCliente(cuerpoDeAlta({ ...CLIENTE_DE_EJEMPLO, fechaNacimiento: '' }), randomUUID());
    const antes = await api.obtenerCliente(clienteId);
    expect(antes).not.toHaveProperty('fechaNacimiento');

    await guardarCambios(api, antes, { ...camposDePerfil(antes), fechaNacimiento: '2000-02-29' });

    expect(await api.obtenerCliente(clienteId)).toMatchObject({ fechaNacimiento: '2000-02-29' });
  });
});

describe('un 400 de M2 al guardar (RF-2.1.9)', () => {
  it('trae el `detail` del problema y lo guardado antes no cambia', async () => {
    const { clienteId, api } = await clienteExistente();
    const antes = await api.obtenerCliente(clienteId);
    // El panel ya marca el año 0000 antes de enviar: se lo manda igual para ver el rechazo de M2.
    const escrito = { ...camposDePerfil(antes), nombre: 'Beatriz', fechaNacimiento: '0000-06-15' };
    expect(validarEdicion(antes, escrito)).toHaveProperty('fechaNacimiento');
    expect(calcularCambios(antes, escrito)).toEqual({ nombre: 'Beatriz', fechaNacimiento: '0000-06-15' });

    const error = await guardarCambios(api, antes, escrito).catch((e: ErrorDeApi) => e);

    expect(error).toBeInstanceOf(ErrorDeApi);
    expect(error).toMatchObject({ estado: 400, sinRespuesta: false });
    expect((error as ErrorDeApi).detail).toMatch(/fecha de nacimiento/i);
    expect(await api.obtenerCliente(clienteId)).toEqual(antes);
  });

  it('también con un teléfono que el contrato rechaza', async () => {
    const { clienteId, api } = await clienteExistente();
    const antes = await api.obtenerCliente(clienteId);

    const error = await guardarCambios(api, antes, { ...camposDePerfil(antes), telefono: '5493624000000' }).catch((e: ErrorDeApi) => e);

    expect(error).toMatchObject({ estado: 400 });
    expect((error as ErrorDeApi).detail).toBeTruthy();
  });
});
