import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorDeApi } from '../../../panel/cliente/src/api/errores.js';
import type { ApiM2 } from '../../../panel/cliente/src/api/m2.js';
import { CLIENTE_DE_EJEMPLO, cuerpoDeAlta } from '../../../panel/cliente/src/logica/campos-cliente.js';
import {
  alternarOpcion,
  CANALES,
  camposDePreferencias,
  cuerpoDePreferencias,
  NECESIDADES_DE_ACCESIBILIDAD,
  TIPOS_DE_VEHICULO,
  validarPreferencias,
  type CamposPreferencias,
} from '../../../panel/cliente/src/logica/preferencias.js';
import { levantarPanelConM2, type PanelConM2 } from '../ayudas/panel-con-m2.js';

// La pantalla `preferencias` (T24, RF-2.3.6) contra el panel de verdad: PostgreSQL real, M2 y el servidor del panel. Lo que se
// dibuja (las casillas) lo recorre la prueba en navegador (T33).

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

describe('ver las preferencias (RF-2.3.6)', () => {
  it('un cliente que nunca las guardó las ve vacías: el formulario abre sin nada marcado', async () => {
    const { clienteId, api } = await clienteNuevo();

    const campos = camposDePreferencias(await api.obtenerPreferencias(clienteId));

    expect(campos).toEqual({ tiposVehiculo: [], canales: [], accesibilidad: [], observaciones: '' });
  });
});

describe('guardar y volver a leer (RF-2.3.6)', () => {
  it('lo guardado se vuelve a leer igual, con todos los grupos', async () => {
    const { clienteId, api } = await clienteNuevo();
    const campos: CamposPreferencias = {
      tiposVehiculo: ['AUTO', 'MOTO'],
      canales: ['EMAIL', 'SMS'],
      accesibilidad: ['SILLA_DE_RUEDAS', 'ANIMAL_DE_ASISTENCIA'],
      observaciones: 'Necesito rampa y tiempo para subir',
    };

    const devuelto = await api.guardarPreferencias(clienteId, cuerpoDePreferencias(campos));

    expect(camposDePreferencias(devuelto)).toEqual(campos);
    expect(camposDePreferencias(await api.obtenerPreferencias(clienteId))).toEqual(campos);
  });

  it('cada valor que ofrece la pantalla lo acepta M2', async () => {
    const { clienteId, api } = await clienteNuevo();
    const todo: CamposPreferencias = {
      tiposVehiculo: TIPOS_DE_VEHICULO.map((o) => o.valor),
      canales: CANALES.map((o) => o.valor),
      accesibilidad: NECESIDADES_DE_ACCESIBILIDAD.map((o) => o.valor),
      observaciones: '',
    };

    await api.guardarPreferencias(clienteId, cuerpoDePreferencias(todo));

    expect(camposDePreferencias(await api.obtenerPreferencias(clienteId))).toEqual(todo);
  });

  it('desmarcar todo y guardar deja las listas vacías, y quitar las observaciones las borra', async () => {
    const { clienteId, api } = await clienteNuevo();
    await api.guardarPreferencias(clienteId, cuerpoDePreferencias({ tiposVehiculo: ['AUTO'], canales: ['PUSH'], accesibilidad: ['ASISTENCIA_VISUAL'], observaciones: 'Hablar despacio' }));

    await api.guardarPreferencias(clienteId, cuerpoDePreferencias({ tiposVehiculo: [], canales: [], accesibilidad: [], observaciones: '' }));

    expect(camposDePreferencias(await api.obtenerPreferencias(clienteId))).toEqual({ tiposVehiculo: [], canales: [], accesibilidad: [], observaciones: '' });
  });

  it('marcar y desmarcar con alternarOpcion llega igual a M2', async () => {
    const { clienteId, api } = await clienteNuevo();
    let canales: string[] = [];
    canales = alternarOpcion(CANALES, canales, 'PUSH', true);
    canales = alternarOpcion(CANALES, canales, 'SMS', true);
    canales = alternarOpcion(CANALES, canales, 'PUSH', false);

    await api.guardarPreferencias(clienteId, cuerpoDePreferencias({ tiposVehiculo: [], canales, accesibilidad: [], observaciones: '' }));

    expect((await api.obtenerPreferencias(clienteId)).canales).toEqual(['SMS']);
  });

  it('guardar dos veces lo mismo no cambia nada (es un PUT)', async () => {
    const { clienteId, api } = await clienteNuevo();
    const cuerpo = cuerpoDePreferencias({ tiposVehiculo: ['MOTO'], canales: ['EMAIL'], accesibilidad: [], observaciones: '' });

    const primera = await api.guardarPreferencias(clienteId, cuerpo);
    const segunda = await api.guardarPreferencias(clienteId, cuerpo);

    expect(segunda).toEqual(primera);
  });

  it('las preferencias de un cliente no son las de otro', async () => {
    const uno = await clienteNuevo();
    const otro = await clienteNuevo();

    await uno.api.guardarPreferencias(uno.clienteId, cuerpoDePreferencias({ tiposVehiculo: ['MOTO'], canales: [], accesibilidad: [], observaciones: '' }));

    expect((await otro.api.obtenerPreferencias(otro.clienteId)).tiposVehiculo).toEqual([]);
  });
});

describe('los límites del panel son los de M2', () => {
  it('255 caracteres de observaciones los acepta; 256, M2 responde 400 con su detail', async () => {
    const { clienteId, api } = await clienteNuevo();
    const con = (observaciones: string): CamposPreferencias => ({ tiposVehiculo: [], canales: [], accesibilidad: [], observaciones });
    expect(validarPreferencias(con('o'.repeat(255)))).toEqual({});
    expect(validarPreferencias(con('o'.repeat(256)))).toHaveProperty('observaciones');

    await api.guardarPreferencias(clienteId, cuerpoDePreferencias(con('o'.repeat(255))));
    const error = await api.guardarPreferencias(clienteId, cuerpoDePreferencias(con('o'.repeat(256)))).catch((e: ErrorDeApi) => e);

    expect(error).toMatchObject({ estado: 400, sinRespuesta: false });
    expect((error as ErrorDeApi).detail).toBeTruthy();
    expect((await api.obtenerPreferencias(clienteId)).observacionesAccesibilidad).toHaveLength(255);
  });

  it('un valor que el contrato no admite es un 400: por eso la pantalla solo ofrece los suyos', async () => {
    const { clienteId, api } = await clienteNuevo();

    const error = await api.guardarPreferencias(clienteId, { tiposVehiculo: ['CAMION' as never], canales: [], accesibilidad: [] }).catch((e: ErrorDeApi) => e);

    expect(error).toMatchObject({ estado: 400 });
  });
});
