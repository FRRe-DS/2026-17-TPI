import { describe, expect, it } from 'vitest';
import { aProblema, NoEncontrado, PerfilYaExiste } from '../../src/errores.js';
import { aCliente, type FilaCliente } from '../../src/clientes/modelo.js';

const CLIENTE_ID = '6f1c1d1e-3b0a-4f55-9a6b-0d7a8f4c2e11';

// Una fila como la entrega pg: las fechas como `Date` (timestamptz) o texto (fecha_nacimiento, que la consulta da en
// formato ISO), y `bloqueado` como booleano.
const fila = (cambios: Partial<FilaCliente> = {}): FilaCliente => ({
  cliente_id: CLIENTE_ID,
  nombre: 'Ana',
  apellido: 'Gómez',
  telefono: '+5493624000000',
  fecha_nacimiento: '1990-05-17',
  creado_en: new Date('2026-10-23T12:00:00.123Z'),
  actualizado_en: new Date('2026-10-23T12:30:00.456Z'),
  bloqueado: false,
  ...cambios,
});

describe('aCliente(): de la fila al esquema Cliente del contrato (RF-2.1.1)', () => {
  it('pasa cada columna a su campo, con las fechas en ISO 8601', () => {
    expect(aCliente(fila())).toStrictEqual({
      clienteId: CLIENTE_ID,
      nombre: 'Ana',
      apellido: 'Gómez',
      telefono: '+5493624000000',
      fechaNacimiento: '1990-05-17',
      estado: 'ACTIVO',
      creadoEn: '2026-10-23T12:00:00.123Z',
      actualizadoEn: '2026-10-23T12:30:00.456Z',
    });
  });

  it('sin fecha de nacimiento, el campo no está (no es null: el contrato no lo admite)', () => {
    const cliente = aCliente(fila({ fecha_nacimiento: null }));

    expect(cliente).not.toHaveProperty('fechaNacimiento');
  });

  it('el estado es BLOQUEADO si la fila tiene un bloqueo vigente, y ACTIVO si no', () => {
    expect(aCliente(fila({ bloqueado: true })).estado).toBe('BLOQUEADO');
    expect(aCliente(fila({ bloqueado: false })).estado).toBe('ACTIVO');
  });

  it('la fecha de nacimiento sale tal cual, sin pasar por la zona horaria', () => {
    expect(aCliente(fila({ fecha_nacimiento: '2000-01-01' })).fechaNacimiento).toBe('2000-01-01');
  });
});

describe('PerfilYaExiste (RF-2.1.3)', () => {
  it('es un 409 con su tipo propio, sin datos del perfil', () => {
    const { codigo, cuerpo } = aProblema(new PerfilYaExiste(), '/api/v1/clientes');

    expect(codigo).toBe(409);
    expect(cuerpo).toEqual({
      type: '/errores/perfil-ya-existe',
      title: 'Perfil ya existe',
      status: 409,
      detail: 'Ya existe un perfil para este usuario',
      instance: '/api/v1/clientes',
    });
  });
});

describe('NoEncontrado con detalle propio (RF-2.1.3.1)', () => {
  it('sin argumento sigue diciendo que no existe la ruta', () => {
    expect(aProblema(new NoEncontrado()).cuerpo).toMatchObject({ status: 404, detail: 'No existe la ruta pedida' });
  });

  it('con detalle lo usa, y sigue siendo el 404 genérico (about:blank)', () => {
    expect(aProblema(new NoEncontrado('No existe el cliente pedido')).cuerpo).toEqual({
      type: 'about:blank',
      title: 'No encontrado',
      status: 404,
      detail: 'No existe el cliente pedido',
    });
  });
});
