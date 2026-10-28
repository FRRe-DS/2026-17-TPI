import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorDeRespuesta, ErrorDeApi, segundosDeEspera } from '../../../panel/cliente/src/api/errores.js';
import { crearCuentaRegresiva, segundosDeCuenta, textoDeEspera } from '../../../panel/cliente/src/logica/cuenta-regresiva.js';

// La cuenta regresiva del `503` (T25, RF-2.4.13): lee `Retry-After` de 1 a 3600 segundos y cuenta hasta 0 sin reintentar sola.

const error503 = (reintentarEnS?: number) =>
  new ErrorDeApi({ sinRespuesta: false, estado: 503, type: '/errores/dependencia-no-disponible', title: 'Dependencia no disponible', reintentarEnS });

describe('Retry-After: de 1 a 3600 segundos enteros', () => {
  it.each([['1', 1], ['7', 7], ['60', 60], ['3600', 3600]])('«%s» se cuenta', (valor, esperado) => {
    expect(segundosDeEspera(valor)).toBe(esperado);
  });

  it.each([['0'], ['3601'], ['-5'], ['1.5'], ['abc'], [''], ['Wed, 21 Oct 2026 07:28:00 GMT'], [' 7']])('«%s» no se cuenta', (valor) => {
    expect(segundosDeEspera(valor)).toBeUndefined();
  });

  it('sin la cabecera no hay cuenta', () => {
    expect(segundosDeEspera(null)).toBeUndefined();
  });

  it('el error de una respuesta 503 trae los segundos de su cabecera', async () => {
    const respuesta = new Response(JSON.stringify({ type: '/errores/dependencia-no-disponible', title: 'Dependencia no disponible', status: 503 }), {
      status: 503,
      headers: { 'content-type': 'application/problem+json', 'retry-after': '7' },
    });

    const error = await errorDeRespuesta(respuesta);

    expect(segundosDeCuenta(error)).toBe(7);
  });
});

describe('segundosDeCuenta: solo un 503 con segundos válidos', () => {
  it('un 503 con Retry-After da los segundos', () => {
    expect(segundosDeCuenta(error503(7))).toBe(7);
    expect(segundosDeCuenta(error503(3600))).toBe(3600);
  });

  it('un 503 sin Retry-After no tiene cuenta', () => {
    expect(segundosDeCuenta(error503())).toBeUndefined();
  });

  it('un valor fuera de 1 a 3600 o no entero no tiene cuenta', () => {
    expect(segundosDeCuenta(error503(0))).toBeUndefined();
    expect(segundosDeCuenta(error503(3601))).toBeUndefined();
    expect(segundosDeCuenta(error503(2.5))).toBeUndefined();
  });

  it('otro error con Retry-After no cuenta: es del 503 de una dependencia', () => {
    expect(segundosDeCuenta(new ErrorDeApi({ sinRespuesta: false, estado: 429, type: 'x', title: 'x', reintentarEnS: 5 }))).toBeUndefined();
  });
});

describe('textoDeEspera: lo que dice la pantalla', () => {
  it.each([
    [7, 'Podés reintentar en 7 s.'],
    [1, 'Podés reintentar en 1 s.'],
    [59, 'Podés reintentar en 59 s.'],
    [60, 'Podés reintentar en 1 min.'],
    [65, 'Podés reintentar en 1 min 5 s.'],
    [3600, 'Podés reintentar en 60 min.'],
    [0, 'Ya podés reintentar.'],
  ])('%i segundos: «%s»', (segundos, texto) => {
    expect(textoDeEspera(segundos)).toBe(texto);
  });
});

describe('crearCuentaRegresiva: cuenta hasta 0 y se detiene', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('antes de empezar muestra todos los segundos', () => {
    expect(crearCuentaRegresiva(7).restantes()).toBe(7);
  });

  it('baja un segundo por segundo hasta 0', () => {
    const cuenta = crearCuentaRegresiva(3);
    cuenta.iniciar();

    const vistos = [cuenta.restantes()];
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(1000);
      vistos.push(cuenta.restantes());
    }

    expect(vistos).toEqual([3, 2, 1, 0]);
  });

  it('en 0 se queda en 0 y no queda ningún temporizador', () => {
    const cuenta = crearCuentaRegresiva(2);
    cuenta.iniciar();

    vi.advanceTimersByTime(10_000);

    expect(cuenta.restantes()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('avisa a quien escucha solo cuando cambia el número', () => {
    const cuenta = crearCuentaRegresiva(2);
    const oyente = vi.fn();
    cuenta.suscribir(oyente);
    cuenta.iniciar();

    vi.advanceTimersByTime(2000);

    expect(oyente).toHaveBeenCalledTimes(2);
  });

  it('una pestaña dormida que despierta tarde muestra lo que falta de verdad, no un segundo menos', () => {
    const cuenta = crearCuentaRegresiva(10);
    cuenta.iniciar();

    vi.setSystemTime(Date.now() + 6500);
    vi.advanceTimersByTime(250);

    expect(cuenta.restantes()).toBe(4);
  });

  it('detener corta la cuenta y deja de avisar', () => {
    const cuenta = crearCuentaRegresiva(5);
    const oyente = vi.fn();
    cuenta.suscribir(oyente);
    cuenta.iniciar();
    vi.advanceTimersByTime(1000);

    cuenta.detener();
    vi.advanceTimersByTime(5000);

    expect(cuenta.restantes()).toBe(4);
    expect(oyente).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('iniciar dos veces no duplica el temporizador', () => {
    const cuenta = crearCuentaRegresiva(5);
    cuenta.iniciar();
    cuenta.iniciar();

    expect(vi.getTimerCount()).toBe(1);
  });

  it('quien deja de escuchar no recibe más avisos', () => {
    const cuenta = crearCuentaRegresiva(5);
    const oyente = vi.fn();
    const dejar = cuenta.suscribir(oyente);
    cuenta.iniciar();
    dejar();

    vi.advanceTimersByTime(3000);

    expect(oyente).not.toHaveBeenCalled();
  });
});
