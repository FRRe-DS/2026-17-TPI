import { describe, it, expect } from 'vitest';
import { espaciosDe, permiteRutaReal } from '../../../panel/cliente/src/logica/permisos-reales.js';
describe('permisos reales', () => {
  it('separa espacios sin cambiar identidad y rechaza rutas directas de evaluación', () => {
    const sesion = { sub: 'mismo-usuario', roles: ['CLIENTE', 'OPERADOR'] as const, scopes: ['clientes:read', 'clientes:write', 'clientes.estado:read'] };
    expect(espaciosDe(sesion)).toEqual(['CLIENTE', 'OPERADOR']);
    expect(permiteRutaReal('perfil', sesion, 'CLIENTE')).toBe(true);
    expect(permiteRutaReal('operador', sesion, 'OPERADOR')).toBe(true);
    for (const ruta of ['m6-simulado', 'demostracion', 'otro-modulo']) expect(permiteRutaReal(ruta, sesion, 'CLIENTE')).toBe(false);
    expect(espaciosDe({ roles: ['CONDUCTOR'], scopes: [] })).toEqual([]);
    expect(permiteRutaReal('operador', { roles: ['CLIENTE'], scopes: ['clientes:write'] }, 'CLIENTE')).toBe(false);
    expect(permiteRutaReal('perfil', { roles: ['CLIENTE'], scopes: [] }, 'CLIENTE')).toBe(false);
  });
});
