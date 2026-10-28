import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorDeApi } from '../../../panel/cliente/src/api/errores.js';
import type { ResultadoRestriccion, ResultadoSimultaneo } from '../../../panel/cliente/src/api/panel.js';

// Una prueba de la sección «Integridad» (spec 072, T15, RNF-08.2 a RNF-08.4, RNF-05.5), dibujada con `renderToStaticMarkup`: la tabla
// de respuestas por código, las filas en la base, lo esperado y el veredicto; y la restricción con el mensaje de PostgreSQL.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cualquiera = ComponentType<any>;
async function PruebaIntegridad(): Promise<Cualquiera> {
  const ruta: string = new URL('../../../panel/cliente/src/componentes/prueba-integridad.tsx', import.meta.url).pathname;
  return ((await import(ruta)) as Record<string, Cualquiera>).PruebaIntegridad!;
}

const SIMULTANEO: ResultadoSimultaneo = {
  clienteId: 'c-1',
  n: 10,
  porCodigo: { 201: 1, 409: 9 },
  filas: 1,
  esperado: { porCodigo: { 201: 1, 409: 9 }, filas: 1 },
  cumple: true,
  prefijoRequestId: 'panel-demo-ab12cd34-',
};
const RESTRICCION: ResultadoRestriccion = {
  clienteId: 'c-1',
  filasAntes: 0,
  filasDespues: 0,
  restriccion: 'calificaciones_puntaje_valido',
  codigo: '23514',
  mensaje: 'new row for relation "calificaciones" violates check constraint "calificaciones_puntaje_valido"',
  cumple: true,
};
const base = { id: 'p1', titulo: 'Altas simultáneas con claves distintas', explicacion: 'N pedidos a la vez.', etiquetaBoton: 'Lanzar las altas', esperando: false, deshabilitado: false, alLanzar: () => undefined };
const dibujar = async (props: Record<string, unknown>) => renderToStaticMarkup(createElement(await PruebaIntegridad(), { ...base, ...props }));

describe('PruebaIntegridad: antes de lanzarla', () => {
  it('el título, la explicación y el botón, sin resultado', async () => {
    const html = await dibujar({});

    expect(html).toContain('Altas simultáneas con claves distintas');
    expect(html).toContain('N pedidos a la vez.');
    expect(html).toContain('Lanzar las altas');
    expect(html).not.toContain('Correcto');
    expect(html).not.toContain('<table');
  });

  it('esperando: el botón queda deshabilitado con «Lanzando…»', async () => {
    const html = await dibujar({ esperando: true });

    expect(html).toContain('disabled');
    expect(html).toContain('Lanzando…');
  });

  it('deshabilitado por otra ejecución: sin aria-busy', async () => {
    const html = await dibujar({ deshabilitado: true });

    expect(html).toContain('disabled');
    expect(html).not.toContain('aria-busy');
  });
});

