import { randomUUID } from 'node:crypto';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  abrirChrome,
  abrirContexto,
  ANCHOS,
  controlesChicos,
  desbordeHorizontal,
  DIRECTORIO_CLIENTE,
  ESQUEMAS,
  irA,
  juntarErrores,
  tabularHasta,
  violacionesAxe,
  type Esquema,
} from '../ayudas/navegador.js';
import { levantarPanelConM2, type PanelConM2 } from '../ayudas/panel-con-m2.js';

// Prueba en navegador de la vista «Demostración» (spec 072, T17, RNF-15.6, RNF-07.6, RNF-13.6): Chrome real contra el panel con M2 de
// verdad. La vista vacía recorre a 360 y 1280 px en claro y oscuro en `base.test.ts` (desborde, controles de 44×44, teclado y axe);
// acá, lo que pasa al usarla: «Ejecutar todo» hasta el resumen con los resultados dibujados, una prueba simultánea con su tabla, el
// doble clic y el panel sin Docker (PANEL_DOCKER=no). El Docker de mentira y los clics de la base están en `control-base.test.ts`.

let panel: PanelConM2;
let chrome: Browser;
beforeAll(async () => {
  [panel, chrome] = await Promise.all([levantarPanelConM2({ directorioCliente: DIRECTORIO_CLIENTE }), abrirChrome()]);
}, 60_000);
afterAll(async () => {
  await chrome?.close();
  await panel?.cerrar();
});

let contexto: BrowserContext | undefined;
afterEach(async () => {
  await contexto?.close();
  contexto = undefined;
  await panel.ponerModo('normal');
});

async function abrir(ancho: number, esquema: Esquema): Promise<{ pagina: Page; errores: string[] }> {
  contexto = await abrirContexto(chrome, { ancho, esquema, sesion: { rol: 'CLIENTE', sub: randomUUID() } });
  const pagina = await contexto.newPage();
  const errores = juntarErrores(pagina);
  await irA(pagina, panel.origen, '#/demostracion');
  return { pagina, errores };
}

// Los casos provocan a propósito 4xx y 5xx y Chrome escribe cada uno en la consola («Failed to load resource…»): esos no cuentan. Lo
// demás (errores de la página, violaciones de la política de seguridad) sí.
const sinLosDeRed = (errores: string[]) => errores.filter((texto) => !texto.startsWith('Failed to load resource'));

const RESUMEN = /^Los \d+ casos dieron lo esperado\.$/;
const ejecutarTodo = (pagina: Page) => pagina.getByRole('button', { name: 'Ejecutar todo', exact: true });

describe.each(ANCHOS.flatMap((ancho) => ESQUEMAS.map((esquema) => ({ ancho, esquema }))))('«Ejecutar todo» a $ancho px en modo $esquema', ({ ancho, esquema }) => {
  it('llega al resumen y con los resultados dibujados sigue sin desborde, con controles de 44 px y sin violaciones de axe', async () => {
    const { pagina, errores } = await abrir(ancho, esquema);

    await ejecutarTodo(pagina).click();
    await pagina.getByText(RESUMEN).waitFor({ timeout: 25_000 });

    expect(await desbordeHorizontal(pagina), 'desplazamiento horizontal').toBe(0);
    expect(await controlesChicos(pagina), 'controles de menos de 44×44').toEqual([]);
    expect(await violacionesAxe(pagina), 'axe-core').toEqual([]);
    expect(sinLosDeRed(errores)).toEqual([]);
  });
});

describe('solo con teclado (RNF-15.6)', () => {
  it('llega a «Ejecutar todo», lo acciona con Enter y llega al resumen', async () => {
    const { pagina, errores } = await abrir(1280, 'light');

    await tabularHasta(pagina, 'Ejecutar todo');
    await pagina.keyboard.press('Enter');
    await pagina.getByText(RESUMEN).waitFor({ timeout: 25_000 });

    expect(sinLosDeRed(errores)).toEqual([]);
  });
});

