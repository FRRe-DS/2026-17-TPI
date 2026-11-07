import { describe, expect, it } from 'vitest';
import { exigirScope } from '../../src/auth/permisos.js';
import { SinPermiso } from '../../src/errores.js';

// `exigirScope` no devuelve nada: deja pasar o lanza el 403 por el scope (RNF-12.13). Pide todos los scopes de la operación,
// con comparación exacta.
const rechaza = (delToken: readonly string[], deLaOperacion: readonly string[]): SinPermiso => {
  try {
    exigirScope(delToken, deLaOperacion);
  } catch (error) {
    expect(error).toBeInstanceOf(SinPermiso);
    return error as SinPermiso;
  }
  return expect.unreachable('exigirScope tendría que haber lanzado SinPermiso');
};

describe('exigirScope: deja pasar si el token trae todos los scopes de la operación', () => {
  it.each<[string, string[], string[]]>([
    ['uno y uno', ['clientes:read'], ['clientes:read']],
    ['la operación sin scopes y el token sin scopes', [], []],
    ['la operación sin scopes y el token con alguno', ['clientes:read'], []],
    ['el token con más de los que pide', ['openid', 'clientes:read', 'clientes:write'], ['clientes:read']],
    ['dos de los dos', ['clientes:write', 'clientes:read'], ['clientes:read', 'clientes:write']],
    ['un scope repetido en el token', ['clientes:read', 'clientes:read'], ['clientes:read']],
  ])('%s', (_caso, delToken, deLaOperacion) => {
    expect(() => exigirScope(delToken, deLaOperacion)).not.toThrow();
  });
});

describe('exigirScope: 403 si falta alguno', () => {
  it.each<[string, string[], string[]]>([
    ['el token sin scopes', [], ['clientes:read']],
    ['otro scope', ['clientes:write'], ['clientes:read']],
    ['falta uno de dos', ['clientes:read'], ['clientes:read', 'clientes:write']],
    ['mayúsculas distintas', ['Clientes:Read'], ['clientes:read']],
    ['un prefijo', ['clientes'], ['clientes:read']],
    ['un scope más largo', ['clientes:read:todo'], ['clientes:read']],
    ['espacios de más', [' clientes:read'], ['clientes:read']],
    ['el nombre de un rol', ['CLIENTE'], ['clientes:read']],
  ])('%s', (_caso, delToken, deLaOperacion) => {
    const error = rechaza(delToken, deLaOperacion);
    expect(error.codigo).toBe(403);
    expect(error.type).toBe('about:blank');
  });

  it('el detail habla del scope y no del rol, y no nombra el scope ni los del token', () => {
    const { detail } = rechaza(['scope-del-token'], ['scope-de-la-operacion']);
    expect(detail).toBe('El token no trae el scope que pide la operación');
    expect(detail).not.toMatch(/rol/i);
    expect(detail).not.toContain('scope-del-token');
    expect(detail).not.toContain('scope-de-la-operacion');
  });

  it('no se deja engañar por nombres de Object.prototype', () => {
    rechaza(['toString'], ['constructor']);
    rechaza([], ['__proto__']);
  });
});
