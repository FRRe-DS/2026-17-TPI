import { it, expect } from 'vitest';
import { consultarPerfilPropio, crearAltaPropia } from '../../../panel/cliente/src/logica/primer-perfil.js';
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
it('conserva clave y cuerpo ante fallo incierto y recupera perfil ante 409', async () => {
  const enviados: string[] = []; let veces = 0;
  const api = { obtenerCliente: async () => ({ clienteId: 'propio' }), crearCliente: async (_cuerpo: unknown, clave: string) => {
    enviados.push(clave); if (++veces === 1) throw new ErrorDeApi({ estado: 503, sinRespuesta: false, type: 'prueba', title: 'Prueba' });
    throw new ErrorDeApi({ estado: 409, sinRespuesta: false, type: 'prueba', title: 'Existe' });
  } };
  const alta = crearAltaPropia(api, 'propio');
  await expect(alta.enviar({ nombre: 'Ana', apellido: 'Uno', telefono: '+5493624000000' })).rejects.toMatchObject({ estado: 503 });
  expect(await alta.enviar({ nombre: 'Ana', apellido: 'Uno', telefono: '+5493624000000' })).toEqual({ clienteId: 'propio' });
  expect(enviados[0]).toBe(enviados[1]);
});
