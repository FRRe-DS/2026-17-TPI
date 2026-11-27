import { chromium, type Page } from 'playwright-core';
import { it, expect } from 'vitest';
import { ingresar, completar } from './navegador.js';
import { ORIGEN } from './entorno.js';
import { USUARIO_DOBLE } from '../ayudas/realm.js';
import { setTimeout as esperar } from 'node:timers/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
async function noDesborda(pagina: Page) {
  expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}
it('doble rol cambia espacio sin identidad nueva; operador actúa sin perfil propio y cliente no entra', async () => {
  const chrome = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const doble = await chrome.newContext();
    try {
      const pagina = await doble.newPage(); await ingresar(pagina, 'cliente-operador1'); await completar(pagina);
      const cookie = (await doble.cookies(ORIGEN)).find(c => c.name === 'm2_sesion')!.value;
      await pagina.getByLabel('Espacio', { exact: true }).selectOption('OPERADOR');
      await pagina.getByRole('heading', { name: 'Operador: bloqueos', exact: true }).waitFor();
      expect((await pagina.evaluate(async () => (await fetch('/auth/sesion')).json())).sub).toBe(USUARIO_DOBLE.id);
      expect((await doble.cookies(ORIGEN)).find(c => c.name === 'm2_sesion')!.value).toBe(cookie);
      await pagina.getByLabel('Espacio', { exact: true }).selectOption('CLIENTE');
      await pagina.getByRole('heading', { name: 'Mi perfil', exact: true }).waitFor();
    } finally { await doble.close(); }
    const operador = await chrome.newContext();
    try {
      const pagina = await operador.newPage(); const consultasPropias: string[] = [];
      pagina.on('request', r => { if (r.url().includes('/api/v1/clientes/0be00000')) consultasPropias.push('perfil'); });
      await ingresar(pagina, 'operador1');
      await pagina.getByRole('heading', { name: 'Operador: bloqueos', exact: true }).waitFor();
      await pagina.getByLabel(/UUID del cliente/).fill(USUARIO_DOBLE.id); await pagina.getByRole('button', { name: 'Buscar', exact: true }).click();
      await pagina.getByLabel('Motivo', { exact: false }).first().fill('Prueba de operador sin perfil propio');
      const [respuesta] = await Promise.all([pagina.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/bloqueos')),
        pagina.getByRole('button', { name: 'Bloquear cliente', exact: true }).click()]);
      expect(respuesta.status()).toBe(201); expect(consultasPropias).toEqual([]);
    } finally { await operador.close(); }
    const cliente = await chrome.newContext();
    try {
      const pagina = await cliente.newPage(); await ingresar(pagina, 'cliente1'); await completar(pagina);
      await pagina.goto(`${ORIGEN}/#/operador`); await pagina.getByRole('heading', { name: 'Acceso no permitido' }).waitFor();
      expect(await pagina.getByLabel(/UUID del cliente/).count()).toBe(0);
    } finally { await cliente.close(); }
  } finally { await chrome.close(); }
});

it('sesión cerrada conserva el formulario y permite copia manual; logout confirma cierre y vistas no desbordan', async () => {
  const chrome = await chromium.launch({ channel: 'chrome', headless: true });
  const contexto = await chrome.newContext({ viewport: { width: 360, height: 800 } });
  try {
    const pagina = await contexto.newPage(); await pagina.clock.install();
    await ingresar(pagina, 'cliente2'); await completar(pagina);
    const nombre = pagina.getByLabel(/Nombre/, { exact: false }).first();
    await nombre.fill('Borrador que no se debe perder');
    await noDesborda(pagina); await pagina.setViewportSize({ width: 1280, height: 800 }); await noDesborda(pagina);
    // Otro tab cierra la sesión real del servidor; la pantalla original se entera al consultar de nuevo.
    const salida = await contexto.request.post(`${ORIGEN}/auth/cerrar`, { headers: { origin: ORIGEN }, maxRedirects: 0 });
    expect(salida.status()).toBe(303);
    await pagina.clock.fastForward(61_000);
    await pagina.getByRole('heading', { name: 'Tu sesión venció' }).waitFor();
    expect(await nombre.inputValue()).toBe('Borrador que no se debe perder');
    expect(await pagina.getByRole('button', { name: 'Guardar cambios', exact: true }).isDisabled()).toBe(true);
    await pagina.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('No permitido'); } } }); });
    await pagina.getByRole('button', { name: 'Copiar datos', exact: true }).click();
    const copia = pagina.getByLabel('Datos para copiar'); await copia.waitFor(); expect(await copia.inputValue()).toContain('Borrador que no se debe perder');
    await copia.focus(); expect(await copia.evaluate((elemento: HTMLTextAreaElement) => elemento.selectionStart === 0 && elemento.selectionEnd === elemento.value.length)).toBe(true);
    await pagina.setViewportSize({ width: 360, height: 800 }); await noDesborda(pagina);
    await pagina.screenshot({ path: join(tmpdir(), 'm2-front-sesion-360.png'), fullPage: true });
    await pagina.goto(salida.headers().location);
    const confirmar = pagina.getByRole('button', { name: /Log out|Cerrar sesión|Logout/i });
    if (await confirmar.count()) await confirmar.click();
    await pagina.waitForURL(url => url.origin === ORIGEN);
    expect(new URL(pagina.url()).searchParams.get('salida')).toBe('completa');
    expect((await contexto.request.get(`${ORIGEN}/auth/sesion`)).status()).toBe(401);
    await pagina.getByRole('button', { name: 'Iniciar sesión con Keycloak' }).focus();
    expect(await pagina.evaluate(() => document.activeElement?.tagName)).toBe('BUTTON');
    await pagina.keyboard.press('Enter'); await pagina.locator('#username').waitFor();
  } finally { await contexto.close(); await chrome.close(); }
});

it('renueva con Keycloak real después de vencer access token sin cambiar cookie ni sub', async () => {
  const chrome = await chromium.launch({ channel: 'chrome', headless: true }); const contexto = await chrome.newContext();
  try {
    const pagina = await contexto.newPage(); const sesion = await ingresar(pagina, 'operador1');
    const anterior = (await contexto.cookies(ORIGEN)).find(c => c.name === 'm2_sesion')!.value;
    await esperar(42_000);
    const respuesta = await contexto.request.get(`${ORIGEN}/auth/sesion`);
    expect(respuesta.status()).toBe(200); expect((await respuesta.json()).sub).toBe(sesion.sub);
    expect((await contexto.cookies(ORIGEN)).find(c => c.name === 'm2_sesion')!.value).toBe(anterior);
  } finally { await contexto.close(); await chrome.close(); }
});
