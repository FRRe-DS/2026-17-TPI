import { describe, expect, it } from 'vitest';
import {
  CLIENTE_DE_EJEMPLO,
  cuerpoDeAlta,
  validarCamposCliente,
  type CamposCliente,
} from '../../../panel/cliente/src/logica/campos-cliente.js';
import {
  CLAVE_DE_RECORDADOS,
  crearRecordadosGuardados,
  IDENTIFICADOR_DE_EJEMPLO,
  validarIdentificador,
} from '../../../panel/cliente/src/logica/ingresar.js';
import { MAXIMO_RECORDADOS } from '../../../panel/cliente/src/logica/recordados.js';
import { ROLES } from '../../../panel/cliente/src/rutas.js';

// Las reglas de la pantalla `ingresar` (T19) que no necesitan a M2: las validaciones del formulario de alta y del identificador,
// y los clientes recordados guardados en el almacenamiento local. El recorrido con M2 real está en
// `pruebas/panel/integracion/pantalla-ingresar.test.ts`.

const ANA = { id: '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b', nombre: 'Ana Gómez' };
const BETO = { id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', nombre: 'Beto Ruiz' };
const con = (cambios: Partial<CamposCliente>): CamposCliente => ({ ...CLIENTE_DE_EJEMPLO, ...cambios });

describe('validarCamposCliente: las reglas de ClienteNuevo del contrato (RF-2.1.5)', () => {
  it('los valores de ejemplo son válidos y todos los campos vienen llenos', () => {
    expect(validarCamposCliente(CLIENTE_DE_EJEMPLO)).toEqual({});
    expect(Object.values(CLIENTE_DE_EJEMPLO).every((valor) => valor !== '')).toBe(true);
  });

  it('nombre y apellido son obligatorios y tienen hasta 100 caracteres', () => {
    expect(validarCamposCliente(con({ nombre: '', apellido: '   ' }))).toEqual({
      nombre: 'El nombre es obligatorio.',
      apellido: 'El apellido es obligatorio.',
    });
    expect(validarCamposCliente(con({ nombre: 'n'.repeat(100), apellido: 'a'.repeat(100) }))).toEqual({});
    expect(validarCamposCliente(con({ nombre: 'n'.repeat(101), apellido: 'a'.repeat(101) }))).toEqual({
      nombre: 'Hasta 100 caracteres.',
      apellido: 'Hasta 100 caracteres.',
    });
  });

  it.each(['+5493624000000', '+1234567', '+123456789012345', ' +5493624000000 '])('acepta el teléfono %j', (telefono) => {
    expect(validarCamposCliente(con({ telefono }))).toEqual({});
  });

  it.each(['', '5493624000000', '+0123456789', '+123456', '+1234567890123456', '+54 9 362 400-0000', '+54936240000a'])(
    'rechaza el teléfono %j',
    (telefono) => {
      expect(validarCamposCliente(con({ telefono })).telefono).toMatch(/E\.164/);
    },
  );

  it('la fecha de nacimiento es opcional', () => {
    expect(validarCamposCliente(con({ fechaNacimiento: '' }))).toEqual({});
  });

  it.each(['0001-01-01', '2000-02-29', '9999-12-31'])('acepta la fecha %s', (fechaNacimiento) => {
    expect(validarCamposCliente(con({ fechaNacimiento }))).toEqual({});
  });

  it.each([
    ['0000-06-15', 'La fecha tiene que ser del año 0001 o posterior.'],
    ['2001-02-29', 'Esa fecha no existe.'],
    ['1990-13-01', 'Esa fecha no existe.'],
    ['1990-04-31', 'Esa fecha no existe.'],
    ['14/05/1990', 'La fecha va como AAAA-MM-DD.'],
    ['1990-5-14', 'La fecha va como AAAA-MM-DD.'],
  ])('rechaza la fecha %s', (fechaNacimiento, mensaje) => {
    expect(validarCamposCliente(con({ fechaNacimiento })).fechaNacimiento).toBe(mensaje);
  });
});

describe('cuerpoDeAlta: lo que se manda a crearCliente', () => {
  it('los cuatro campos, sin espacios de más', () => {
    expect(cuerpoDeAlta(con({ nombre: '  Ana ', apellido: 'Gómez  ', telefono: ' +5493624000000' }))).toEqual({
      nombre: 'Ana',
      apellido: 'Gómez',
      telefono: '+5493624000000',
      fechaNacimiento: '1990-05-14',
    });
  });

  it('sin fecha, el campo no va', () => {
    expect(cuerpoDeAlta(con({ fechaNacimiento: '  ' }))).not.toHaveProperty('fechaNacimiento');
  });
});

describe('validarIdentificador: entrar con un rol (RNF-12.9)', () => {
  it.each(ROLES.filter((rol) => rol !== 'CLIENTE'))('%s acepta cualquier texto de 1 a 128 caracteres', (rol) => {
    expect(validarIdentificador(rol, 'operador-1')).toBeUndefined();
    expect(validarIdentificador(rol, 'x'.repeat(128))).toBeUndefined();
    expect(validarIdentificador(rol, '')).toBe('Escribí un identificador.');
    expect(validarIdentificador(rol, '   ')).toBe('Escribí un identificador.');
    expect(validarIdentificador(rol, 'x'.repeat(129))).toBe('Hasta 128 caracteres.');
  });

  it('CLIENTE exige el UUID del cliente: con otro texto M2 respondería 400', () => {
    expect(validarIdentificador('CLIENTE', ANA.id)).toBeUndefined();
    expect(validarIdentificador('CLIENTE', ` ${ANA.id.toUpperCase()} `)).toBeUndefined();
    expect(validarIdentificador('CLIENTE', 'cliente-1')).toMatch(/UUID/);
  });

  it('cada rol tiene un identificador de ejemplo válido, salvo CLIENTE, que se escribe o se elige de los recordados', () => {
    for (const rol of ROLES) {
      const ejemplo = IDENTIFICADOR_DE_EJEMPLO[rol];
      if (rol === 'CLIENTE') expect(ejemplo).toBe('');
      else expect(validarIdentificador(rol, ejemplo)).toBeUndefined();
    }
  });
});

// Un almacenamiento local de mentira, que guarda en un mapa y puede fallar en todo.
function almacenamiento({ falla = false, inicial = {} as Record<string, string> } = {}) {
  const datos = new Map(Object.entries(inicial));
  const probar = () => {
    if (falla) throw new DOMException('Almacenamiento bloqueado', 'SecurityError');
  };
  return {
    datos,
    getItem: (clave: string) => (probar(), datos.get(clave) ?? null),
    setItem: (clave: string, valor: string) => (probar(), void datos.set(clave, valor)),
    removeItem: (clave: string) => (probar(), void datos.delete(clave)),
  };
}

describe('crearRecordadosGuardados: los recordados en el almacenamiento local (RF-2.1.6)', () => {
  it('lee lo guardado y descarta lo que no tiene la forma', () => {
    const guardado = JSON.stringify([ANA, { id: 'no-es-uuid', nombre: 'X' }, { ...BETO, token: 'secreto' }]);
    const recordados = crearRecordadosGuardados(almacenamiento({ inicial: { [CLAVE_DE_RECORDADOS]: guardado } }));

    expect(recordados.lista()).toEqual([ANA, BETO]);
  });

  it('agregar pone el cliente primero y lo guarda; quitar lo saca y lo guarda', () => {
    const local = almacenamiento();
    const recordados = crearRecordadosGuardados(local);

    recordados.agregar(ANA);
    expect(recordados.agregar(BETO)).toEqual([BETO, ANA]);
    expect(JSON.parse(local.datos.get(CLAVE_DE_RECORDADOS)!)).toEqual([BETO, ANA]);

    expect(recordados.quitar(BETO.id)).toEqual([ANA]);
    expect(JSON.parse(local.datos.get(CLAVE_DE_RECORDADOS)!)).toEqual([ANA]);
  });

  it('otra pestaña ve lo guardado por la primera al abrir el panel', () => {
    const local = almacenamiento();
    crearRecordadosGuardados(local).agregar(ANA);

    expect(crearRecordadosGuardados(local).lista()).toEqual([ANA]);
  });

  it(`guarda hasta ${MAXIMO_RECORDADOS}`, () => {
    const recordados = crearRecordadosGuardados(almacenamiento());
    for (let n = 0; n < MAXIMO_RECORDADOS + 2; n++) {
      recordados.agregar({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, nombre: `Cliente ${n}` });
    }

    expect(recordados.lista()).toHaveLength(MAXIMO_RECORDADOS);
    expect(recordados.lista()[0]?.nombre).toBe(`Cliente ${MAXIMO_RECORDADOS + 1}`);
  });

  it('con el almacenamiento bloqueado o ausente, recuerda mientras la página está abierta', () => {
    for (const local of [almacenamiento({ falla: true }), undefined]) {
      const recordados = crearRecordadosGuardados(local);

      expect(recordados.lista()).toEqual([]);
      expect(recordados.agregar(ANA)).toEqual([ANA]);
      expect(recordados.quitar(ANA.id)).toEqual([]);
    }
  });
});
