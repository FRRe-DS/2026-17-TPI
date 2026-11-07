import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { conAveria } from './ayudas/averias.js';
import { crearClienteEnM2 } from './ayudas/clientes.js';
import { LIMITE_PRUEBA_M6 } from './ayudas/contador.js';
import { validarContraContrato } from './ayudas/contrato.js';
import { compose, esperarSalud, inicioDeM2, URL_M6 } from './ayudas/entorno.js';
import { describirRespuesta } from './ayudas/errores.js';
import { contador, pedirM2, type Respuesta } from './ayudas/pedir.js';
import { crearViaje } from './ayudas/viajes.js';

// M2 cuando el M6 real se detiene o deja de contestar, y cuando vuelve (RNF-13.8). Este archivo corre siempre al final
// (`ayudas/orden.ts`), porque apaga a M6, que comparte con los demás.
//
// Son dos averías distintas: `stop` deja a M6 sin contenedor, así que M2 falla enseguida; `pause` lo congela, así que la conexión
// queda colgada y solo la corta el tiempo máximo de M2. Cada una corre en `conAveria`, que deja a M6 sano aunque un paso falle, y
// la siguiente prueba arranca con M6 sano.
// Más que lo que puede tardar `restablecerM6` (hasta 180 s), para que Vitest no siga con M6 sin restablecer.
const TIEMPO_PRUEBA_MS = 240_000;
const TIEMPO_COMANDO_MS = 60_000;
const CORTE_RESPUESTA_MS = 10_000;

const m6 = (accion: 'stop' | 'pause') => async () => {
  await compose([accion, 'm6-real'], { tiempoMs: TIEMPO_COMANDO_MS });
};

// `unpause` falla si M6 no estaba pausado, que es lo normal: si estaba pausado y no se pudo, lo dice `start` o la espera de la salud.
async function restablecerM6(): Promise<void> {
  await compose(['unpause', 'm6-real'], { tiempoMs: TIEMPO_COMANDO_MS }).catch(() => undefined);
  await compose(['start', 'm6-real'], { tiempoMs: TIEMPO_COMANDO_MS });
  await esperarSalud('M6', URL_M6);
}

function exigirNoDisponible(respuesta: Respuesta): void {
  expect(respuesta.estado, describirRespuesta(respuesta)).toBe(503);
  expect(respuesta.encabezados.get('retry-after'), 'Retry-After').toMatch(/^[1-9]\d*$/);
  expect(respuesta.encabezados.get('content-type')).toMatch(/^application\/problem\+json/);
  expect(validarContraContrato('Problema', respuesta.cuerpo)).toEqual([]);
}

describe('M2 cuando el M6 real se cae y cuando vuelve (RNF-13.8)', () => {
  let clienteId: string;
  let token: string;
  let inicioM2: string;
  let viajeBase: string;
  let viajeParada: string;
  let viajePausa: string;
  // La misma clave antes y después de la avería: es lo que hace quien reintenta por el Retry-After.
  const claveParada = randomUUID();
  const clavePausa = randomUUID();

  const historial = () => pedirM2(token, 'GET', `/api/v1/clientes/${clienteId}/viajes`, { consultaM6: true });
  const calificar = (viajeId: string, clave: string) =>
    pedirM2(token, 'POST', `/api/v1/clientes/${clienteId}/calificaciones`, {
      cuerpo: { viajeId, puntaje: 4 },
      encabezados: { 'idempotency-key': clave },
      consultaM6: true,
    });

  async function exigirLoPropioEn200(): Promise<void> {
    const perfil = await pedirM2(token, 'GET', `/api/v1/clientes/${clienteId}`);
    expect(perfil.estado, describirRespuesta(perfil)).toBe(200);
    const direcciones = await pedirM2(token, 'GET', `/api/v1/clientes/${clienteId}/direcciones`);
    expect(direcciones.estado, describirRespuesta(direcciones)).toBe(200);
  }

  async function exigirQueVolvio(viajeId: string, clave: string): Promise<void> {
    const paginaViajes = await historial();
    expect(paginaViajes.estado, describirRespuesta(paginaViajes)).toBe(200);
    const calificacion = await calificar(viajeId, clave);
    expect(calificacion.estado, describirRespuesta(calificacion)).toBe(201);
    expect(await inicioDeM2(), 'M2 no se reinició').toBe(inicioM2);
  }

  beforeAll(async () => {
    ({ clienteId, token } = await crearClienteEnM2());
    inicioM2 = await inicioDeM2();
    viajeBase = (await crearViaje(clienteId, 'COMPLETED')).viajeId;
    viajeParada = (await crearViaje(clienteId, 'COMPLETED')).viajeId;
    viajePausa = (await crearViaje(clienteId, 'COMPLETED')).viajeId;
  });

  it('con M6 sano, historial 200 y calificación 201', async () => {
    await exigirQueVolvio(viajeBase, randomUUID());
  });

  it(
    'con M6 detenido, historial y calificación dan 503 con Retry-After, y el perfil y las direcciones 200',
    async () => {
      await conAveria(m6('stop'), restablecerM6, async () => {
        exigirNoDisponible(await historial());
        exigirNoDisponible(await calificar(viajeParada, claveParada));
        await exigirLoPropioEn200();
      });
    },
    TIEMPO_PRUEBA_MS,
  );

  it('cuando M6 arranca de nuevo, historial 200 y calificación 201 con la misma clave, sin reiniciar M2', async () => {
    await exigirQueVolvio(viajeParada, claveParada);
  });

  it(
    'con M6 congelado, historial y calificación dan 503 con Retry-After en menos de 10 s, y el perfil y las direcciones 200',
    async () => {
      await conAveria(m6('pause'), restablecerM6, async () => {
        for (const pedido of [historial, () => calificar(viajePausa, clavePausa)]) {
          const inicio = performance.now();
          const respuesta = await pedido();
          expect(performance.now() - inicio).toBeLessThan(CORTE_RESPUESTA_MS);
          exigirNoDisponible(respuesta);
        }
        await exigirLoPropioEn200();
      });
    },
    TIEMPO_PRUEBA_MS,
  );

  it('cuando M6 se descongela, historial 200 y calificación 201 con la misma clave, sin reiniciar M2', async () => {
    await exigirQueVolvio(viajePausa, clavePausa);
  });

  it('los 503 no guardaron nada: quedan solo las tres calificaciones que dieron 201', async () => {
    const lista = await pedirM2(token, 'GET', `/api/v1/clientes/${clienteId}/calificaciones`);
    expect(lista.estado, describirRespuesta(lista)).toBe(200);
    expect(lista.cuerpo).toMatchObject({ totalElementos: 3 });
  });

  // Este archivo es el último, así que acá ya está la cuenta de toda la corrida (plan, Límite de M6).
  it(`el total de pedidos a M6 de la corrida no pasa de ${LIMITE_PRUEBA_M6}`, () => {
    expect(contador.totalM6()).toBeGreaterThan(0);
    expect(contador.totalM6()).toBeLessThanOrEqual(LIMITE_PRUEBA_M6);
  });
});
