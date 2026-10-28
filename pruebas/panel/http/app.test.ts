import { afterEach, describe, expect, it } from 'vitest';
import { idDePedido } from '../../../panel/servidor/app.js';
import { capturarLogs } from '../../ayudas/logs.js';
import { crearAppPanel, DESDE_EL_PANEL, DESDE_EL_PANEL_CON_ORIGEN } from '../ayudas/app.js';

const abiertas: ReturnType<typeof crearAppPanel>[] = [];
function crear(...argumentos: Parameters<typeof crearAppPanel>) {
  const app = crearAppPanel(...argumentos);
  abiertas.push(app);
  return app;
}
afterEach(async () => {
  await Promise.all(abiertas.splice(0).map((app) => app.close()));
});

describe('errores propios del panel en application/problem+json (RNF-03.6)', () => {
  it('una ruta que no existe da 404', async () => {
    const respuesta = await crear().inject({ method: 'GET', url: '/no-existe', headers: DESDE_EL_PANEL });

    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(respuesta.json()).toEqual({ type: '/panel/errores/no-encontrado', title: 'No encontrado', status: 404 });
  });

  it('un cuerpo de más de 1 MiB da 413', async () => {
    const app = crear();
    app.post('/probar', async () => ({}));

    const respuesta = await app.inject({
      method: 'POST',
      url: '/probar',
      headers: { ...DESDE_EL_PANEL_CON_ORIGEN, 'content-type': 'application/json' },
      payload: JSON.stringify({ texto: 'x'.repeat(1024 * 1024 + 1) }),
    });

    expect(respuesta.statusCode).toBe(413);
    expect(respuesta.headers['content-type']).toMatch(/^application\/problem\+json/);
  });

  it('un error no previsto da 500 sin detalle y queda en el log', async () => {
    const logs = capturarLogs();
    const app = crear({ flujoLog: logs.flujo });
    app.get('/falla', async () => {
      throw new Error('detalle interno que no sale');
    });

    const respuesta = await app.inject({ method: 'GET', url: '/falla', headers: DESDE_EL_PANEL });

    expect(respuesta.statusCode).toBe(500);
    expect(respuesta.json()).toEqual({ type: '/panel/errores/error-interno', title: 'Internal Server Error', status: 500 });
    expect(respuesta.body).not.toContain('detalle interno');
    expect(logs.lineas().find((linea) => linea.level === 50)?.err).toEqual({ tipo: 'Error', mensaje: 'detalle interno que no sale' });
  });
});

describe('idDePedido (RNF-14.9)', () => {
  it.each(['a', 'mi-pedido_1.2', 'x'.repeat(128)])('conserva %j', (valor) => {
    expect(idDePedido(valor)).toBe(valor);
  });

  it.each([undefined, '', 'con espacio', 'x'.repeat(129), 'ñandú', ['uno', 'dos']])('reemplaza %j por uno propio', (valor) => {
    expect(idDePedido(valor)).toMatch(/^panel-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
