import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { describirRespuesta } from './ayudas/errores.js';
import { pedirM6, type Respuesta } from './ayudas/pedir.js';

// La correlación contra el M6 real (RNF-07.14). M2 le manda a M6 el identificador en `X-Correlation-Id` (RNF-14.11, spec 007), pero la
// respuesta de M6 a M2 no se ve desde afuera. Por eso se comprueban las dos mitades por separado: que M2 lo envía, lo prueban las
// pruebas de la spec 007 con el M6 simulado; que el M6 real lo toma y lo devuelve, lo prueba este archivo, que le pide directo a M6.
// Que M6 devuelva el encabezado es comportamiento observado, no de contrato: `m6.yml` declara `X-Correlation-Id` solo como encabezado del
// pedido y `correlationId` como campo de `Problem`. Si el Grupo 12 lo cambia, esta prueba falla y muestra el valor que recibió.
describe('M6 real: toma la correlación y la devuelve (RNF-07.14)', () => {
  // Uno nuevo por corrida, de letras, números y guiones, de menos de 100 caracteres (el máximo del contrato de M6).
  const id = `m2-correlacion-${randomUUID()}`;
  const encabezados = { 'X-Correlation-Id': id };

  // Lo recibido, para que un fallo diga qué devolvió M6 y no solo que no coincide.
  const recibido = (respuesta: Respuesta) =>
    `${describirRespuesta(respuesta)}; X-Correlation-Id recibido: ${respuesta.encabezados.get('x-correlation-id') ?? '(ninguno)'}`;

  it('un GET /trips que responde 200 devuelve el mismo X-Correlation-Id', async () => {
    const respuesta = await pedirM6('GET', `/trips?clientId=${randomUUID()}`, { token: 'SYSTEM', encabezados });

    expect(respuesta.estado, recibido(respuesta)).toBe(200);
    expect(respuesta.encabezados.get('x-correlation-id'), recibido(respuesta)).toBe(id);
  });

  it('un GET /trips/{tripId} de un viaje inexistente da 404 con el mismo X-Correlation-Id y con correlationId en el cuerpo', async () => {
    const respuesta = await pedirM6('GET', `/trips/${randomUUID()}`, { token: 'SYSTEM', encabezados });

    expect(respuesta.estado, recibido(respuesta)).toBe(404);
    expect(respuesta.encabezados.get('x-correlation-id'), recibido(respuesta)).toBe(id);
    const correlationId = (respuesta.cuerpo as { correlationId?: unknown } | undefined)?.correlationId;
    expect(correlationId, `${recibido(respuesta)}; correlationId recibido: ${String(correlationId)}`).toBe(id);
  });
});
