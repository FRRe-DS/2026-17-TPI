import { describe, expect, it } from 'vitest';
import { autorizar } from '../../src/auth/permisos.js';
import { ROLES_CONOCIDOS } from '../../src/auth/tokens.js';
import { SinPermiso } from '../../src/errores.js';

// `autorizar` no devuelve nada: deja pasar o lanza el 403 de la tabla de errores del plan (Lógica 6).
const acepta = (rolesDelToken: readonly string[], rolesDeLaOperacion: readonly string[]) => {
  expect(() => autorizar(rolesDelToken, rolesDeLaOperacion)).not.toThrow();
};
const rechaza = (rolesDelToken: readonly string[], rolesDeLaOperacion: readonly string[]): SinPermiso => {
  try {
    autorizar(rolesDelToken, rolesDeLaOperacion);
  } catch (error) {
    expect(error).toBeInstanceOf(SinPermiso);
    return error as SinPermiso;
  }
  return expect.unreachable('autorizar tendría que haber lanzado SinPermiso');
};

describe('autorizar: alcanza con un rol del token que la operación permite (RNF-12.3)', () => {
  it.each([
    ['un rol del token y uno de la operación', ['CLIENTE'], ['CLIENTE']],
    ['un rol del token entre varios de la operación', ['OPERADOR'], ['CLIENTE', 'OPERADOR']],
    ['varios roles del token y uno de la operación', ['CLIENTE', 'CONDUCTOR'], ['CONDUCTOR']],
    ['varios roles de los dos lados, con uno en común', ['CLIENTE', 'CONDUCTOR'], ['OPERADOR', 'CONDUCTOR']],
    ['los cuatro roles del token', ['CLIENTE', 'CONDUCTOR', 'OPERADOR', 'SERVICIO'], ['SERVICIO']],
    ['un rol repetido en el token', ['CLIENTE', 'CLIENTE'], ['CLIENTE']],
    ['el último de los roles de la operación', ['SERVICIO'], ['CLIENTE', 'CONDUCTOR', 'OPERADOR', 'SERVICIO']],
  ])('%s', (_caso, rolesDelToken, rolesDeLaOperacion) => {
    acepta(rolesDelToken, rolesDeLaOperacion);
  });
});

describe('autorizar: 403 si ningún rol del token está permitido (RNF-12.3)', () => {
  it.each([
    ['un rol del token y otro de la operación', ['CLIENTE'], ['OPERADOR']],
    ['varios roles del token y ninguno en la operación', ['CLIENTE', 'CONDUCTOR'], ['OPERADOR', 'SERVICIO']],
    ['un rol del token y varios de la operación, sin ninguno en común', ['CONDUCTOR'], ['CLIENTE', 'OPERADOR']],
    ['los cuatro roles del token y una operación que lista un rol que el servicio no conoce', ROLES_CONOCIDOS, ['ADMIN']],
  ])('%s', (_caso, rolesDelToken, rolesDeLaOperacion) => {
    rechaza(rolesDelToken, rolesDeLaOperacion);
  });

  it('el error es el 403 de la tabla de errores: título y detalle fijos, y ningún encabezado', () => {
    const { codigo, title, detail, encabezados } = rechaza(['CLIENTE'], ['OPERADOR']);

    expect({ codigo, title, detail, encabezados }).toEqual({
      codigo: 403,
      title: 'Sin permiso',
      detail: 'El rol del token no permite esta operación',
      encabezados: {},
    });
  });

  it('el detalle no dice qué roles tenía el token ni cuáles pide la operación', () => {
    const { detail } = rechaza(['CLIENTE', 'CONDUCTOR'], ['OPERADOR']);

    for (const rol of ['CLIENTE', 'CONDUCTOR', 'OPERADOR']) expect(detail).not.toContain(rol);
  });
});

describe('autorizar: los roles que el servicio no conoce se ignoran (RNF-12.3)', () => {
  it.each([
    ['un rol desconocido y una operación sin roles', ['ADMIN'], []],
    ['un rol desconocido que la operación también lista', ['ADMIN'], ['ADMIN']],
    ['varios roles desconocidos', ['ADMIN', 'SUPERUSUARIO'], ['ADMIN']],
    ['un rol desconocido y una operación que pide uno conocido', ['ADMIN'], ['CLIENTE']],
    ['un rol conocido en minúsculas', ['cliente'], ['CLIENTE']],
    ['un rol conocido en minúsculas y una operación sin roles', ['cliente'], []],
    ['un rol conocido con la primera letra en mayúscula', ['Cliente'], ['CLIENTE']],
    ['un rol conocido con espacios', [' CLIENTE'], ['CLIENTE']],
    ['un rol conocido en el token y en minúsculas en la operación', ['CLIENTE'], ['cliente']],
    ['un rol vacío', [''], []],
    ['nombres que Object.prototype ya tiene', ['toString', '__proto__', 'constructor', 'hasOwnProperty'], []],
    ['un nombre heredado que la operación también lista', ['constructor'], ['constructor']],
  ])('%s: 403', (_caso, rolesDelToken, rolesDeLaOperacion) => {
    rechaza(rolesDelToken, rolesDeLaOperacion);
  });

  it.each([
    ['uno desconocido y uno conocido que la operación permite', ['ADMIN', 'CLIENTE'], ['CLIENTE']],
    ['uno conocido en minúsculas y otro bien escrito', ['cliente', 'CLIENTE'], ['CLIENTE']],
    ['uno desconocido y uno conocido, con una operación sin roles', ['ADMIN', 'OPERADOR'], []],
  ])('%s: alcanza el conocido', (_caso, rolesDelToken, rolesDeLaOperacion) => {
    acepta(rolesDelToken, rolesDeLaOperacion);
  });
});

describe('autorizar: un token sin roles no tiene permiso para nada (RNF-12.3)', () => {
  it('con la lista vacía y una operación que lista roles: 403', () => {
    rechaza([], ['CLIENTE']);
  });

  it('con la lista vacía y una operación que no lista roles: 403', () => {
    rechaza([], []);
  });
});

describe('autorizar: una operación sin roles acepta cualquier rol conocido (RNF-12.3)', () => {
  it.each(ROLES_CONOCIDOS)('con el rol %s', (rol) => {
    acepta([rol], []);
  });

  it('con varios roles conocidos', () => {
    acepta(['CLIENTE', 'OPERADOR'], []);
  });
});

describe('autorizar: no toca lo que recibe', () => {
  it('acepta listas congeladas, así que no las cambia', () => {
    acepta(Object.freeze(['ADMIN', 'CLIENTE']), Object.freeze(['CLIENTE']));
    rechaza(Object.freeze(['ADMIN']), Object.freeze(['CLIENTE']));
  });
});
