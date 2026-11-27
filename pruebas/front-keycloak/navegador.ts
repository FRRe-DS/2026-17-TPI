import type { Page } from 'playwright-core';
import { expect } from 'vitest';
import { ORIGEN } from './entorno.js';
import { USUARIOS_DE_EJEMPLO, USUARIO_DOBLE } from '../ayudas/realm.js';
export async function ingresar(pagina: Page, nombre: string) {
  const usuario = [USUARIO_DOBLE, ...USUARIOS_DE_EJEMPLO].find(u => u.usuario === nombre)!;
  pagina.setDefaultTimeout(15_000);
  await pagina.goto(ORIGEN);
  await pagina.getByRole('button', { name: 'Iniciar sesión con Keycloak' }).waitFor();
  const [respuesta] = await Promise.all([pagina.waitForResponse(r => r.url() === `${ORIGEN}/auth/iniciar`),
    pagina.getByRole('button', { name: 'Iniciar sesión con Keycloak' }).click()]);
  expect(respuesta.status()).toBe(303); expect(respuesta.request().method()).toBe('POST');
  await pagina.locator('#username').fill(usuario.usuario);
  await pagina.locator('#password').fill(usuario.contrasena);
  await pagina.locator('#kc-login').click();
  await pagina.waitForURL(url => url.origin === ORIGEN && !url.pathname.startsWith('/auth/'));
  expect(new URL(pagina.url()).searchParams.has('code')).toBe(false);
  await pagina.getByRole('button', { name: 'Cerrar sesión', exact: true }).waitFor();
  const sesion = await pagina.evaluate(async () => (await fetch('/auth/sesion')).json());
  expect(sesion.sub).toBe(usuario.id); expect(JSON.stringify(sesion)).not.toMatch(/token|refresh/i);
  expect(await pagina.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  const cookie = (await pagina.context().cookies(ORIGEN)).find(c => c.name === 'm2_sesion');
  expect(cookie?.httpOnly).toBe(true); expect(cookie?.value).toHaveLength(43);
  return sesion as { sub: string; roles: string[]; scopes: string[] };
}
export async function completar(pagina: Page) {
  await pagina.locator('h1').filter({ hasText: /^(Completar perfil|Mi perfil)$/ }).waitFor();
  if (await pagina.getByRole('heading', { name: 'Completar perfil', exact: true }).isVisible()) {
    await pagina.getByLabel(/Nombre/, { exact: false }).first().fill('Cliente');
    await pagina.getByLabel(/Apellido/).fill('Prueba');
    await pagina.getByLabel(/Teléfono/).fill('+5493624111111');
    await pagina.getByRole('button', { name: 'Completar perfil', exact: true }).click();
  }
  await pagina.getByRole('heading', { name: 'Mi perfil', exact: true }).waitFor();
}
