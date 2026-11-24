import { chromium } from 'playwright-core';
import { it, expect } from 'vitest';
import { ingresar, completar } from './navegador.js';
import { idsDeEjemplo } from '../../panel/m6-simulado/ids.js';
import { USUARIOS_DE_EJEMPLO } from '../ayudas/realm.js';
it('POST real y CSP atraviesan Keycloak; dos clientes ven viajes propios y uno califica', async () => {
  const chrome = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const nombre of ['cliente1', 'cliente2']) {
      const contexto = await chrome.newContext({ locale: 'es-AR' });
      try {
        const pagina = await contexto.newPage(); const errores: string[] = [];
        pagina.on('pageerror', () => errores.push('JavaScript'));
        await pagina.exposeFunction('avisarCsp', () => errores.push('CSP'));
        await pagina.addInitScript(() => window.addEventListener('securitypolicyviolation', () => {
          void (window as unknown as { avisarCsp: () => Promise<void> }).avisarCsp();
        }));
        const controles: string[] = []; pagina.on('request', r => { if (r.url().includes('/control') || r.url().includes('/panel/m6')) controles.push('control'); });
        const sesion = await ingresar(pagina, nombre); await completar(pagina);
        await pagina.goto(pagina.url().split('#')[0] + '#/historial');
        await pagina.getByRole('heading', { name: 'Historial de viajes' }).waitFor();
        const propios = idsDeEjemplo(sesion.sub); const ajenos = idsDeEjemplo(USUARIOS_DE_EJEMPLO.find(u => u.usuario === (nombre === 'cliente1' ? 'cliente2' : 'cliente1'))!.id);
        await pagina.getByText(propios.completado, { exact: true }).waitFor();
        expect(await pagina.getByText(ajenos.completado, { exact: true }).count()).toBe(0);
        expect(await pagina.getByText('M6 simulado', { exact: false }).count()).toBeGreaterThan(0);
        if (nombre === 'cliente1') {
          await pagina.getByRole('link', { name: /^Calificar/ }).first().click();
          await pagina.getByLabel('5', { exact: true }).check();
          await pagina.getByLabel(/Comentario/).fill('Buen viaje de prueba');
          const [respuesta] = await Promise.all([pagina.waitForResponse(r => r.request().method() === 'POST' && r.url().includes('/calificaciones')),
            pagina.getByRole('button', { name: 'Enviar calificación', exact: true }).click()]);
          expect(respuesta.status()).toBe(201);
        }
        expect(errores).toEqual([]); expect(controles).toEqual([]);
      } finally { await contexto.close(); }
    }
  } finally { await chrome.close(); }
});
