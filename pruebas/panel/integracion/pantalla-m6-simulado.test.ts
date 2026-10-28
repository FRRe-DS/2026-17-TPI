import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ETIQUETA_VIAJES } from '../../../panel/cliente/src/fuentes/viajes-simulados.js';
import { cuerpoDeCalificacion } from '../../../panel/cliente/src/logica/calificacion.js';
import { CLIENTE_DE_EJEMPLO, cuerpoDeAlta } from '../../../panel/cliente/src/logica/campos-cliente.js';
import { respuestaEsperada } from '../../../panel/cliente/src/logica/m6-simulado.js';
import { enlace, interpretar } from '../../../panel/cliente/src/rutas.js';
import { levantarPanelConM2, RETARDO_LENTO_MS, type PanelConM2 } from '../ayudas/panel-con-m2.js';

// La pantalla `m6-simulado` (T32, RNF-13.5, RNF-12.7) contra el panel de verdad: PostgreSQL, M2, el panel y el M6 simulado. Lo que
// la pantalla dice que M2 va a contestar se compara con lo que M2 contesta.

let panel: PanelConM2;
beforeAll(async () => {
  panel = await levantarPanelConM2();
});
afterEach(async () => {
  await panel.viajes.ponerModo('normal');
});
afterAll(async () => {
  await panel?.cerrar();
});

describe('el modo del M6 simulado', () => {
  it('empieza en normal y lo dice el canal de control, con cuánto espera el modo lento', async () => {
    expect(await panel.viajes.estado()).toEqual({ modo: 'normal', retardoLentoMs: RETARDO_LENTO_MS });
  });

  it.each([['lento' as const], ['caido' as const], ['normal' as const]])('se puede poner en %s y el estado lo confirma', async (modo) => {
    const respondido = await panel.viajes.ponerModo(modo);

    expect(respondido.modo).toBe(modo);
    expect((await panel.viajes.estado()).modo).toBe(modo);
  });

  it('con el M6 caído, el canal de control sigue: se puede volver a normal desde la pantalla', async () => {
    await panel.viajes.ponerModo('caido');

    expect((await panel.viajes.estado()).modo).toBe('caido');
    expect((await panel.viajes.ponerModo('normal')).modo).toBe('normal');
  });

  it('la etiqueta de lo simulado es «simulado, pendiente de M6»', () => {
    expect(panel.viajes.etiqueta).toBe('simulado, pendiente de M6');
    expect(ETIQUETA_VIAJES).toBe('simulado, pendiente de M6');
  });
});

describe('los cuatro escenarios: lo que dice la pantalla es lo que contesta M2 (RNF-13.5)', () => {
  async function clienteConEscenarios() {
    const clienteId = randomUUID();
    const api = panel.api(() => ({ rol: 'CLIENTE', sub: clienteId }));
    await api.crearCliente(cuerpoDeAlta(CLIENTE_DE_EJEMPLO), randomUUID());
    const { escenarios } = await panel.viajes.cargarEjemplo(clienteId);
    return { clienteId, api, escenarios };
  }

  const estadoAlCalificar = async (api: ReturnType<PanelConM2['api']>, clienteId: string, viajeId: string): Promise<number> =>
    api.calificarConductor(clienteId, cuerpoDeCalificacion(viajeId, { puntaje: '4', comentario: '' }), randomUUID()).then(
      () => 201,
      (e: { estado: number }) => e.estado,
    );

  it('trae los cuatro, con 201, 422, 404 y 404', async () => {
    const { escenarios } = await clienteConEscenarios();

    expect(escenarios.map((e) => [e.nombre, e.respuestaDeM2])).toEqual([['completado', 201], ['enCurso', 422], ['ajeno', 404], ['inexistente', 404]]);
    expect(new Set(escenarios.map((e) => e.viajeId)).size).toBe(4);
  });

  it.each([['lento' as const], ['caido' as const], ['normal' as const]])('en modo %s, cada escenario responde lo que dice la pantalla', async (modo) => {
    const { clienteId, api, escenarios } = await clienteConEscenarios();
    await panel.viajes.ponerModo(modo);

    for (const escenario of escenarios) {
      const dicho = Number(respuestaEsperada(escenario, modo).slice(0, 3));
      expect([escenario.nombre, await estadoAlCalificar(api, clienteId, escenario.viajeId)]).toEqual([escenario.nombre, dicho]);
    }
  });

  it('con el M6 lento o caído, la respuesta lleva Retry-After para la cuenta regresiva', async () => {
    const { clienteId, api, escenarios } = await clienteConEscenarios();
    await panel.viajes.ponerModo('lento');

    const error = await api.calificarConductor(clienteId, cuerpoDeCalificacion(escenarios[0]!.viajeId, { puntaje: '4', comentario: '' }), randomUUID()).catch((e: unknown) => e);

    expect(error).toMatchObject({ estado: 503, reintentarEnS: 7 });
  });

  it('cada escenario tiene un enlace a «Calificar» que la ruta entiende', async () => {
    const { escenarios } = await clienteConEscenarios();

    for (const { viajeId } of escenarios) expect(interpretar(enlace('calificar', viajeId))).toEqual({ pantalla: 'calificar', id: viajeId });
  });

  it('cargar los viajes otra vez deja los mismos identificadores', async () => {
    const { clienteId, escenarios } = await clienteConEscenarios();

    expect((await panel.viajes.cargarEjemplo(clienteId)).escenarios).toEqual(escenarios);
  });
});