describe('PruebaIntegridad: una prueba simultánea', () => {
  const con = (resultado: ResultadoSimultaneo) => dibujar({ resultado: { tipo: 'simultaneo', datos: resultado } });

  it('la tabla tiene una fila por código con lo que llegó y lo que se esperaba', async () => {
    const html = await con(SIMULTANEO);

    expect(html).toContain('<table');
    expect(html).toMatch(/<th scope="row">201<\/th><td>1<\/td><td>1<\/td>/);
    expect(html).toMatch(/<th scope="row">409<\/th><td>9<\/td><td>9<\/td>/);
    expect(html).toContain('Código');
    expect(html).toContain('Llegaron');
    expect(html).toContain('Se esperaban');
  });

  it('la tabla está en una caja con desplazamiento que se alcanza con el teclado (RNF-15.6)', async () => {
    const html = await con(SIMULTANEO);

    expect(html).toMatch(/<div[^>]*tabindex="0"[^>]*role="region"|<div[^>]*role="region"[^>]*tabindex="0"/);
    expect(html).toContain('aria-label="Respuestas por código: Altas simultáneas con claves distintas"');
  });

  it('las filas en la base y el cliente de la prueba', async () => {
    const html = await con(SIMULTANEO);

    expect(html).toContain('Filas en la base');
    expect(html).toContain('c-1');
  });

  it('el folio de la corrida y cómo buscarla en los logs de M2', async () => {
    const html = await con(SIMULTANEO);

    expect(html).toContain('panel-demo-ab12cd34-');
    expect(html).toContain('docker compose logs m2');
  });

  it('✔ «Correcto»', async () => {
    const html = await con(SIMULTANEO);

    expect(html).toContain('Correcto');
    expect(html).not.toContain('No coincide');
  });

  it('✘ «No coincide» con cada motivo, y marca la fila que no coincide', async () => {
    const html = await con({ ...SIMULTANEO, porCodigo: { 201: 2, 409: 8 }, filas: 2, cumple: false });

    expect(html).toContain('No coincide');
    expect(html).toContain('Código 201: se esperaba 1, llegaron 2.');
    expect(html).toContain('Filas en la base: se esperaba 1, hay 2.');
  });

  it('con la misma clave dice si los 201 trajeron el mismo cuerpo', async () => {
    expect(await con({ ...SIMULTANEO, cuerposIguales: true })).toContain('mismo cuerpo');
    expect(await con({ ...SIMULTANEO, cuerposIguales: undefined })).not.toContain('mismo cuerpo');
  });

  it('los pedidos sin respuesta salen como «Sin respuesta»', async () => {
    const html = await con({ ...SIMULTANEO, porCodigo: { 0: 2, 201: 1, 409: 7 }, cumple: false });

    expect(html).toContain('Sin respuesta');
    expect(html).toContain('Hubo 2 pedidos sin respuesta.');
  });

  it('si no se pudieron contar las filas dice por qué', async () => {
    const html = await con({ ...SIMULTANEO, filas: null, motivoFilas: 'la base no responde (ECONNREFUSED)', cumple: false });

    expect(html).toContain('sin contar');
    expect(html).toContain('la base no responde (ECONNREFUSED)');
  });
});

describe('PruebaIntegridad: la restricción del puntaje', () => {
  const con = (resultado: ResultadoRestriccion) => dibujar({ id: 'r', titulo: 'Restricción del puntaje', resultado: { tipo: 'restriccion', datos: resultado } });

  it('✔ muestra la restricción, el código y el mensaje de PostgreSQL', async () => {
    const html = await con(RESTRICCION);

    expect(html).toContain('calificaciones_puntaje_valido');
    expect(html).toContain('23514');
    expect(html).toContain('violates check constraint');
    expect(html).toContain('Correcto');
    expect(html).not.toContain('<table');
  });

  it('el mensaje de PostgreSQL se pone como texto, nunca como HTML', async () => {
    const html = await con({ ...RESTRICCION, mensaje: '<img src=x onerror=alert(1)>' });

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('las calificaciones antes y después', async () => {
    const html = await con({ ...RESTRICCION, filasAntes: 3, filasDespues: 3 });

    expect(html).toMatch(/Antes<\/dt><dd>3</);
    expect(html).toMatch(/Después<\/dt><dd>3</);
  });

  it('✘ si la base aceptó el puntaje 9', async () => {
    const html = await con({ clienteId: 'c-1', filasAntes: 0, filasDespues: 1, mensaje: 'la base aceptó el puntaje 9: falta la restricción', cumple: false });

    expect(html).toContain('No coincide');
    expect(html).toContain('la base aceptó el puntaje 9: falta la restricción');
  });
});

describe('PruebaIntegridad: si el panel no pudo lanzarla', () => {
  it('muestra el error tal como vino, con «Reintentar»', async () => {
    const error = new ErrorDeApi({ sinRespuesta: false, estado: 502, type: '/panel/errores/preparacion-fallida', title: 'No se pudo preparar la prueba', detail: 'crear el cliente: M2 respondió 503' });

    const html = await dibujar({ error });

    expect(html).toContain('role="alert"');
    expect(html).toContain('No se pudo preparar la prueba');
    expect(html).toContain('/panel/errores/preparacion-fallida');
    expect(html).toContain('Reintentar');
  });
});
