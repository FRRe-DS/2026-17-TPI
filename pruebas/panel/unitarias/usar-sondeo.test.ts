import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearSondeo } from '../../../panel/cliente/src/hooks/usar-sondeo.js';

// El temporizador de la salud en vivo (spec 072, T13, RNF-13.4): pide ya y después cada 2 s, sin encimar pedidos, y se corta al
// desmontarse. Con temporizadores falsos.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('crearSondeo', () => {
  it('pide enseguida y después cada 2 s', async () => {
    const sondear = vi.fn(async () => undefined);
    const sondeo = crearSondeo({ sondear });

    sondeo.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    expect(sondear).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1999);
    expect(sondear).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sondear).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4000);
    expect(sondear).toHaveBeenCalledTimes(4);

    sondeo.detener();
  });

  it('el intervalo se puede cambiar', async () => {
    const sondear = vi.fn(async () => undefined);
    const sondeo = crearSondeo({ sondear, cadaMs: 500 });

    sondeo.iniciar();
    await vi.advanceTimersByTimeAsync(1500);

    expect(sondear).toHaveBeenCalledTimes(4);
    sondeo.detener();
  });

  it('al detener no pide más, aunque pase el tiempo', async () => {
    const sondear = vi.fn(async () => undefined);
    const sondeo = crearSondeo({ sondear });

    sondeo.iniciar();
    await vi.advanceTimersByTimeAsync(2000);
    sondeo.detener();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(sondear).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('no encima pedidos: el siguiente espera a que termine el anterior y después los 2 s', async () => {
    let terminar: () => void = () => undefined;
    const sondear = vi.fn(() => new Promise<void>((listo) => (terminar = listo)));
    const sondeo = crearSondeo({ sondear });

    sondeo.iniciar();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sondear).toHaveBeenCalledTimes(1);

    terminar();
    await vi.advanceTimersByTimeAsync(1999);
    expect(sondear).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sondear).toHaveBeenCalledTimes(2);
    sondeo.detener();
  });

  it('al detener cancela el pedido en curso y no vuelve a pedir cuando termina', async () => {
    let señal: AbortSignal | undefined;
    let terminar: () => void = () => undefined;
    const sondear = vi.fn((s: AbortSignal) => {
      señal = s;
      return new Promise<void>((listo) => (terminar = listo));
    });
    const sondeo = crearSondeo({ sondear });

    sondeo.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    sondeo.detener();
    terminar();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(señal?.aborted).toBe(true);
    expect(sondear).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('un pedido que falla no corta el sondeo', async () => {
    const sondear = vi.fn(async () => {
      throw new Error('sin red');
    });
    const sondeo = crearSondeo({ sondear });

    sondeo.iniciar();
    await vi.advanceTimersByTimeAsync(4000);

    expect(sondear).toHaveBeenCalledTimes(3);
    sondeo.detener();
  });

  it('iniciar dos veces no duplica el sondeo', async () => {
    const sondear = vi.fn(async () => undefined);
    const sondeo = crearSondeo({ sondear });

    sondeo.iniciar();
    sondeo.iniciar();
    await vi.advanceTimersByTimeAsync(2000);

    expect(sondear).toHaveBeenCalledTimes(2);
    sondeo.detener();
  });

  it('se puede detener sin haber iniciado, y volver a iniciar después de detener', async () => {
    const sondear = vi.fn(async () => undefined);
    const sondeo = crearSondeo({ sondear });

    sondeo.detener();
    sondeo.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    sondeo.detener();
    sondeo.iniciar();
    await vi.advanceTimersByTimeAsync(0);

    expect(sondear).toHaveBeenCalledTimes(2);
    sondeo.detener();
  });
});
