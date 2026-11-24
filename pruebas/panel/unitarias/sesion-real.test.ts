import { describe, it, expect } from 'vitest';
import { crearSesionReal } from '../../../panel/cliente/src/fuentes/sesion-real.js';
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
