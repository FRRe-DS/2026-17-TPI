import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ModuloNoDisponible } from '../../src/errores.js';
import { crearClienteModulo } from '../../src/modulos/cliente.js';
import { crearServidorModulo } from '../ayudas/servidor-modulo.js';

const TIEMPO_MS = 200;

describe('crearClienteModulo', () => {
  const serv = crearServidorModulo();

  beforeAll(async () => {
    await serv.levantar();
  });

  afterAll(async () => {
    await serv.cerrar();
  });

  // ## T24

it('corta el intento aunque los encabezados lleguen antes del plazo', async () => {
    serv.responderCon({ tipo: 'demora-cuerpo', retardoMs: TIEMPO_MS * 4 });
    const cliente = crearClienteModulo({
      nombre: 'M6',
      urlBase: serv.url,
      tiempoMs: TIEMPO_MS,
      reintentos: 0,
      encabezadoCorrelacion: 'X-Request-Id',
    });

    const inicio = Date.now();
    await expect(cliente.obtener('/', 'id-prueba')).rejects.toThrow(ModuloNoDisponible);
    expect(Date.now() - inicio).toBeLessThan(TIEMPO_MS * 3);
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(TIEMPO_MS - 20); // El nuevo límite inferior
  });

  it('envía el id de correlación en el encabezado configurado', async () => {
    serv.responderCon({ tipo: 'ok', cuerpo: { ok: true } });
    const cliente = crearClienteModulo({
      nombre: 'M6',
      urlBase: serv.url,
      tiempoMs: 2000,
      reintentos: 0,
      encabezadoCorrelacion: 'X-Request-Id',
    });
    await cliente.obtener('/', 'mi-id-de-prueba');
    expect(serv.encabezadosRecibidos.get('x-request-id')).toBe('mi-id-de-prueba');
  });

  it('devuelve el estado y el cuerpo de un 4xx sin reintentar', async () => {
    const cuerpoProblem = { type: 'about:blank', title: 'No encontrado', status: 404 };
    serv.responderCon({ tipo: '4xx', estado: 404, cuerpo: cuerpoProblem });
    const cliente = crearClienteModulo({
      nombre: 'M6',
      urlBase: serv.url,
      tiempoMs: 2000,
      reintentos: 1,
      encabezadoCorrelacion: 'X-Request-Id',
    });

    const resultado = await cliente.obtener('/', 'id');
    expect(resultado.estado).toBe(404);
    expect(resultado.cuerpo).toEqual(cuerpoProblem);
    expect(serv.llamadas).toBe(1);
  });

  it('devuelve el estado y el cuerpo como texto si un 4xx no responde con JSON', async () => {
    serv.responderCon({ tipo: 'no-json', estado: 400 });
    const cliente = crearClienteModulo({
      nombre: 'M6',
      urlBase: serv.url,
      tiempoMs: 2000,
      reintentos: 0,
      encabezadoCorrelacion: 'X-Request-Id',
    });

    const resultado = await cliente.enviar('POST', '/ruta-error', { dato: 1 }, 'id');
    expect(resultado.estado).toBe(400);
    expect(typeof resultado.cuerpo).toBe('string');
  });

  it('lanza ModuloNoDisponible ante un 2xx sin cuerpo JSON (204)', async () => {
    serv.responderCon({ tipo: 'no-json', contenido: '', estado: 204 });
    const cliente = crearClienteModulo({
      nombre: 'M6',
      urlBase: serv.url,
      tiempoMs: 2000,
      reintentos: 0,
      encabezadoCorrelacion: 'X-Request-Id',
    });
    await expect(cliente.obtener('/', 'id')).rejects.toThrow(ModuloNoDisponible);
  });
});
