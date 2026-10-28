import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearBaseDemo, type BaseDemo } from '../../../panel/servidor/demo/base.js';
import { altasSimultaneas, type DependenciasConcurrencia } from '../../../panel/servidor/demo/concurrencia.js';
import { CONFIG_PANEL } from '../ayudas/app.js';
import { levantarPanelConM2, type PanelConM2 } from '../ayudas/panel-con-m2.js';

// Las pruebas simultáneas de la vista de demostración (spec 072, T5 y T6) contra M2 real, con PostgreSQL de Testcontainers, el
// M6 simulado y el panel. Lo que importa es lo que queda en la base: una sola fila, aunque lleguen N pedidos a la vez
// (RNF-08.2, RNF-08.3, RNF-08.4).
let panel: PanelConM2;
let base: BaseDemo;
let dependencias: DependenciasConcurrencia;

beforeAll(async () => {
  panel = await levantarPanelConM2();
  base = crearBaseDemo(panel.urlBd);
  dependencias = { config: { ...CONFIG_PANEL, urlM2: panel.urlM2, urlM6Control: panel.urlM6Control }, base };
}, 60_000);

afterAll(async () => {
  await base.cerrar();
  await panel.cerrar();
});

describe('altasSimultaneas con M2 real (RNF-08.2, RNF-08.3)', () => {
  it('N = 10 con la misma clave: diez 201 con el mismo cuerpo y una sola fila', async () => {
    const resultado = await altasSimultaneas(dependencias, { n: 10, modo: 'misma-clave' });

    expect(resultado).toMatchObject({
      n: 10,
      porCodigo: { 201: 10 },
      cuerposIguales: true,
      filas: 1,
      esperado: { porCodigo: { 201: 10 }, filas: 1 },
      cumple: true,
    });
  });

  it('N = 10 con claves distintas: un 201, nueve 409 y una sola fila', async () => {
    const resultado = await altasSimultaneas(dependencias, { n: 10, modo: 'claves-distintas' });

    expect(resultado).toMatchObject({
      n: 10,
      porCodigo: { 201: 1, 409: 9 },
      filas: 1,
      esperado: { porCodigo: { 201: 1, 409: 9 }, filas: 1 },
      cumple: true,
    });
    expect(resultado.cuerposIguales).toBeUndefined();
  });

  it('cada corrida usa un cliente nuevo y un prefijo de X-Request-Id propio', async () => {
    const primera = await altasSimultaneas(dependencias, { n: 2, modo: 'misma-clave' });
    const segunda = await altasSimultaneas(dependencias, { n: 2, modo: 'misma-clave' });

    expect(primera.clienteId).not.toBe(segunda.clienteId);
    expect(primera.prefijoRequestId).toMatch(/^panel-demo-[0-9a-f]{8}-$/);
    expect(primera.prefijoRequestId).not.toBe(segunda.prefijoRequestId);
  });

  it('con la base del panel no disponible: filas null, el motivo y no cumple, aunque M2 responda bien', async () => {
    const sinBase = crearBaseDemo(undefined);

    const resultado = await altasSimultaneas({ ...dependencias, base: sinBase }, { n: 3, modo: 'misma-clave' });
    await sinBase.cerrar();

    expect(resultado.porCodigo).toEqual({ 201: 3 });
    expect(resultado.filas).toBeNull();
    expect(resultado.motivoFilas).toContain('no configurada');
    expect(resultado.cumple).toBe(false);
  });
});
