import { describe, expect, it } from 'vitest';
import { aCliente, type FilaCliente } from '../../src/clientes/modelo.js';
import { clienteDelToken, exigirPropietario, normalizarUuid } from '../../src/clientes/servicio.js';
import { aProblema, NoEncontrado, PerfilYaExiste, SinPermiso, SolicitudInvalida } from '../../src/errores.js';

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

describe('normalizarUuid(): la forma en que PostgreSQL devuelve un uuid', () => {
  it('pasa a minúsculas y saca el prefijo urn:uuid: que el formato uuid del contrato admite', () => {
    expect(normalizarUuid(CLIENTE_ID.toUpperCase())).toBe(CLIENTE_ID);
    expect(normalizarUuid(`urn:uuid:${CLIENTE_ID}`)).toBe(CLIENTE_ID);
    expect(normalizarUuid(`URN:UUID:${CLIENTE_ID.toUpperCase()}`)).toBe(CLIENTE_ID);
  });
});

describe('clienteDelToken(): el clienteId de quien crea su perfil es su sub (RF-2.1)', () => {
  it('un sub UUID es el clienteId, normalizado', () => {
    expect(clienteDelToken({ sub: CLIENTE_ID.toUpperCase(), roles: ['CLIENTE'] })).toBe(CLIENTE_ID);
  });

  it.each(['usuario-17', '', '6f1c1d1e3b0a4f559a6b0d7a8f4c2e11', `${CLIENTE_ID}x`, `{${CLIENTE_ID}}`])(
    'un sub que no es UUID (%j) da SolicitudInvalida, el 400, sin el sub en el mensaje (spec 004, Casos límite)',
    (sub) => {
      const error = (() => {
        try {
          clienteDelToken({ sub, roles: ['CLIENTE'] });
        } catch (atrapado) {
          return atrapado;
        }
      })();

      expect(error).toBeInstanceOf(SolicitudInvalida);
      expect(aProblema(error).cuerpo).toEqual({
        type: 'about:blank',
        title: 'Solicitud inválida',
        status: 400,
        detail: 'El sub del token no es un UUID: no puede ser el clienteId de un perfil',
      });
    },
  );
});

describe('exigirPropietario(): la propiedad solo se exige si CLIENTE es el único rol efectivo (RF-2.1.1.1, RF-2.1.2.1)', () => {
  const OTRO = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
  const LECTURA = ['CLIENTE', 'OPERADOR'];
  const ESCRITURA = ['CLIENTE'];

  const exigir = (roles: ('CLIENTE' | 'CONDUCTOR' | 'OPERADOR' | 'SERVICIO')[], clienteId: string, rolesOperacion: string[]) =>
    () => exigirPropietario({ sub: CLIENTE_ID, roles }, clienteId, rolesOperacion);

  it('un CLIENTE pasa sobre su propio perfil, también con el clienteId en mayúsculas', () => {
    expect(exigir(['CLIENTE'], CLIENTE_ID, LECTURA)).not.toThrow();
    expect(exigir(['CLIENTE'], CLIENTE_ID.toUpperCase(), ESCRITURA)).not.toThrow();
  });

  it('un CLIENTE sobre otro perfil da SinPermiso, el 403, con un detalle propio', () => {
    expect(exigir(['CLIENTE'], OTRO, LECTURA)).toThrow(SinPermiso);
    expect(aProblema(new SinPermiso('El perfil pedido es de otro cliente')).cuerpo).toMatchObject({
      status: 403,
      detail: 'El perfil pedido es de otro cliente',
    });
  });

  it('CLIENTE+OPERADOR lee otro perfil (dos roles efectivos), pero no lo actualiza (solo CLIENTE es efectivo)', () => {
    expect(exigir(['CLIENTE', 'OPERADOR'], OTRO, LECTURA)).not.toThrow();
    expect(exigir(['CLIENTE', 'OPERADOR'], OTRO, ESCRITURA)).toThrow(SinPermiso);
  });

  it('un rol que la operación no admite no cuenta: CLIENTE+CONDUCTOR sigue siendo solo CLIENTE', () => {
    expect(exigir(['CLIENTE', 'CONDUCTOR'], OTRO, LECTURA)).toThrow(SinPermiso);
  });

  it('CLIENTE repetido en el token sigue siendo un solo rol efectivo', () => {
    expect(exigir(['CLIENTE', 'CLIENTE'], OTRO, LECTURA)).toThrow(SinPermiso);
  });

  it('un OPERADOR no usa la regla de propiedad', () => {
    expect(exigir(['OPERADOR'], OTRO, LECTURA)).not.toThrow();
  });
});
