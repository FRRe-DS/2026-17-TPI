import { describe, expect, it } from 'vitest';
import { conAveria } from '../distribuida/ayudas/averias.js';

// Lo que deja a M6 corriendo aunque un paso de la prueba de resiliencia falle (spec 081, T7).
describe('conAveria (RNF-13.8)', () => {
  function registro() {
    const pasos: string[] = [];
    return {
      pasos,
      paso: (nombre: string) => async () => {
        pasos.push(nombre);
      },
      falla: (nombre: string) => async () => {
        pasos.push(nombre);
        throw new Error(`falló ${nombre}`);
      },
    };
  }

  it('avería, corre el cuerpo y restablece, en ese orden, y devuelve lo del cuerpo', async () => {
    const { pasos, paso } = registro();
    const resultado = await conAveria(paso('averiar'), paso('restablecer'), async () => {
      await paso('cuerpo')();
      return 42;
    });
    expect(resultado).toBe(42);
    expect(pasos).toEqual(['averiar', 'cuerpo', 'restablecer']);
  });

  it('si el cuerpo falla, restablece igual y sale esa falla', async () => {
    const { pasos, paso, falla } = registro();
    await expect(conAveria(paso('averiar'), paso('restablecer'), falla('cuerpo'))).rejects.toThrow('falló cuerpo');
    expect(pasos).toEqual(['averiar', 'cuerpo', 'restablecer']);
  });

  it('si la avería falla, no corre el cuerpo y restablece igual', async () => {
    const { pasos, paso, falla } = registro();
    await expect(conAveria(falla('averiar'), paso('restablecer'), paso('cuerpo'))).rejects.toThrow('falló averiar');
    expect(pasos).toEqual(['averiar', 'restablecer']);
  });

  it('si solo falla restablecer, sale esa falla', async () => {
    const { paso, falla } = registro();
    await expect(conAveria(paso('averiar'), falla('restablecer'), paso('cuerpo'))).rejects.toThrow('falló restablecer');
  });

  it('si fallan el cuerpo y restablecer, no se pierde ninguna de las dos', async () => {
    const { paso, falla } = registro();
    const error: unknown = await conAveria(paso('averiar'), falla('restablecer'), falla('cuerpo')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AggregateError);
    const mensajes = (error as AggregateError).errors.map((e: Error) => e.message);
    expect(mensajes).toEqual(['falló cuerpo', 'falló restablecer']);
  });
});
