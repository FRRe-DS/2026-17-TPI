import { it, expect } from 'vitest';
import { chromium } from 'playwright-core';
import { compose, docker, ORIGEN } from './entorno.js';
it('entorno real sano, Chrome disponible y contenedor sin secretos heredados', async () => {
  expect((await fetch(`${ORIGEN}/salud-panel`)).status).toBe(200);
  const id = (await compose(['ps', '-q', 'panel'])).trim();
  const inspeccion = JSON.parse(await docker(['inspect', id]));
  const entorno: string[] = inspeccion[0].Config.Env;
  const prohibidas = /^(?:PANEL_URL_BD|PANEL_DOCKER|PANEL_SERVICIO_BD|PANEL_URL_M6_CONTROL|M2_|POSTGRES_)/;
  expect(entorno.some(variable => prohibidas.test(variable) || variable.includes('centinela-'))).toBe(false);
  const servicios = (await compose(['ps', '--services'])).trim().split(/\r?\n/);
  expect(servicios).not.toContain('bd-puente');
  const chrome = await chromium.launch({ channel: 'chrome', headless: true }); await chrome.close();
});
