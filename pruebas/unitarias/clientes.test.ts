import { describe, expect, it } from 'vitest';
import {
  aBloqueo,
  aCliente,
  aEstadoCuenta,
  aPaginaBloqueos,
  type FilaBloqueo,
  type FilaCliente,
} from '../../src/clientes/modelo.js';
import { clienteDelToken, exigirPropietario, instanteUtc, normalizarUuid } from '../../src/clientes/servicio.js';
import {
  aProblema,
  BloqueoHastaFueraDeRango,
  BloqueoNoVigente,
  BloqueoVencido,
  BloqueoYaLevantado,
  NoEncontrado,
  PerfilYaExiste,
  SinPermiso,
  SolicitudInvalida,
} from '../../src/errores.js';

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

describe('instanteUtc(): el instante de un date-time del contrato, en milisegundos UTC (spec 004, Casos límite)', () => {
  const utc = (texto: string) => new Date(instanteUtc(texto)).toISOString();

  it.each([
    ['2099-01-01T00:00:00Z', '2099-01-01T00:00:00.000Z'],
    ['2099-01-01T05:30:00+05:30', '2099-01-01T00:00:00.000Z'],
    ['2099-01-01T05:30:00+0530', '2099-01-01T00:00:00.000Z'],
    ['2099-01-01T05:00:00+05', '2099-01-01T00:00:00.000Z'],
    ['2099-01-01t00:00:00z', '2099-01-01T00:00:00.000Z'],
    ['2099-01-01 00:00:00Z', '2099-01-01T00:00:00.000Z'],
    ['2099-01-01T00:00:00.123456Z', '2099-01-01T00:00:00.123Z'],
    ['2099-01-01T00:00:00.5Z', '2099-01-01T00:00:00.500Z'],
  ])('%s es %s', (texto, esperado) => {
    expect(utc(texto)).toBe(esperado);
  });

  it('admite los desplazamientos de hasta ±23:59 que acepta el contrato y PostgreSQL no (más de ±15:59)', () => {
    expect(utc('9389-01-20T16:00:33+16:42')).toBe('9389-01-19T23:18:33.000Z');
    expect(utc('2099-01-01T00:00:00-23:59')).toBe('2099-01-01T23:59:00.000Z');
  });

  it('el segundo intercalar pasa al minuto siguiente, como en PostgreSQL', () => {
    expect(utc('2098-12-31T23:59:60Z')).toBe('2099-01-01T00:00:00.000Z');
  });

  it('un año de dos cifras no se confunde con el siglo XX, y el año 0000 queda antes del 0001', () => {
    expect(utc('0099-06-01T00:00:00Z')).toBe('0099-06-01T00:00:00.000Z');
    expect(instanteUtc('0000-12-31T23:59:59Z')).toBeLessThan(instanteUtc('0001-01-01T00:00:00Z'));
  });

  it('el último día del año 9999 con desplazamiento negativo cae en el año 10000', () => {
    expect(instanteUtc('9999-12-31T23:59:59-23:59')).toBeGreaterThan(Date.UTC(9999, 11, 31, 23, 59, 59, 999));
  });
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

const BLOQUEO_ID = 'b3a1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

// Una fila de bloqueo como la entrega pg: sin fin ni levantamiento, vigente.
const filaBloqueo = (cambios: Partial<FilaBloqueo> = {}): FilaBloqueo => ({
  bloqueo_id: BLOQUEO_ID,
  motivo: 'Deuda pendiente',
  vigente: true,
  hasta: null,
  creado_en: new Date('2026-10-23T10:00:00.789Z'),
  creado_por: 'operador-1',
  levantado_en: null,
  levantado_por: null,
  motivo_levantamiento: null,
  ...cambios,
});

describe('aBloqueo(): de la fila al esquema Bloqueo del contrato (RF-2.6, RF-2.6.4)', () => {
  it('un bloqueo sin fin ni levantamiento: solo los campos que existen, y desde es creadoEn', () => {
    const bloqueo = aBloqueo(filaBloqueo());

    expect(bloqueo).toStrictEqual({
      bloqueoId: BLOQUEO_ID,
      motivo: 'Deuda pendiente',
      vigente: true,
      desde: '2026-10-23T10:00:00.789Z',
      creadoEn: '2026-10-23T10:00:00.789Z',
      creadoPor: 'operador-1',
    });
  });

  it('con fin, hasta sale en ISO 8601', () => {
    const bloqueo = aBloqueo(filaBloqueo({ hasta: new Date('2026-12-01T00:00:00.000Z') }));

    expect(bloqueo.hasta).toBe('2026-12-01T00:00:00.000Z');
  });

  it('levantado: quién, cuándo y por qué, y deja de ser vigente', () => {
    const bloqueo = aBloqueo(
      filaBloqueo({
        vigente: false,
        levantado_en: new Date('2026-10-23T11:00:00.000Z'),
        levantado_por: 'operador-2',
        motivo_levantamiento: 'Pagó',
      }),
    );

    expect(bloqueo).toMatchObject({
      vigente: false,
      levantadoEn: '2026-10-23T11:00:00.000Z',
      levantadoPor: 'operador-2',
      motivoLevantamiento: 'Pagó',
    });
  });

  it('vencido por su fecha no es un levantamiento: no lleva campos de levantamiento (spec 004, Casos límite)', () => {
    const bloqueo = aBloqueo(filaBloqueo({ vigente: false, hasta: new Date('2026-10-23T10:30:00.000Z') }));

    expect(bloqueo.vigente).toBe(false);
    expect(bloqueo).not.toHaveProperty('levantadoEn');
    expect(bloqueo).not.toHaveProperty('levantadoPor');
    expect(bloqueo).not.toHaveProperty('motivoLevantamiento');
  });
});

describe('aEstadoCuenta(): el estado sale de los bloqueos vigentes que lo acompañan (RF-2.6)', () => {
  it('sin bloqueos vigentes: ACTIVO y la lista vacía', () => {
    expect(aEstadoCuenta(CLIENTE_ID, [])).toStrictEqual({ clienteId: CLIENTE_ID, estado: 'ACTIVO', bloqueosVigentes: [] });
  });

  it('con uno: BLOQUEADO y ese bloqueo', () => {
    const cuenta = aEstadoCuenta(CLIENTE_ID, [filaBloqueo()]);

    expect(cuenta.estado).toBe('BLOQUEADO');
    expect(cuenta.bloqueosVigentes).toEqual([expect.objectContaining({ bloqueoId: BLOQUEO_ID, vigente: true })]);
  });

  it('con varios: BLOQUEADO y todos, en el orden recibido', () => {
    const otro = 'c4b2d3e5-6f7a-4b8c-9dae-1f2a3b4c5d6e';
    const cuenta = aEstadoCuenta(CLIENTE_ID, [filaBloqueo({ bloqueo_id: otro }), filaBloqueo()]);

    expect(cuenta.estado).toBe('BLOQUEADO');
    expect(cuenta.bloqueosVigentes.map((bloqueo) => bloqueo.bloqueoId)).toEqual([otro, BLOQUEO_ID]);
  });
});

describe('aPaginaBloqueos(): la página del historial con sus totales (RF-2.6.2)', () => {
  it('los bloqueos de la página, en el orden recibido, con page y size pedidos', () => {
    const pagina = aPaginaBloqueos([filaBloqueo()], 1, 0, 20);

    expect(pagina).toStrictEqual({
      page: 0,
      size: 20,
      totalElementos: 1,
      totalPaginas: 1,
      items: [aBloqueo(filaBloqueo())],
    });
  });

  it.each([
    [0, 20, 0],
    [1, 20, 1],
    [20, 20, 1],
    [21, 20, 2],
    [41, 20, 3],
    [5, 1, 5],
  ])('%i bloqueos de a %i: %i páginas', (total, size, paginas) => {
    expect(aPaginaBloqueos([], total, 0, size).totalPaginas).toBe(paginas);
  });

  it('una página fuera del total: items vacío, con los totales correctos (spec 004, Casos límite)', () => {
    expect(aPaginaBloqueos([], 3, 7, 2)).toStrictEqual({ page: 7, size: 2, totalElementos: 3, totalPaginas: 2, items: [] });
  });
});

describe('BloqueoVencido (spec 004, Casos límite)', () => {
  it('es un 422 con su tipo propio, sin la fecha ni el motivo', () => {
    const { codigo, cuerpo } = aProblema(new BloqueoVencido(), '/api/v1/clientes/x/bloqueos');

    expect(codigo).toBe(422);
    expect(cuerpo).toEqual({
      type: '/errores/bloqueo-vencido',
      title: 'Bloqueo vencido',
      status: 422,
      detail: 'El fin del bloqueo tiene que ser posterior a su creación',
      instance: '/api/v1/clientes/x/bloqueos',
    });
  });
});

describe('BloqueoHastaFueraDeRango (RF-2.6.1.2)', () => {
  it('es un 422 con su tipo propio, sin la fecha ni el motivo', () => {
    const { codigo, cuerpo } = aProblema(new BloqueoHastaFueraDeRango(), '/api/v1/clientes/x/bloqueos');

    expect(codigo).toBe(422);
    expect(cuerpo).toEqual({
      type: '/errores/bloqueo-hasta-fuera-de-rango',
      title: 'Fin del bloqueo fuera de rango',
      status: 422,
      detail: 'El fin del bloqueo tiene que ser anterior al año 10000 (UTC)',
      instance: '/api/v1/clientes/x/bloqueos',
    });
  });
});

describe('BloqueoYaLevantado y BloqueoNoVigente (RF-2.6.3.1, spec 004, Casos límite)', () => {
  it.each([
    ['BloqueoYaLevantado', new BloqueoYaLevantado(), '/errores/bloqueo-ya-levantado', 'Bloqueo ya levantado', 'El bloqueo ya fue levantado'],
    ['BloqueoNoVigente', new BloqueoNoVigente(), '/errores/bloqueo-no-vigente', 'Bloqueo no vigente', 'El bloqueo ya venció: no se puede levantar'],
  ])('%s es un 409 con su tipo propio, sin ids ni motivos', (_nombre, error, type, title, detail) => {
    const { codigo, cuerpo } = aProblema(error, '/api/v1/clientes/x/bloqueos/y');

    expect(codigo).toBe(409);
    expect(cuerpo).toEqual({ type, title, status: 409, detail, instance: '/api/v1/clientes/x/bloqueos/y' });
  });
});
