import { it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContextoSesionEditable } from '../../../panel/cliente/src/componentes/sesion-editable.js';
import { BotonAccion } from '../../../panel/cliente/src/componentes/boton-accion.js';
it('un formulario vencido deshabilita enviar sin desmontar campos', () => {
  const html = renderToStaticMarkup(createElement(ContextoSesionEditable.Provider, { value: false },
    createElement(BotonAccion, { tipo: 'submit', esperando: false, children: 'Guardar' })));
  expect(html).toContain('disabled');
});
