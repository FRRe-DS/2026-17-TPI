import { it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContextoSesionEditable } from '../../../panel/cliente/src/componentes/sesion-editable.js';
import { BotonAccion } from '../../../panel/cliente/src/componentes/boton-accion.js';
import { textoDeControles } from '../../../panel/cliente/src/logica/copiar-formulario.js';
it('copia solo radios/casillas marcados, incluyendo puntaje elegido sin sumar los otros cuatro', () => {
  const control = (type: string, value: string, checked = false) => ({ type, value, checked, labels: [{ textContent: 'Puntaje' }], hasAttribute: () => false });
  const controles = [1, 2, 3, 4, 5].map(n => control('radio', String(n), n === 4));
  controles.push(control('checkbox', 'opción falsa'), control('checkbox', 'opción marcada', true), control('text', 'comentario'));
  expect(textoDeControles(controles)).toBe('Puntaje: 4\nPuntaje: opción marcada\nPuntaje: comentario');
});
it('un formulario vencido deshabilita enviar sin desmontar campos', () => {
  const html = renderToStaticMarkup(createElement(ContextoSesionEditable.Provider, { value: false },
    createElement(BotonAccion, { tipo: 'submit', esperando: false, children: 'Guardar' })));
  expect(html).toContain('disabled');
});
