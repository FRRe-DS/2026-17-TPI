import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { armarConteo, veredictoDeRestriccion, veredictoSimultaneo } from '../../../panel/cliente/src/logica/integridad.js';
import { levantarPanelConM2, type PanelConM2 } from '../ayudas/panel-con-m2.js';

// La sección «Integridad» de la vista de demostración (spec 072, T15, RNF-08.2 a RNF-08.4, RNF-05.5) contra el panel de verdad:
// PostgreSQL de Testcontainers, M2 real con el contrato, el M6 simulado y el panel con su acceso a la base. Se llama a las mismas
// funciones de `api/panel.ts` que usa la vista y se decide con la misma lógica de `logica/integridad.ts`.
let panel: PanelConM2;
beforeAll(async () => {
  panel = await levantarPanelConM2();
}, 60_000);
afterEach(async () => {
  await panel.ponerModo('normal');
});
afterAll(async () => {
  await panel?.cerrar();
});

const filasDe = (resultado: Parameters<typeof armarConteo>[0]) => Object.fromEntries(armarConteo(resultado).filas.map((fila) => [fila.codigo, fila.obtenidas]));

describe('altas simultáneas (RNF-08.2, RNF-08.3)', () => {
  it('con la misma clave: N respuestas 201 con el mismo cuerpo y una sola fila', async () => {
    const resultado = await panel.apiPanel.lanzarAltasSimultaneas(10, 'misma-clave');

    expect(veredictoSimultaneo(resultado)).toEqual({ correcto: true, titulo: 'Correcto', motivos: [] });
    expect(filasDe(resultado)).toEqual({ 201: 10 });
    expect(resultado).toMatchObject({ cuerposIguales: true, filas: 1 });
  });

  it('con claves distintas: un 201, N−1 respuestas 409 y una sola fila', async () => {
    const resultado = await panel.apiPanel.lanzarAltasSimultaneas(10, 'claves-distintas');

    expect(veredictoSimultaneo(resultado).correcto).toBe(true);
    expect(filasDe(resultado)).toEqual({ 201: 1, 409: 9 });
    expect(resultado.filas).toBe(1);
  });

  it.each([[2], [50]])('con N = %i en el límite del campo, también', async (n) => {
    for (const modo of ['misma-clave', 'claves-distintas'] as const) {
      const resultado = await panel.apiPanel.lanzarAltasSimultaneas(n, modo);

      expect(veredictoSimultaneo(resultado), `${modo} N=${n}`).toMatchObject({ correcto: true });
      expect(resultado.n).toBe(n);
    }
  });

  it('el folio de la corrida sirve para buscar los pedidos en los logs de M2', async () => {
    const resultado = await panel.apiPanel.lanzarAltasSimultaneas(2, 'misma-clave');

    expect(resultado.prefijoRequestId).toMatch(/^panel-demo-[0-9a-f]{8}-$/);
  });
});

describe('calificaciones simultáneas (RNF-08.4)', () => {
  it('un 201, N−1 respuestas 409 y una sola fila en calificaciones', async () => {
    const resultado = await panel.apiPanel.lanzarCalificacionesSimultaneas(10);

    expect(veredictoSimultaneo(resultado)).toEqual({ correcto: true, titulo: 'Correcto', motivos: [] });
    expect(filasDe(resultado)).toEqual({ 201: 1, 409: 9 });
    expect(resultado.filas).toBe(1);
  });

  it('con N = 50 también', async () => {
    const resultado = await panel.apiPanel.lanzarCalificacionesSimultaneas(50);

    expect(veredictoSimultaneo(resultado).correcto).toBe(true);
    expect(filasDe(resultado)).toEqual({ 201: 1, 409: 49 });
  });

  it('deja el M6 simulado en el modo en que estaba', async () => {
    await panel.ponerModo('lento');

    await panel.apiPanel.lanzarCalificacionesSimultaneas(2);

    expect((await panel.viajes.estado()).modo).toBe('lento');
  });
});

describe('la restricción del puntaje (RNF-05.5)', () => {
  it('la base rechaza el puntaje 9 con su restricción y no cambia nada', async () => {
    const resultado = await panel.apiPanel.probarRestriccionDelPuntaje();

    expect(veredictoDeRestriccion(resultado)).toEqual({ correcto: true, titulo: 'Correcto', motivos: [] });
    expect(resultado).toMatchObject({ restriccion: 'calificaciones_puntaje_valido', codigo: '23514', filasAntes: 0, filasDespues: 0 });
    expect(resultado.mensaje).toContain('calificaciones_puntaje_valido');
  });

  it('no deja ninguna calificación en la base', async () => {
    const resultado = await panel.apiPanel.probarRestriccionDelPuntaje();

    const { rows } = await panel.pool.query('SELECT count(*)::int AS n FROM calificaciones WHERE cliente_id = $1', [resultado.clienteId]);
    expect(rows[0].n).toBe(0);
  });
});

describe('sin Docker, la vista de la base queda lista para T16', () => {
  it('el estado informa la base disponible y Docker no disponible, con su motivo', async () => {
    const estado = await panel.apiPanel.obtenerEstadoDemo();

    expect(estado.base).toEqual({ disponible: true });
    expect(estado.docker.disponible).toBe(false);
    expect(estado.docker.motivo).toBeTruthy();
  });
});
