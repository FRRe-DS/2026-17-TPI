import { describe, expect, it, vi } from 'vitest';
import { crearCerrojo } from '../../../panel/cliente/src/logica/cerrojo.js';

// El cerrojo de la vista «Demostración» (spec 072, T14 y T15, RNF-07.6): mientras una ejecución corre, ninguna otra arranca. Los
// casos, las pruebas simultáneas y (T16) la base comparten M2 y el M6 simulado; correrlos a la vez los mezclaría.
describe('crearCerrojo', () => {
  it('libre al empezar', () => {
    expect(crearCerrojo().activa()).toBeUndefined();
  });

  it('tomar lo ocupa y soltar lo libera', () => {
    const cerrojo = crearCerrojo();

    expect(cerrojo.tomar('todo')).toBe(true);
    expect(cerrojo.activa()).toBe('todo');
    cerrojo.soltar();
    expect(cerrojo.activa()).toBeUndefined();
  });

  it('con una ejecución en curso, nadie más lo toma (un doble clic, otro botón)', () => {
    const cerrojo = crearCerrojo();
    cerrojo.tomar('caso:perfil-crear');

    expect(cerrojo.tomar('caso:perfil-crear')).toBe(false);
    expect(cerrojo.tomar('todo')).toBe(false);
    expect(cerrojo.activa()).toBe('caso:perfil-crear');
  });

  it('avisa a quien escucha al tomar y al soltar, y deja de avisar al cancelar la suscripción', () => {
    const cerrojo = crearCerrojo();
    const oyente = vi.fn();
    const cancelar = cerrojo.suscribir(oyente);

    cerrojo.tomar('todo');
    cerrojo.soltar();
    expect(oyente).toHaveBeenCalledTimes(2);
    cancelar();
    cerrojo.tomar('todo');
    expect(oyente).toHaveBeenCalledTimes(2);
  });

  it('soltar sin nada tomado no avisa', () => {
    const cerrojo = crearCerrojo();
    const oyente = vi.fn();
    cerrojo.suscribir(oyente);

    cerrojo.soltar();

    expect(oyente).not.toHaveBeenCalled();
  });

  it('ejecutar corre la función con el cerrojo tomado y lo suelta al terminar', async () => {
    const cerrojo = crearCerrojo();
    let durante: string | undefined;

    const resultado = await cerrojo.ejecutar('todo', async () => {
      durante = cerrojo.activa();
      return 7;
    });

    expect(resultado).toBe(7);
    expect(durante).toBe('todo');
    expect(cerrojo.activa()).toBeUndefined();
  });

  it('ejecutar suelta aunque la función falle, y la falla sigue su camino', async () => {
    const cerrojo = crearCerrojo();

    await expect(cerrojo.ejecutar('todo', async () => Promise.reject(new Error('falló')))).rejects.toThrow('falló');

    expect(cerrojo.activa()).toBeUndefined();
  });

  it('ejecutar con el cerrojo ocupado no corre la función y devuelve undefined', async () => {
    const cerrojo = crearCerrojo();
    cerrojo.tomar('todo');
    const funcion = vi.fn(async () => 1);

    expect(await cerrojo.ejecutar('caso:x', funcion)).toBeUndefined();
    expect(funcion).not.toHaveBeenCalled();
    expect(cerrojo.activa()).toBe('todo');
  });

  it('un doble clic en «ejecutar» corre la función una sola vez', async () => {
    const cerrojo = crearCerrojo();
    const funcion = vi.fn(() => new Promise<void>((listo) => setTimeout(listo, 5)));

    await Promise.all([cerrojo.ejecutar('caso:x', funcion), cerrojo.ejecutar('caso:x', funcion)]);

    expect(funcion).toHaveBeenCalledTimes(1);
  });
});
