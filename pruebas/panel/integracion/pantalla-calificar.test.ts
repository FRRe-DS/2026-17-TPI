import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ErrorDeApi } from '../../../panel/cliente/src/api/errores.js';
import type { ApiM2 } from '../../../panel/cliente/src/api/m2.js';
import { DependenciaNoDisponible } from '../../../panel/cliente/src/componentes/dependencia-no-disponible.js';
import { crearClaveDeIdempotencia } from '../../../panel/cliente/src/logica/clave-idempotencia.js';
import { cuerpoDeCalificacion } from '../../../panel/cliente/src/logica/calificacion.js';
import { CLIENTE_DE_EJEMPLO, cuerpoDeAlta } from '../../../panel/cliente/src/logica/campos-cliente.js';
import { cargarEjemplo } from '../../../panel/cliente/src/logica/ejemplo.js';
import { crearAccion } from '../../../panel/cliente/src/logica/estados.js';
import { mensajeDeCalificacion } from '../../../panel/cliente/src/logica/mensajes.js';
import { Calificar } from '../../../panel/cliente/src/pantallas/calificar.js';
import { levantarPanelConM2, REINTENTAR_DESPUES_S, type PanelConM2 } from '../ayudas/panel-con-m2.js';

// La pantalla `calificar` (T26, RF-2.5.15, RF-2.5.16) contra el panel de verdad: PostgreSQL, M2, el panel y el M6 simulado. Los
// escenarios son los que carga «Cargar ejemplo»: completado (201), en curso (422), ajeno y inexistente (404).

let panel: PanelConM2;
beforeAll(async () => {
  panel = await levantarPanelConM2();
});
afterEach(async () => {
  await panel.ponerModo('normal');
  vi.restoreAllMocks();
});
afterAll(async () => {
  await panel?.cerrar();
});

type Viajes = Record<'completado' | 'enCurso' | 'ajeno' | 'inexistente', string>;

async function clienteConEjemplo(): Promise<{ clienteId: string; api: ApiM2; viajes: Viajes }> {
  const clienteId = randomUUID();
  const api = panel.api(() => ({ rol: 'CLIENTE', sub: clienteId }));
  await api.crearCliente(cuerpoDeAlta(CLIENTE_DE_EJEMPLO), randomUUID());
  const { escenarios } = await cargarEjemplo({ api, viajes: panel.viajes }, clienteId, () => undefined);
  const viajes = Object.fromEntries(escenarios.map((e) => [e.nombre, e.viajeId])) as Viajes;
  return { clienteId, api, viajes };
}

const filas = async (clienteId: string) => {
  const { rows } = await panel.pool.query('SELECT count(*)::int AS n FROM calificaciones WHERE cliente_id = $1', [clienteId]);
  return (rows[0] as { n: number }).n;
};

const rechazo = async (promesa: Promise<unknown>): Promise<ErrorDeApi> => {
  const error = await promesa.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ErrorDeApi);
  return error as ErrorDeApi;
};

describe('calificar un viaje completado (RF-2.5.15)', () => {
  it('201: M2 guarda el puntaje y el comentario que se mandaron', async () => {
    const { clienteId, api, viajes } = await clienteConEjemplo();

    const creada = await api.calificarConductor(clienteId, cuerpoDeCalificacion(viajes.completado, { puntaje: '4', comentario: ' Muy bien ' }), randomUUID());

    expect(creada).toMatchObject({ viajeId: viajes.completado, puntaje: 4, comentario: 'Muy bien' });
    expect(await filas(clienteId)).toBe(1);
  });

  it('sin comentario, M2 no inventa uno', async () => {
    const { clienteId, api, viajes } = await clienteConEjemplo();

    const creada = await api.calificarConductor(clienteId, cuerpoDeCalificacion(viajes.completado, { puntaje: '5', comentario: '' }), randomUUID());

    expect(creada).not.toHaveProperty('comentario');
  });

  it('la misma Idempotency-Key dos veces deja una sola calificación y devuelve la misma', async () => {
    const { clienteId, api, viajes } = await clienteConEjemplo();
    const cuerpo = cuerpoDeCalificacion(viajes.completado, { puntaje: '3', comentario: '' });
    const clave = randomUUID();

    const primera = await api.calificarConductor(clienteId, cuerpo, clave);
    const segunda = await api.calificarConductor(clienteId, cuerpo, clave);

    expect(segunda).toEqual(primera);
    expect(await filas(clienteId)).toBe(1);
  });
});

