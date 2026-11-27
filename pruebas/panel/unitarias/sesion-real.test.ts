import { describe, it, expect } from 'vitest';
import { crearSesionReal } from '../../../panel/cliente/src/fuentes/sesion-real.js';
import { crearApiM2 } from '../../../panel/cliente/src/api/m2.js';
describe('fuente de sesión real', () => {
  it('consulta solo la sesión propia, conserva roles firmados y diferencia 401/503', async () => {
    let estado = 200; const urls: string[] = [];
    const fuente = crearSesionReal(async (url) => { urls.push(String(url)); return estado === 200
      ? Response.json({ sub: 'persona', roles: ['CLIENTE', 'OPERADOR'], scopes: ['clientes:read'] }) : new Response('', { status: estado }); });
    await fuente.actualizar(); expect(fuente.actual().sesion?.roles).toEqual(['CLIENTE', 'OPERADOR']);
    estado = 503; await fuente.actualizar(); expect(fuente.actual().estado).toBe('no-disponible');
    estado = 401; await fuente.actualizar(); expect(fuente.actual().estado).toBe('sin-sesion');
    expect(urls).toEqual(['/auth/sesion', '/auth/sesion', '/auth/sesion']);
    expect(JSON.stringify(fuente.actual())).not.toMatch(/token|refresh/i);
  });
});
it('distingue fallo de identidad al consumir API para bloquear envío sin borrar sesión', async () => {
  const fuente = crearSesionReal(async () => Response.json({ sub: 'persona', roles: ['CLIENTE'], scopes: [] }));
  await fuente.actualizar();
  const api = crearApiM2({ fetch: async () => Response.json({ type: '/panel/errores/identidad-no-disponible', title: 'Identidad no disponible' }, { status: 503 }),
    alFallar: error => { if (error.type === '/panel/errores/identidad-no-disponible') fuente.noDisponible(); } });
  await expect(api.obtenerCliente('persona')).rejects.toMatchObject({ estado: 503 });
  expect(fuente.actual()).toMatchObject({ estado: 'no-disponible', sesion: { sub: 'persona' } });
});
