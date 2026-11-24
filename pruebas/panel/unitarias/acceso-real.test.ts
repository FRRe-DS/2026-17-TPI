import { it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IngresarReal } from '../../../panel/cliente/src/pantallas/ingresar-real.js';
it('acceso real ofrece POST propio sin identidades manuales ni destino arbitrario', () => {
  const html = renderToStaticMarkup(createElement(IngresarReal, { aviso: 'No se pudo ingresar' }));
  expect(html).toContain('action="/auth/iniciar"'); expect(html).toContain('method="post"');
  expect(html).toContain('Iniciar sesión con Keycloak'); expect(html).not.toMatch(/select|password|name="sub"|name="rol"/);
});