describe('lo que M2 rechaza, con su texto (RF-2.5.16)', () => {
  it('409: el mismo viaje con otra clave ya está calificado', async () => {
    const { clienteId, api, viajes } = await clienteConEjemplo();
    const cuerpo = cuerpoDeCalificacion(viajes.completado, { puntaje: '3', comentario: '' });
    await api.calificarConductor(clienteId, cuerpo, randomUUID());

    const error = await rechazo(api.calificarConductor(clienteId, cuerpo, randomUUID()));

    expect(error).toMatchObject({ estado: 409, type: '/errores/calificacion-duplicada' });
    expect(mensajeDeCalificacion(error)).toBe('Ya calificaste este viaje.');
    expect(await filas(clienteId)).toBe(1);
  });

  it('422: el viaje en curso todavía no está completado', async () => {
    const { clienteId, api, viajes } = await clienteConEjemplo();

    const error = await rechazo(api.calificarConductor(clienteId, cuerpoDeCalificacion(viajes.enCurso, { puntaje: '3', comentario: '' }), randomUUID()));

    expect(error).toMatchObject({ estado: 422, type: '/errores/viaje-no-completado' });
    expect(mensajeDeCalificacion(error)).toBe('El viaje todavía no está completado.');
    expect(await filas(clienteId)).toBe(0);
  });

  it('422: la misma clave con otro puntaje es una clave reutilizada', async () => {
    const { clienteId, api, viajes } = await clienteConEjemplo();
    const clave = randomUUID();
    await api.calificarConductor(clienteId, cuerpoDeCalificacion(viajes.completado, { puntaje: '3', comentario: '' }), clave);

    const error = await rechazo(api.calificarConductor(clienteId, cuerpoDeCalificacion(viajes.completado, { puntaje: '5', comentario: '' }), clave));

    expect(error).toMatchObject({ estado: 422, type: '/errores/idempotencia-reutilizada' });
    expect(mensajeDeCalificacion(error)).toContain('ya se envió con otros datos');
    expect(await filas(clienteId)).toBe(1);
  });

  it.each([['ajeno'], ['inexistente']] as const)('404: el viaje %s', async (nombre) => {
    const { clienteId, api, viajes } = await clienteConEjemplo();

    const error = await rechazo(api.calificarConductor(clienteId, cuerpoDeCalificacion(viajes[nombre], { puntaje: '3', comentario: '' }), randomUUID()));

    expect(error.estado).toBe(404);
    expect(mensajeDeCalificacion(error)).toBe('Viaje no encontrado.');
    expect(await filas(clienteId)).toBe(0);
  });

  it('400: un puntaje fuera del contrato no tiene texto propio, va el error de M2', async () => {
    const { clienteId, api, viajes } = await clienteConEjemplo();

    const error = await rechazo(api.calificarConductor(clienteId, { viajeId: viajes.completado, puntaje: 6 }, randomUUID()));

    expect(error.estado).toBe(400);
    expect(mensajeDeCalificacion(error)).toBeUndefined();
  });
});

describe.each([['caido' as const], ['lento' as const]])('con el M6 simulado en modo %s (RF-2.5.16)', (modo) => {
  it('503 con Retry-After, sin guardar nada, con el texto de la dependencia y la cuenta', async () => {
    const { clienteId, api, viajes } = await clienteConEjemplo();
    await panel.ponerModo(modo);

    const error = await rechazo(api.calificarConductor(clienteId, cuerpoDeCalificacion(viajes.completado, { puntaje: '3', comentario: '' }), randomUUID()));

    expect(error).toMatchObject({ estado: 503, reintentarEnS: REINTENTAR_DESPUES_S });
    expect(mensajeDeCalificacion(error)).toBe('Calificar depende del módulo de viajes (M6), que no contestó.');
    const html = renderToStaticMarkup(createElement(DependenciaNoDisponible, { error, que: 'Calificar', alReintentar: () => undefined }));
    expect(html).toContain('Calificar depende del módulo de viajes (M6)');
    expect(html).toContain(`Podés reintentar en ${REINTENTAR_DESPUES_S} s.`);
    expect(await filas(clienteId)).toBe(0);
  });
});

// Lo que hace el formulario al enviar: la acción con la clave que genera al abrirse, tal como la arma `pantallas/calificar.tsx`.
function formulario(api: ApiM2, clienteId: string, viajeId: string) {
  const claves: (string | undefined)[] = [];
  const clave = crearClaveDeIdempotencia();
  clave.abrir();
  const accion = crearAccion({
    ejecutar: ({ clave: idempotencia, senal }, puntaje: string) => {
      claves.push(idempotencia);
      return api.calificarConductor(clienteId, cuerpoDeCalificacion(viajeId, { puntaje, comentario: '' }), idempotencia!, { senal });
    },
    aviso: 'Calificación enviada.',
    clave,
  });
  return { accion, claves, clave };
}

