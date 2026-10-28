import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AREAS, CASOS } from '../../../panel/cliente/src/logica/casos.js';

// La estructura de la vista «Demostración» (spec 072, T14) tal como se dibuja al abrirla, con `renderToStaticMarkup`. Lo que pasa al
// ejecutar (esperas, doble clic, resumen) lo recorre la prueba en navegador (T17) y las de integración.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cualquiera = ComponentType<any>;
const cargar = async (archivo: string, nombre: string): Promise<Cualquiera> => {
  const ruta: string = new URL(`../../../panel/cliente/src/${archivo}`, import.meta.url).pathname;
  return ((await import(ruta)) as Record<string, Cualquiera>)[nombre]!;
};
const entorno = {
  pedir: async () => ({ estado: 200, encabezados: {} }),
  viajes: { estado: async () => ({ modo: 'normal' as const }), ponerModo: async () => undefined },
};
const dibujar = async () => renderToStaticMarkup(createElement(await cargar('pantallas/demostracion.tsx', 'Demostracion'), { entorno }));
const botones = (html: string) => [...html.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);

describe('la vista «Demostración» al abrirla', () => {
  it('un solo <h1> «Demostración» y la sección «Casos»', async () => {
    const html = await dibujar();

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('>Demostración</h1>');
    expect(html).toMatch(/<h2 id="demo-casos"[^>]*>Casos<\/h2>/);
  });

  it('una sección por área, en el orden de la guía, con su título', async () => {
    const html = await dibujar();

    const titulos = [...html.matchAll(/<h3 id="area-[^"]+"[^>]*>([^<]+)<\/h3>/g)].map((m) => m[1]);
    expect(titulos).toEqual(AREAS.map((a) => a.titulo.replace(/&/g, '&amp;')));
  });

  it('un botón «Ejecutar» por caso más «Ejecutar todo», todos habilitados al abrir', async () => {
    const html = await dibujar();

    const todos = botones(html);
    expect(todos).toHaveLength(CASOS.length + 1);
    expect(todos.some((b) => /disabled/.test(b))).toBe(false);
    expect(html).toContain('Ejecutar todo');
  });

  it('cada «Ejecutar» dice de qué caso es, para quien lee con lector de pantalla', async () => {
    const html = await dibujar();

    for (const caso of CASOS) expect(html, caso.id).toContain(`: ${caso.titulo.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')}</span>`);
  });

  it('muestra el método y la ruta de cada caso', async () => {
    const html = await dibujar();

    expect(html).toContain('POST /api/v1/clientes');
    expect(html).toContain('/api/v1/clientes/{clienteId}/calificaciones');
  });

  it('la región de avance y resumen existe desde el comienzo, vacía (aria-live)', async () => {
    expect(await dibujar()).toMatch(/<div role="status" aria-live="polite"[^>]*><\/div>/);
  });

  it('no hay resultados hasta ejecutar', async () => {
    expect(await dibujar()).not.toContain('Resultado:');
  });

  it('dice que no cambia la sesión', async () => {
    expect(await dibujar()).toContain('no cambia tu sesión');
  });
});

describe('BotonAccion deshabilitado sin esperar', () => {
  const dibujarBoton = async (props: Record<string, unknown>) =>
    renderToStaticMarkup(createElement(await cargar('componentes/boton-accion.tsx', 'BotonAccion'), { esperando: false, ...props }, 'Apagar'));

  it('por defecto no está deshabilitado', async () => {
    expect(await dibujarBoton({})).not.toContain('disabled');
  });

  it('con deshabilitado queda deshabilitado, sin aria-busy', async () => {
    const html = await dibujarBoton({ deshabilitado: true });

    expect(html).toContain('disabled');
    expect(html).not.toContain('aria-busy');
  });

  it('esperando sigue deshabilitado y con aria-busy', async () => {
    const html = await dibujarBoton({ esperando: true });

    expect(html).toContain('disabled');
    expect(html).toContain('aria-busy="true"');
  });
});
