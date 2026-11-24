import Fastify from 'fastify';
import { chromium } from 'playwright-core';
import { expect, it } from 'vitest';
import { construirApp } from '../../../panel/servidor/app.js';
import { cargarConfigPanel } from '../../../panel/servidor/config.js';
import { puertoLibre } from '../../ayudas/arranque.js';
import { descartarLogs } from '../../ayudas/logs.js';

// T4: navegación y CSP reales en Chrome, con destino de identidad mínimo.
// El login completo contra Keycloak real sigue siendo T23, después de validar tokens y callback.
it('Chrome envía POST propio, sigue el 303 y llega al destino permitido sin violaciones CSP', async () => {
  const identidad = Fastify();
  let refererIdentidad: string | undefined;
  identidad.get('/realms/movilidad/.well-known/openid-configuration', async () => ({ issuer: 'prueba' }));
  identidad.get('/realms/movilidad/protocol/openid-connect/auth', (request, reply) => {
    refererIdentidad = request.headers.referer;
    return reply.type('text/html; charset=utf-8').send('<!doctype html><html lang="es"><title>Identidad de prueba</title><h1>Identidad de prueba</h1></html>');
  });
  const origenIdentidad = await identidad.listen({ host: '127.0.0.1', port: 0 });
  const puerto = await puertoLibre();
  const origen = `http://127.0.0.1:${puerto}`;
  const { config } = cargarConfigPanel({ PANEL_MODO_AUTH: 'oidc', PANEL_PUERTO: String(puerto),
    PANEL_ORIGEN_PUBLICO: origen, PANEL_OIDC_EMISOR: `${origenIdentidad}/realms/movilidad`,
    PANEL_OIDC_URL_INTERNA: `${origenIdentidad}/realms/movilidad` });
  if (!config || config.modoAuth !== 'oidc') { await identidad.close(); throw new Error('Configuración OIDC de prueba inválida'); }
  const app = construirApp({ config, flujoLog: descartarLogs });
  app.get('/prueba-acceso', (_request, reply) => reply.type('text/html; charset=utf-8').send(
    '<!doctype html><html lang="es"><title>Acceso de prueba</title><form method="post" action="/auth/iniciar"><button>Iniciar sesión</button></form></html>',
  ));
  let chrome: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await app.listen({ host: '127.0.0.1', port: puerto });
    chrome = await chromium.launch({ channel: 'chrome', headless: true, timeout: 5000 });
    const page = await chrome.newPage();
    page.setDefaultTimeout(5000);
    page.setDefaultNavigationTimeout(5000);
    const violaciones: string[] = [];
    let origenDelPost: string | undefined;
    await page.exposeFunction('notificarViolacionCsp', () => violaciones.push('CSP'));
    await page.addInitScript(() => {
      window.addEventListener('securitypolicyviolation', () => {
        void (window as unknown as { notificarViolacionCsp: () => Promise<void> }).notificarViolacionCsp();
      });
    });
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url() === `${origen}/auth/iniciar`) origenDelPost = request.headers().origin;
    });
    await page.goto(`${origen}/prueba-acceso`);
    const [respuesta] = await Promise.all([
      page.waitForResponse((respuesta) => respuesta.url() === `${origen}/auth/iniciar` && respuesta.request().method() === 'POST'),
      page.getByRole('button', { name: 'Iniciar sesión' }).click(),
    ]);
    expect(respuesta.status()).toBe(303);
    expect(origenDelPost).toBe(origen);
    await page.waitForURL(`${origenIdentidad}/realms/movilidad/protocol/openid-connect/auth?*`);
    expect(await page.getByRole('heading', { name: 'Identidad de prueba' }).isVisible()).toBe(true);
    expect(violaciones).toEqual([]);
    expect(refererIdentidad).toBeUndefined();
  } finally {
    await chrome?.close();
    await app.close();
    await identidad.close();
  }
});