describe('la Idempotency-Key del formulario (RF-2.5.15)', () => {
  it('ante un 503 se conserva, y «Reintentar» manda la misma: queda una calificación', async () => {
    const { clienteId, api, viajes } = await clienteConEjemplo();
    const { accion, claves, clave } = formulario(api, clienteId, viajes.completado);
    await panel.ponerModo('caido');

    await accion.enviar('4');

    expect(accion.estado()).toMatchObject({ fase: 'fallida', error: { estado: 503 } });
    expect(clave.actual()).toBe(claves[0]);
    await panel.ponerModo('normal');
    await accion.reintentar();

    expect(accion.estado()).toMatchObject({ fase: 'hecha', resultado: { puntaje: 4 } });
    expect(claves).toHaveLength(2);
    expect(claves[1]).toBe(claves[0]);
    expect(await filas(clienteId)).toBe(1);
  });

  it('ante un rechazo de M2 también se conserva, y se descarta al enviar bien', async () => {
    const { clienteId, api, viajes } = await clienteConEjemplo();
    const { accion, claves, clave } = formulario(api, clienteId, viajes.completado);

    await accion.enviar('9');
    expect(accion.estado()).toMatchObject({ fase: 'fallida', error: { estado: 400 } });
    expect(clave.actual()).toBe(claves[0]);

    await accion.enviar('5');
    expect(accion.estado()).toMatchObject({ fase: 'hecha' });
    expect(claves[1]).toBe(claves[0]);
    expect(clave.actual()).toBeUndefined();
  });

  it('un envío que llegó a M2 pero no se supo (cliente sin respuesta) se reintenta con la misma clave y no duplica', async () => {
    const { clienteId, api, viajes } = await clienteConEjemplo();
    const { accion, claves } = formulario(api, clienteId, viajes.completado);
    // M2 guarda la calificación, pero el panel cuenta el tiempo agotado: el pedido real salió y la respuesta se perdió.
    const original = api.calificarConductor.bind(api);
    vi.spyOn(api, 'calificarConductor').mockImplementationOnce(async (...argumentos) => {
      await original(...argumentos);
      throw new ErrorDeApi({ sinRespuesta: true, estado: 504, type: '/panel/errores/m2-no-responde', title: 'M2 no responde' });
    });

    await accion.enviar('2');
    expect(accion.estado()).toMatchObject({ fase: 'fallida', error: { sinRespuesta: true } });
    await accion.reintentar();

    expect(accion.estado()).toMatchObject({ fase: 'hecha', resultado: { puntaje: 2 } });
    expect(claves[1]).toBe(claves[0]);
    expect(await filas(clienteId)).toBe(1);
  });

  it('dos toques seguidos mandan un solo pedido', async () => {
    const { clienteId, api, viajes } = await clienteConEjemplo();
    const { accion, claves } = formulario(api, clienteId, viajes.completado);
    const pedido = vi.spyOn(api, 'calificarConductor');

    await Promise.all([accion.enviar('5'), accion.enviar('5')]);

    expect(pedido).toHaveBeenCalledTimes(1);
    expect(claves).toHaveLength(1);
    expect(await filas(clienteId)).toBe(1);
  });

  it('mientras espera, el estado lo dice (el botón se deshabilita con él)', async () => {
    const { clienteId, api, viajes } = await clienteConEjemplo();
    const { accion } = formulario(api, clienteId, viajes.completado);

    const enviando = accion.enviar('5');

    expect(accion.estado().fase).toBe('esperando');
    await enviando;
  });
});

describe('el formulario dibujado', () => {
  const sesion = { rol: 'CLIENTE' as const, sub: randomUUID() };
  const viajeId = randomUUID();

  it('puntaje de 1 a 5 de una sola elección, comentario con contador y el botón habilitado', async () => {
    const { api } = await clienteConEjemplo();

    const html = renderToStaticMarkup(createElement(Calificar, { api, sesion, viajeId }));

    expect(html).toContain('<fieldset');
    expect(html.match(/type="radio"/g)).toHaveLength(5);
    expect(html).toContain('0 de 500 caracteres');
    expect(html).toContain(viajeId);
    expect(html).toMatch(/<button[^>]*type="submit"(?![^>]*disabled)[^>]*><span[^>]*>Enviar calificación/);
  });
});
