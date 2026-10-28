import { randomUUID } from 'node:crypto';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { abrirChrome, abrirContexto, DIRECTORIO_CLIENTE, irA, juntarErrores } from '../ayudas/navegador.js';
import { levantarPanelConM2, type PanelConM2 } from '../ayudas/panel-con-m2.js';

// La sección «Base de datos» de la vista «Demostración» en Chrome (spec 072, T16, RNF-13.4, RNF-15.6), con el Docker de mentira de
// la ayuda: la base de M2 detrás de un proxy que «apagar» cierra y «encender» reabre. Lo que no se ve en el dibujo estático: la
// confirmación, que «Cancelar» no llama a nada, la salud en vivo pasando a 503 y volviendo a 200, y el doble clic.

let panel: PanelConM2;
let chrome: Browser;
beforeAll(async () => {
  [panel, chrome] = await Promise.all([levantarPanelConM2({ directorioCliente: DIRECTORIO_CLIENTE, dockerDeMentira: true }), abrirChrome()]);
}, 60_000);
afterAll(async () => {
  await chrome?.close();
  await panel?.cerrar();
});

let contexto: BrowserContext | undefined;
afterEach(async () => {
  await contexto?.close();
  contexto = undefined;
  await panel.docker.reponer();
});

// Los pedidos de apagar y encender que salen de la página.
type Abierta = { pagina: Page; errores: string[]; comandos: string[] };
async function abrir(): Promise<Abierta> {
  contexto = await abrirContexto(chrome, { ancho: 1280, esquema: 'light', sesion: { rol: 'CLIENTE', sub: randomUUID() } });
  const pagina = await contexto.newPage();
  const errores = juntarErrores(pagina);
  const comandos: string[] = [];
  pagina.on('request', (pedido) => {
    const camino = new URL(pedido.url()).pathname;
    if (camino.startsWith('/panel/demo/base/')) comandos.push(camino);
  });
  await irA(pagina, panel.origen, '#/demostracion');
  // Habilitado cuando llegó la consulta de Docker.
  await pagina.locator('button:not([disabled])', { hasText: 'Apagar la base' }).waitFor();
  return { pagina, errores, comandos };
}

const apagarLaBase = (pagina: Page) => pagina.getByRole('button', { name: 'Apagar la base', exact: true });
const encenderLaBase = (pagina: Page) => pagina.getByRole('button', { name: 'Encender la base', exact: true });
const dialogo = (pagina: Page) => pagina.getByRole('dialog', { name: 'Apagar la base de M2' });

describe('«Apagar la base» pide confirmación (RNF-15.6)', () => {
  it('«Cancelar» cierra el diálogo sin llamar a nada', async () => {
    const { pagina, comandos } = await abrir();

    await apagarLaBase(pagina).click();
    await dialogo(pagina).waitFor();
    // El foco empieza en «Cancelar»: un Enter apurado no apaga la base.
    expect(await pagina.evaluate(() => document.activeElement?.textContent)).toBe('Cancelar');
    await dialogo(pagina).getByRole('button', { name: 'Cancelar' }).click();
    await dialogo(pagina).waitFor({ state: 'hidden' });

    expect(comandos).toEqual([]);
    expect(panel.docker.llamadas).toEqual([]);
  });

  it('Escape también cierra sin llamar a nada', async () => {
    const { pagina, comandos } = await abrir();

    await apagarLaBase(pagina).click();
    await dialogo(pagina).waitFor();
    await pagina.keyboard.press('Escape');
    await dialogo(pagina).waitFor({ state: 'hidden' });

    expect(comandos).toEqual([]);
  });
});

describe('apagar y encender con la salud en vivo (RNF-13.4)', () => {
  it('apagar muestra el 503 de M2 y encender, la vuelta a 200; sin errores en la consola', async () => {
    const { pagina, errores, comandos } = await abrir();

    await apagarLaBase(pagina).click();
    await dialogo(pagina).getByRole('button', { name: 'Apagar', exact: true }).click();
    await pagina.getByText('Base apagada. M2 responde 503: no puede atender sin su base.').waitFor();
    await dialogo(pagina).waitFor({ state: 'hidden' });

    await encenderLaBase(pagina).click();
    await pagina.getByText(/^M2 volvió a responder 200/).waitFor();

    expect(comandos).toEqual(['/panel/demo/base/apagar', '/panel/demo/base/encender']);
    expect(panel.docker.llamadas).toEqual(['apagar', 'encender']);
    expect(errores).toEqual([]);
  });

  it('un doble clic en «Encender la base» lanza un solo comando', async () => {
    const { pagina } = await abrir();

    await encenderLaBase(pagina).dblclick();
    await pagina.getByText(/^M2 volvió a responder 200/).waitFor();

    expect(panel.docker.llamadas).toEqual(['encender']);
  });

  it('si el comando falla, lo dice con el error del panel y «Reintentar» lo repite', async () => {
    const { pagina } = await abrir();
    panel.docker.fallar('no such service: bd');

    await encenderLaBase(pagina).click();
    await pagina.getByText('No se pudo encender la base.').waitFor();
    expect(await pagina.getByText('no such service: bd').isVisible()).toBe(true);
    await pagina.getByRole('button', { name: 'Reintentar' }).click();
    await pagina.getByText(/^M2 volvió a responder 200/).waitFor();

    expect(panel.docker.llamadas).toEqual(['encender', 'encender']);
  });
});
