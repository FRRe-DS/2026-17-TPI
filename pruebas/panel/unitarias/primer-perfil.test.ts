import { it, expect } from 'vitest';
import { consultarPerfilPropio } from '../../../panel/cliente/src/logica/primer-perfil.js';
import { ErrorDeApi } from '../../../panel/cliente/src/api/errores.js';
it('solo 404 significa primer ingreso y siempre consulta sub autenticado', async () => {
  for (const estado of [200, 404, 401, 403, 503]) {
    const api = { obtenerCliente: async (sub: string) => { expect(sub).toBe('autenticado');
      if (estado !== 200) throw new ErrorDeApi({ estado, sinRespuesta: false, type: 'prueba', title: 'Prueba' });
      return { clienteId: sub }; } };
    if (estado === 200 || estado === 404) expect((await consultarPerfilPropio(api, 'autenticado')).tipo).toBe(estado === 200 ? 'existente' : 'nuevo');
    else await expect(consultarPerfilPropio(api, 'autenticado')).rejects.toMatchObject({ estado });
  }
});