describe('un caso suelto', () => {
  it('«Ejecutar» muestra su resultado con ✔ «Correcto» y no mueve la página hacia el costado', async () => {
    const { pagina } = await abrir(360, 'light');

    // El nombre accesible de cada botón lleva el del caso, para quien lee con lector de pantalla.
    await pagina.getByRole('button', { name: /^Ejecutar\s*: / }).first().click();

    await pagina.getByText('Correcto', { exact: true }).first().waitFor();
    expect(await pagina.getByText('Correcto', { exact: true }).count()).toBe(1);
    expect(await desbordeHorizontal(pagina)).toBe(0);
  });
});

describe('las pruebas de integridad (RNF-08.2 a RNF-08.4)', () => {
  it('una prueba simultánea muestra su tabla de respuestas por código y su veredicto', async () => {
    const { pagina } = await abrir(360, 'light');

    await pagina.getByRole('button', { name: 'Lanzar las altas' }).nth(1).click();
    const region = pagina.getByRole('region', { name: /^Respuestas por código: Altas simultáneas con claves distintas/ });
    await region.waitFor();

    expect(await region.locator('tbody tr').count()).toBeGreaterThanOrEqual(2);
    expect(await region.innerText()).toContain('409');
    expect(await pagina.getByText('Correcto', { exact: true }).count()).toBe(1);
    // La tabla se desplaza dentro de su caja: la página, no.
    expect(await desbordeHorizontal(pagina)).toBe(0);
    expect(await controlesChicos(pagina)).toEqual([]);
    expect(await violacionesAxe(pagina)).toEqual([]);
  });

  it('un doble clic lanza una sola ejecución', async () => {
    const { pagina } = await abrir(1280, 'light');
    const lanzadas: string[] = [];
    pagina.on('request', (pedido) => {
      const { pathname } = new URL(pedido.url());
      if (pedido.method() === 'POST' && pathname.startsWith('/panel/demo/')) lanzadas.push(pathname);
    });

    await pagina.getByRole('button', { name: 'Lanzar las altas' }).first().dblclick();
    await pagina.getByRole('region', { name: /^Respuestas por código: Altas simultáneas con la misma clave/ }).waitFor();

    expect(lanzadas).toEqual(['/panel/demo/altas-simultaneas']);
  });

  it('mientras una prueba corre, los demás botones de la vista quedan deshabilitados', async () => {
    const { pagina } = await abrir(1280, 'light');
    await pagina.route('**/panel/demo/altas-simultaneas', async (ruta) => {
      await new Promise((listo) => setTimeout(listo, 600));
      await ruta.fallback();
    });

    await pagina.getByRole('button', { name: 'Lanzar las altas' }).first().click();

    await pagina.getByRole('button', { name: 'Lanzando…' }).waitFor();
    expect(await ejecutarTodo(pagina).isDisabled()).toBe(true);
    expect(await pagina.getByRole('button', { name: 'Probar la restricción' }).isDisabled()).toBe(true);
    await pagina.getByRole('region', { name: /^Respuestas por código/ }).waitFor();
    expect(await ejecutarTodo(pagina).isEnabled()).toBe(true);
  });
});

describe.each(ANCHOS)('con PANEL_DOCKER=no a %i px (RNF-13.6)', (ancho) => {
  it('apagar y encender deshabilitados con su motivo y cómo activarlos, y el resto utilizable', async () => {
    const { pagina } = await abrir(ancho, 'light');

    await pagina.getByText(/Apagar y encender la base no están disponibles: el panel corre en un contenedor/).waitFor();
    expect(await pagina.getByRole('button', { name: 'Apagar la base', exact: true }).isDisabled()).toBe(true);
    expect(await pagina.getByRole('button', { name: 'Encender la base', exact: true }).isDisabled()).toBe(true);
    expect(await pagina.getByText(/Levantá el panel en la máquina con npm run panel/).isVisible()).toBe(true);
    // El resto de la vista sigue funcionando.
    expect(await ejecutarTodo(pagina).isEnabled()).toBe(true);
    expect(await pagina.getByRole('button', { name: 'Probar la restricción' }).isEnabled()).toBe(true);
    expect(await desbordeHorizontal(pagina)).toBe(0);
    expect(await controlesChicos(pagina)).toEqual([]);
    expect(await violacionesAxe(pagina)).toEqual([]);
  });
});
