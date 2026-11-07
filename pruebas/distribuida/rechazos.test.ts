import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { crearClienteEnM2 } from './ayudas/clientes.js';
import { validarContraContrato } from './ayudas/contrato.js';
import { describirRespuesta } from './ayudas/errores.js';
import { pedirM2 } from './ayudas/pedir.js';
import { crearViaje } from './ayudas/viajes.js';

// Los viajes que no se pueden calificar, contra el M6 real (RF-2.5, RNF-07.10): M2 lo decide con lo que M6 contesta y no guarda
// nada. Usa los viajes de la preparación (T3).
describe('calificar lo que no corresponde, con el M6 real (RF-2.5, RNF-07.10)', () => {
  let clienteId: string;
  let token: string;
  let ajeno: string;
  let cancelado: string;
  let enCurso: string;

  const calificar = (viajeId: string) =>
    pedirM2(token, 'POST', `/api/v1/clientes/${clienteId}/calificaciones`, {
      cuerpo: { viajeId, puntaje: 5 },
      encabezados: { 'idempotency-key': randomUUID() },
      consultaM6: true,
    });

  beforeAll(async () => {
    ({ clienteId, token } = await crearClienteEnM2());
    ajeno = (await crearViaje(randomUUID(), 'COMPLETED')).viajeId;
    cancelado = (await crearViaje(clienteId, 'CANCELLED')).viajeId;
    enCurso = (await crearViaje(clienteId, 'IN_PROGRESS')).viajeId;
  });

  it('un viaje que no existe en M6 da 404', async () => {
    const respuesta = await calificar(randomUUID());
    expect(respuesta.estado, describirRespuesta(respuesta)).toBe(404);
    expect(validarContraContrato('Problema', respuesta.cuerpo)).toEqual([]);
  });

  it('un viaje de otro cliente da 404', async () => {
    const respuesta = await calificar(ajeno);
    expect(respuesta.estado, describirRespuesta(respuesta)).toBe(404);
    expect(validarContraContrato('Problema', respuesta.cuerpo)).toEqual([]);
  });

  it.each([
    ['CANCELLED', () => cancelado],
    ['en curso (IN_PROGRESS)', () => enCurso],
  ])('un viaje %s da 422 viaje-no-completado', async (_estado, viaje) => {
    const respuesta = await calificar(viaje());
    expect(respuesta.estado, describirRespuesta(respuesta)).toBe(422);
    expect(respuesta.cuerpo).toMatchObject({ type: '/errores/viaje-no-completado', status: 422 });
    expect(validarContraContrato('Problema', respuesta.cuerpo)).toEqual([]);
  });

  it('después de los cuatro rechazos, listarCalificaciones sigue vacía', async () => {
    const lista = await pedirM2(token, 'GET', `/api/v1/clientes/${clienteId}/calificaciones`);
    expect(lista.estado, describirRespuesta(lista)).toBe(200);
    expect(lista.cuerpo).toMatchObject({ items: [], totalElementos: 0 });
  });
});
