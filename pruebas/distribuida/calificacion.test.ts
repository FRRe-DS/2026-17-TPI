import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { crearClienteEnM2 } from './ayudas/clientes.js';
import { validarContraContrato } from './ayudas/contrato.js';
import { describirRespuesta } from './ayudas/errores.js';
import { pedirM2, type Respuesta } from './ayudas/pedir.js';
import { crearViaje, type Viaje } from './ayudas/viajes.js';

// Calificar al conductor de un viaje completado, contra el M6 real (RF-2.5, RNF-07.9). M2 le pregunta a M6 el estado del viaje y
// de quién es; el conductor calificado sale de esa respuesta, no del cuerpo del pedido (que no lo admite).
type Calificacion = { calificacionId: string; viajeId: string; conductorId: string; puntaje: number };
type Pagina = { items: Calificacion[]; totalElementos: number };

describe('calificar al conductor de un viaje con el M6 real (RF-2.5, RNF-07.9)', () => {
  let clienteId: string;
  let token: string;
  let viaje: Viaje;
  let primera: Respuesta;

  const calificar = (viajeId: string, clave: string = randomUUID(), puntaje = 5) =>
    pedirM2(token, 'POST', `/api/v1/clientes/${clienteId}/calificaciones`, {
      cuerpo: { viajeId, puntaje, comentario: 'Todo bien' },
      encabezados: { 'idempotency-key': clave },
      consultaM6: true,
    });

  beforeAll(async () => {
    ({ clienteId, token } = await crearClienteEnM2());
    viaje = await crearViaje(clienteId, 'COMPLETED');
    primera = await calificar(viaje.viajeId);
  });

  it('calificar un viaje COMPLETED da 201', () => {
    expect(primera.estado, describirRespuesta(primera)).toBe(201);
    expect(primera.cuerpo).toMatchObject({ viajeId: viaje.viajeId, puntaje: 5 });
  });

  it('el conductorId guardado es el que informa M6, no uno que mande el cliente', async () => {
    expect((primera.cuerpo as Calificacion).conductorId).toBe(viaje.conductorId);
    // El contrato no admite un conductorId en el cuerpo: M2 lo rechaza en vez de usarlo.
    const conConductor = await pedirM2(token, 'POST', `/api/v1/clientes/${clienteId}/calificaciones`, {
      cuerpo: { viajeId: viaje.viajeId, puntaje: 5, conductorId: randomUUID() },
      encabezados: { 'idempotency-key': randomUUID() },
    });
    expect(conConductor.estado, describirRespuesta(conConductor)).toBe(400);
  });

  it('repetir con otra Idempotency-Key da 409 calificacion-duplicada', async () => {
    const repetida = await calificar(viaje.viajeId, randomUUID(), 3);
    expect(repetida.estado, describirRespuesta(repetida)).toBe(409);
    expect(repetida.cuerpo).toMatchObject({ type: '/errores/calificacion-duplicada', status: 409 });
    expect(validarContraContrato('Problema', repetida.cuerpo)).toEqual([]);
  });

  it('listarCalificaciones muestra una sola, la primera', async () => {
    const lista = await pedirM2(token, 'GET', `/api/v1/clientes/${clienteId}/calificaciones`);
    expect(lista.estado, describirRespuesta(lista)).toBe(200);
    const pagina = lista.cuerpo as Pagina;
    expect(pagina.items).toHaveLength(1);
    expect(pagina.totalElementos).toBe(1);
    expect(pagina.items[0]).toMatchObject({ viajeId: viaje.viajeId, puntaje: 5, conductorId: viaje.conductorId });
  });

  it('obtenerCalificacion devuelve la misma, por la Location', async () => {
    const ubicacion = primera.encabezados.get('location');
    expect(ubicacion).toBeTruthy();
    const leida = await pedirM2(token, 'GET', ubicacion as string);
    expect(leida.estado, describirRespuesta(leida)).toBe(200);
    expect(leida.cuerpo).toMatchObject({ calificacionId: (primera.cuerpo as Calificacion).calificacionId });
  });

  it('el cuerpo de cada respuesta valida contra contrato/openapi.yml', async () => {
    expect(validarContraContrato('Calificacion', primera.cuerpo)).toEqual([]);
    const lista = await pedirM2(token, 'GET', `/api/v1/clientes/${clienteId}/calificaciones`);
    expect(validarContraContrato('PaginaCalificaciones', lista.cuerpo)).toEqual([]);
    const leida = await pedirM2(token, 'GET', primera.encabezados.get('location') as string);
    expect(validarContraContrato('Calificacion', leida.cuerpo)).toEqual([]);
  });
});
