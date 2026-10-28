import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ErrorDeApi } from '../../../panel/cliente/src/api/errores.js';
import { ESPERA_MAXIMA_MS, estadoInicial, reducir, textoDeSalud, type EstadoSalud } from '../../../panel/cliente/src/logica/salud-en-vivo.js';
import { levantarPanelConM2, type PanelConM2 } from '../ayudas/panel-con-m2.js';

// La sección «Base de datos» de la vista de demostración (spec 072, T16, RNF-13.4, RNF-13.6) contra el panel de verdad, con un Docker
// de mentira: la base de M2 queda detrás de un proxy TCP, y «apagar» lo cierra (M2 pierde la base y su salud da 503) y «encender»
// lo reabre. Se llama a las mismas funciones de `api/panel.ts` que usa la sección y se sigue la salud con el mismo reductor; el reloj
// es el de la prueba, para llegar a los 60 s de «no volvió» sin esperarlos.
let panel: PanelConM2;
beforeAll(async () => {
  panel = await levantarPanelConM2({ dockerDeMentira: true });
}, 60_000);
afterEach(async () => {
  await panel.docker.reponer();
});
afterAll(async () => {
  await panel?.cerrar();
});

const salud = async () => (await panel.apiPanel.consultarSaludDeM2()).estado;

// Sondea la salud hasta que dé `esperado`: M2 vuelve a abrir conexiones con la base al primer pedido, sin una espera fija.
async function hastaQueDe(esperado: number, intentos = 20): Promise<number | null> {
  let ultimo: number | null = null;
  for (let i = 0; i < intentos; i += 1) {
    ultimo = await salud();
    if (ultimo === esperado) return ultimo;
    await new Promise((listo) => setTimeout(listo, 100));
  }
  return ultimo;
}

describe('con Docker disponible (RNF-13.4)', () => {
  it('el estado de la vista lo informa disponible', async () => {
    expect((await panel.apiPanel.obtenerEstadoDemo()).docker).toEqual({ disponible: true });
  });

  it('apagar: el comando se ejecuta una vez y la salud de M2 pasa de 200 a 503', async () => {
    expect(await salud()).toBe(200);
    let estado: EstadoSalud = reducir(estadoInicial, { tipo: 'apagar-pulsado' });

    expect(await panel.apiPanel.apagarBase()).toEqual({ ejecutado: true });
    estado = reducir(estado, { tipo: 'apagada' });
    estado = reducir(estado, { tipo: 'salud', estado: await salud(), ahora: 0 });

    expect(panel.docker.llamadas).toEqual(['apagar']);
    expect(estado).toEqual({ fase: 'observando', ultimo: 503 });
    expect(textoDeSalud(estado)).toBe('Base apagada. M2 responde 503: no puede atender sin su base.');
  });

  it('encender: la salud vuelve a 200 y la sección lo da por recuperada', async () => {
    await panel.apiPanel.apagarBase();
    expect(await salud()).toBe(503);
    let estado: EstadoSalud = reducir({ fase: 'observando', ultimo: 503 }, { tipo: 'encender-pulsado', ahora: 0 });

    expect(await panel.apiPanel.encenderBase()).toEqual({ ejecutado: true });
    estado = reducir(estado, { tipo: 'salud', estado: await hastaQueDe(200), ahora: 2000 });

    expect(panel.docker.llamadas).toEqual(['apagar', 'encender']);
    expect(estado).toEqual({ fase: 'recuperada', tardoMs: 2000 });
    expect(textoDeSalud(estado)).toBe('M2 volvió a responder 200 a los 2 s.');
  });

  it('M2 no volvió: si a los 60 s la salud sigue en 503, lo dice con el último estado', async () => {
    panel.docker.noVolver();
    await panel.apiPanel.apagarBase();
    let estado: EstadoSalud = reducir({ fase: 'observando', ultimo: 503 }, { tipo: 'encender-pulsado', ahora: 0 });

    await panel.apiPanel.encenderBase();
    estado = reducir(estado, { tipo: 'salud', estado: await salud(), ahora: 2000 });
    expect(estado.fase).toBe('encendiendo');
    estado = reducir(estado, { tipo: 'salud', estado: await salud(), ahora: ESPERA_MAXIMA_MS });

    expect(estado).toEqual({ fase: 'no-volvio', ultimo: 503 });
    expect(textoDeSalud(estado)).toBe('M2 no volvió a responder 200 en 60 s (último estado: 503).');
  });

  it('apagar dos veces o encender con la base encendida no es un error: se informa la salud (spec, casos límite)', async () => {
    await panel.apiPanel.apagarBase();
    await panel.apiPanel.apagarBase();
    expect(await salud()).toBe(503);

    await panel.apiPanel.encenderBase();
    await panel.apiPanel.encenderBase();
    expect(await hastaQueDe(200)).toBe(200);
  });

  it('el comando que falla llega a la sección como el error 502 del panel, con su motivo', async () => {
    panel.docker.fallar('no such service: bd');

    const error = await panel.apiPanel.encenderBase().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ErrorDeApi);
    expect(error).toMatchObject({ estado: 502, type: '/panel/errores/docker-fallo', detail: 'no such service: bd' });
  });

  it('con la base de M2 apagada, la base de la prueba sigue a mano (el proxy es solo de M2)', async () => {
    await panel.apiPanel.apagarBase();

    const { rows } = await panel.pool.query('SELECT 1 AS uno');

    expect(rows[0].uno).toBe(1);
  });
});
