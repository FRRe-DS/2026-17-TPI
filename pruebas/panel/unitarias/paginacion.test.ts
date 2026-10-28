import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { hayAnterior, haySiguiente, textoDePagina, type DatosDePagina } from '../../../panel/cliente/src/logica/paginacion.js';

// La paginación de las listas (T22; la usan también T25 y T27) y los casilleros nuevos de `Campo`: el selector y el teclado decimal.

const pagina = (page: number, totalPaginas: number, totalElementos: number, size = 5): DatosDePagina => ({ page, size, totalElementos, totalPaginas });

describe('paginación: las páginas de M2 empiezan en 0', () => {
  it('en la primera no hay anterior; en la última no hay siguiente', () => {
    expect([hayAnterior(pagina(0, 3, 12)), haySiguiente(pagina(0, 3, 12))]).toEqual([false, true]);
    expect([hayAnterior(pagina(1, 3, 12)), haySiguiente(pagina(1, 3, 12))]).toEqual([true, true]);
    expect([hayAnterior(pagina(2, 3, 12)), haySiguiente(pagina(2, 3, 12))]).toEqual([true, false]);
  });

  it('con una sola página o ninguna, ni anterior ni siguiente', () => {
    expect([hayAnterior(pagina(0, 1, 3)), haySiguiente(pagina(0, 1, 3))]).toEqual([false, false]);
    expect([hayAnterior(pagina(0, 0, 0)), haySiguiente(pagina(0, 0, 0))]).toEqual([false, false]);
  });

  it('el texto cuenta desde 1 y dice el total', () => {
    expect(textoDePagina(pagina(0, 3, 12))).toBe('Página 1 de 3 · 12 en total');
    expect(textoDePagina(pagina(2, 3, 12))).toBe('Página 3 de 3 · 12 en total');
    expect(textoDePagina(pagina(0, 0, 0))).toBe('0 en total');
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cualquiera = ComponentType<any>;
async function importar(archivo: string, nombre: string): Promise<Cualquiera> {
  const ruta: string = new URL(`../../../panel/cliente/src/componentes/${archivo}`, import.meta.url).pathname;
  return ((await import(ruta)) as Record<string, Cualquiera>)[nombre]!;
}

describe('componente Paginacion', () => {
  it('con varias páginas, dos botones: el anterior deshabilitado en la primera', async () => {
    const Paginacion = await importar('paginacion.tsx', 'Paginacion');

    const html = renderToStaticMarkup(createElement(Paginacion, { pagina: pagina(0, 3, 12), alCambiar: () => undefined, nombre: 'direcciones' }));

    expect(html).toContain('aria-label="Páginas de direcciones"');
    expect(html).toContain('Página 1 de 3 · 12 en total');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Anterior<\/button>/);
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Siguiente<\/button>/);
  });

  it('con una sola página solo dice cuántos hay', async () => {
    const Paginacion = await importar('paginacion.tsx', 'Paginacion');

    const html = renderToStaticMarkup(createElement(Paginacion, { pagina: pagina(0, 1, 3), alCambiar: () => undefined, nombre: 'direcciones' }));

    expect(html).toContain('3 en total');
    expect(html).not.toContain('<button');
  });
});

describe('Campo: selector y teclado decimal', () => {
  const OPCIONES = [{ valor: 'FAVORITA', etiqueta: 'Favorita' }, { valor: 'RECIENTE', etiqueta: 'Reciente' }];

  it('con opciones es un <select> asociado a su etiqueta, con la opción elegida', async () => {
    const Campo = await importar('formulario.tsx', 'Campo');

    const html = renderToStaticMarkup(createElement(Campo, { id: 'tipo', etiqueta: 'Tipo', valor: 'RECIENTE', alCambiar: () => undefined, opciones: OPCIONES, error: 'Elegí uno.' }));

    expect(html).toContain('<label for="tipo"');
    expect(html).toMatch(/<select id="tipo"[^>]*aria-invalid="true"/);
    expect(html).toContain('aria-describedby="tipo-error"');
    expect(html).toContain('<option value="FAVORITA">Favorita</option>');
    expect(html).toContain('<option value="RECIENTE" selected="">Reciente</option>');
    expect(html).not.toContain('<input');
  });

  it('con `teclado="decimal"` el campo pide el teclado de números con coma', async () => {
    const Campo = await importar('formulario.tsx', 'Campo');

    const html = renderToStaticMarkup(createElement(Campo, { id: 'lat', etiqueta: 'Latitud', valor: '', alCambiar: () => undefined, teclado: 'decimal' }));

    expect(html).toContain('inputMode="decimal"');
  });
});
