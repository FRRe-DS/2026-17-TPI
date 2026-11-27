import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { levantarPanelConM2, type PanelConM2 } from '../ayudas/panel-con-m2.js';
import { crearAltaPropia, consultarPerfilPropio } from '../../../panel/cliente/src/logica/primer-perfil.js';
import { CLIENTE_DE_EJEMPLO, cuerpoDeAlta } from '../../../panel/cliente/src/logica/campos-cliente.js';
let panel: PanelConM2;
beforeAll(async () => { panel = await levantarPanelConM2(); });
afterAll(async () => { await panel?.cerrar(); });
it('dos pestañas crean un solo perfil y recuperan 409, con M2 y PostgreSQL reales', async () => {
  const sub = randomUUID(); const api = panel.api(() => ({ rol: 'CLIENTE', sub }));
  expect((await consultarPerfilPropio(api, sub)).tipo).toBe('nuevo');
  const primera = crearAltaPropia(api, sub); const segunda = crearAltaPropia(api, sub);
  const [uno, dos] = await Promise.all([primera.enviar(cuerpoDeAlta(CLIENTE_DE_EJEMPLO)), segunda.enviar(cuerpoDeAlta(CLIENTE_DE_EJEMPLO))]);
  expect(uno.clienteId).toBe(sub); expect(dos.clienteId).toBe(sub);
  expect((await consultarPerfilPropio(api, sub)).tipo).toBe('existente');
});
