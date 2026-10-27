import { describe, expect, it, vi } from 'vitest';
import type { ApiM2 } from '../../../panel/cliente/src/api/m2.js';
import { camposDePerfil, calcularCambios, guardarCambios, validarEdicion } from '../../../panel/cliente/src/logica/cambios.js';
import type { CamposCliente } from '../../../panel/cliente/src/logica/campos-cliente.js';

// Lo que se manda al guardar el perfil (T20, RF-2.1.8): solo los campos que cambiaron, y nada si no cambió ninguno.

const ID = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const SIN_FECHA = {
  clienteId: ID,
  nombre: 'Ana',
  apellido: 'Gómez',
  telefono: '+5493624000000',
  estado: 'ACTIVO' as const,
  creadoEn: '2026-10-27T12:00:00.000Z',
  actualizadoEn: '2026-10-27T12:00:00.000Z',
};
const PERFIL = { ...SIN_FECHA, fechaNacimiento: '1990-05-14' };
const con = (cambios: Partial<CamposCliente>): CamposCliente => ({ ...camposDePerfil(PERFIL), ...cambios });

describe('camposDePerfil: lo que trae escrito el formulario al abrir', () => {
  it('los cuatro campos del perfil', () => {
    expect(camposDePerfil(PERFIL)).toEqual({ nombre: 'Ana', apellido: 'Gómez', telefono: '+5493624000000', fechaNacimiento: '1990-05-14' });
  });

  it('un perfil sin fecha la deja vacía', () => {
    expect(camposDePerfil(SIN_FECHA).fechaNacimiento).toBe('');
  });
});

describe('calcularCambios: solo los campos distintos (RF-2.1.8)', () => {
  it('sin tocar nada, no hay cambios', () => {
    expect(calcularCambios(PERFIL, camposDePerfil(PERFIL))).toBeUndefined();
  });

  it.each<[string, Partial<CamposCliente>, object]>([
    ['el nombre', { nombre: 'Beatriz' }, { nombre: 'Beatriz' }],
    ['el apellido', { apellido: 'Paz' }, { apellido: 'Paz' }],
    ['el teléfono', { telefono: '+5491100000000' }, { telefono: '+5491100000000' }],
    ['la fecha', { fechaNacimiento: '1991-01-02' }, { fechaNacimiento: '1991-01-02' }],
    ['dos a la vez', { nombre: 'Beatriz', telefono: '+5491100000000' }, { nombre: 'Beatriz', telefono: '+5491100000000' }],
  ])('si cambia %s, manda solo eso', (_, cambios, esperado) => {
    expect(calcularCambios(PERFIL, con(cambios))).toEqual(esperado);
  });

  it('escribir lo mismo con espacios de más no es un cambio, y si lo es, se manda sin ellos', () => {
    expect(calcularCambios(PERFIL, con({ nombre: '  Ana ', telefono: ' +5493624000000' }))).toBeUndefined();
    expect(calcularCambios(PERFIL, con({ nombre: '  Beatriz ' }))).toEqual({ nombre: 'Beatriz' });
  });

  it('un nombre con espacios que ya traía M2 no cuenta como cambio si no se toca', () => {
    const conEspacios = { ...PERFIL, nombre: ' Ana' };
    expect(calcularCambios(conEspacios, camposDePerfil(conEspacios))).toBeUndefined();
  });

  it('cambiar solo mayúsculas sí es un cambio', () => {
    expect(calcularCambios(PERFIL, con({ nombre: 'ana' }))).toEqual({ nombre: 'ana' });
  });

  it('vaciar la fecha de un perfil que la tiene no es un cambio: el contrato no puede borrarla', () => {
    expect(calcularCambios(PERFIL, con({ fechaNacimiento: '' }))).toBeUndefined();
    expect(calcularCambios(PERFIL, con({ nombre: 'Beatriz', fechaNacimiento: '  ' }))).toEqual({ nombre: 'Beatriz' });
  });

  it('completar la fecha de un perfil que no la tenía es un cambio; dejarla vacía, no', () => {
    expect(calcularCambios(SIN_FECHA, { ...camposDePerfil(SIN_FECHA), fechaNacimiento: '1990-05-14' })).toEqual({ fechaNacimiento: '1990-05-14' });
    expect(calcularCambios(SIN_FECHA, camposDePerfil(SIN_FECHA))).toBeUndefined();
  });
});

describe('validarEdicion: las del alta, y la fecha no se puede borrar', () => {
  it('lo que viene de M2 sin tocar es válido', () => {
    expect(validarEdicion(PERFIL, camposDePerfil(PERFIL))).toEqual({});
    expect(validarEdicion(SIN_FECHA, camposDePerfil(SIN_FECHA))).toEqual({});
  });

  it('las mismas reglas de `ClienteNuevo`', () => {
    expect(validarEdicion(PERFIL, con({ nombre: '', telefono: '123' }))).toMatchObject({
      nombre: 'El nombre es obligatorio.',
      telefono: expect.stringContaining('E.164') as string,
    });
  });

  it('el contrato no permite borrar la fecha: vaciarla es un error, no un cambio', () => {
    expect(validarEdicion(PERFIL, con({ fechaNacimiento: '' }))).toEqual({
      fechaNacimiento: 'M2 no permite borrar la fecha de nacimiento: escribí otra.',
    });
  });
});

describe('guardarCambios: no llama a M2 si no hay nada que guardar (RF-2.1.8)', () => {
  const apiDe = (respuesta = { ...PERFIL, nombre: 'Beatriz' }) => {
    const actualizarCliente = vi.fn().mockResolvedValue(respuesta);
    return { api: { actualizarCliente } as unknown as ApiM2, actualizarCliente };
  };

  it('sin cambios, no hay ningún pedido', async () => {
    const { api, actualizarCliente } = apiDe();

    const resultado = await guardarCambios(api, PERFIL, camposDePerfil(PERFIL));

    expect(resultado).toEqual({ tipo: 'sin-cambios' });
    expect(actualizarCliente).not.toHaveBeenCalled();
  });

  it('con cambios, un pedido con solo los campos distintos, y devuelve el perfil de M2', async () => {
    const { api, actualizarCliente } = apiDe();
    const senal = new AbortController().signal;

    const resultado = await guardarCambios(api, PERFIL, con({ nombre: 'Beatriz' }), { senal });

    expect(actualizarCliente).toHaveBeenCalledExactlyOnceWith(ID, { nombre: 'Beatriz' }, { senal });
    expect(resultado).toEqual({ tipo: 'guardado', perfil: { ...PERFIL, nombre: 'Beatriz' } });
  });

  it('si M2 rechaza, el error llega tal cual', async () => {
    const error = new Error('400');
    const api = { actualizarCliente: vi.fn().mockRejectedValue(error) } as unknown as ApiM2;

    await expect(guardarCambios(api, PERFIL, con({ nombre: 'Beatriz' }))).rejects.toBe(error);
  });
});
