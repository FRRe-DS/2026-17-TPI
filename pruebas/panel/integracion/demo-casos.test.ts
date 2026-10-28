import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearPedirDeCasos } from '../../../panel/cliente/src/api/casos.js';
import { CASOS } from '../../../panel/cliente/src/logica/casos.js';
import { ejecutarTodo, type EntornoDeCasos, type ResumenDeEjecucion } from '../../../panel/cliente/src/logica/ejecutar-caso.js';
import { levantarPanelConM2, type PanelConM2 } from '../ayudas/panel-con-m2.js';

// El catálogo entero de la vista «Demostración» (spec 072, T12, RNF-07.3, RNF-07.4) contra M2 real: PostgreSQL de Testcontainers,
// el contrato y los manejadores del servicio, el M6 simulado de punta a punta y el panel que reenvía cada pedido con un token
// firmado. Si un caso no da lo que dice, el fallo trae su id y el motivo.
let panel: PanelConM2;
let entorno: EntornoDeCasos;

beforeAll(async () => {
  panel = await levantarPanelConM2();
  entorno = { pedir: crearPedirDeCasos({ fetch: panel.fetchDelPanel }), viajes: panel.viajes };
}, 60_000);

afterAll(async () => {
  await panel.cerrar();
});

const incorrectos = (resumen: ResumenDeEjecucion) => resumen.resultados.filter((r) => !r.veredicto.correcto).map((r) => `${r.casoId}: ${r.veredicto.correcto ? '' : r.veredicto.motivo}`);

describe('el catálogo completo contra M2 real', () => {
  it('todos los casos dan ✔ por el reenvío del panel', async () => {
    const resumen = await ejecutarTodo(CASOS, entorno);

    expect(incorrectos(resumen)).toEqual([]);
    expect(resumen).toMatchObject({ correctos: CASOS.length, incorrectos: 0 });
    expect(resumen.resultados.map((r) => r.casoId)).toEqual(CASOS.map((c) => c.id));
  }, 120_000);

  it('el M6 simulado queda en «normal» al terminar', async () => {
    await ejecutarTodo(CASOS.filter((c) => c.area === 'resiliencia'), entorno);

    expect((await panel.viajes.estado()).modo).toBe('normal');
  }, 60_000);

  it('ningún caso depende del orden ni de otro: en orden inverso y repetido también dan ✔', async () => {
    const resumen = await ejecutarTodo([...CASOS].reverse(), entorno);
    const otraVez = await ejecutarTodo(CASOS, entorno);

    expect(incorrectos(resumen)).toEqual([]);
    expect(incorrectos(otraVez)).toEqual([]);
  }, 180_000);

  it('cada resultado trae el pedido que se mandó y la respuesta que llegó', async () => {
    const resumen = await ejecutarTodo(CASOS.slice(0, 3), entorno);

    for (const resultado of resumen.resultados) {
      expect(resultado.pedido).toBeDefined();
      expect(resultado.respuesta?.estado).toBe(resultado.esperado.estado);
    }
  }, 30_000);

  it('un caso de resiliencia repone el M6 en el modo en que estaba («lento»), no en «normal»', async () => {
    const resiliencia = CASOS.find((c) => c.area === 'resiliencia')!;
    await panel.ponerModo('lento');
    try {
      const resumen = await ejecutarTodo([resiliencia], entorno);

      expect(resumen.resultados).toHaveLength(1);
      expect((await panel.viajes.estado()).modo).toBe('lento');
    } finally {
      await panel.ponerModo('normal');
    }
  }, 30_000);
});
