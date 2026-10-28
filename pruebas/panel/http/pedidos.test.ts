import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { capturarLogs } from '../../ayudas/logs.js';
import { crearServidorModulo } from '../../ayudas/servidor-modulo.js';
import { crearAppPanel, DESDE_EL_PANEL, DESDE_EL_PANEL_CON_ORIGEN } from '../ayudas/app.js';

const SUB = '00000000-0000-4000-8000-000000000001';
const COMO_CLIENTE = { 'x-panel-rol': 'CLIENTE', 'x-panel-sub': SUB };

const m2 = crearServidorModulo();
beforeAll(async () => {
  await m2.levantar();
});
afterAll(async () => {
  await m2.cerrar();
});

const abiertas: ReturnType<typeof crearAppPanel>[] = [];
function panel(opciones: Parameters<typeof crearAppPanel>[0] = {}) {
  const app = crearAppPanel({ ...opciones, config: { urlM2: m2.url, urlM2Publica: 'https://m2.ejemplo.test', ...opciones.config } });
  abiertas.push(app);
  return app;
}
afterEach(async () => {
  await Promise.all(abiertas.splice(0).map((app) => app.close()));
  m2.responderCon({ tipo: 'ok' });
});

type PedidoPresentado = {
  requestId: string;
  hora: string;
  metodo: string;
  ruta: string;
  estado: number;
  duracionMs: number;
  encabezados: Record<string, string>;
  cuerpo?: string;
  curl: string;
};
const leer = async (app: ReturnType<typeof panel>) =>
  (await app.inject({ method: 'GET', url: '/panel/pedidos', headers: DESDE_EL_PANEL })).json<{ pedidos: PedidoPresentado[] }>().pedidos;

describe('GET /panel/pedidos: el detalle técnico (RNF-14.9)', () => {
  it('sin pedidos devuelve una lista vacía', async () => {
    const respuesta = await panel().inject({ method: 'GET', url: '/panel/pedidos', headers: DESDE_EL_PANEL });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({ pedidos: [] });
  });

  it('devuelve los pedidos a M2 con método, ruta, código, duración y X-Request-Id, el más nuevo primero', async () => {
    const app = panel();
    await app.inject({ method: 'GET', url: '/health', headers: { ...DESDE_EL_PANEL, 'x-request-id': 'primero' } });
    m2.responderCon({ tipo: 'ok', estado: 201 });
    await app.inject({
      method: 'POST',
      url: '/api/v1/clientes',
      headers: { ...DESDE_EL_PANEL_CON_ORIGEN, ...COMO_CLIENTE, 'content-type': 'application/json', 'idempotency-key': 'clave-9', 'x-request-id': 'segundo' },
      payload: '{"nombre":"Ana"}',
    });

    const pedidos = await leer(app);

    expect(pedidos.map((p) => [p.requestId, p.metodo, p.ruta, p.estado])).toEqual([
      ['segundo', 'POST', '/api/v1/clientes', 201],
      ['primero', 'GET', '/health', 200],
    ]);
    for (const p of pedidos) {
      expect(typeof p.duracionMs).toBe('number');
      expect(Number.isNaN(Date.parse(p.hora))).toBe(false);
    }
    expect(pedidos[0]?.cuerpo).toBe('{"nombre":"Ana"}');
  });

  it('el Authorization figura enmascarado como Bearer •••• y el token real no sale', async () => {
    const app = panel();
    await app.inject({ method: 'GET', url: '/api/v1/clientes', headers: { ...DESDE_EL_PANEL, ...COMO_CLIENTE } });
    const token = (m2.encabezadosRecibidos.get('authorization') ?? '').replace('Bearer ', '');

    const respuesta = await app.inject({ method: 'GET', url: '/panel/pedidos', headers: DESDE_EL_PANEL });

    expect(token.length).toBeGreaterThan(20);
    expect(respuesta.json<{ pedidos: PedidoPresentado[] }>().pedidos[0]?.encabezados['Authorization']).toBe('Bearer ••••');
    expect(JSON.stringify(respuesta.headers) + respuesta.body).not.toContain(token);
  });

  it('trae el curl equivalente con $TOKEN y la dirección pública de M2', async () => {
    const app = panel();
    await app.inject({
      method: 'POST',
      url: '/api/v1/clientes',
      headers: { ...DESDE_EL_PANEL_CON_ORIGEN, ...COMO_CLIENTE, 'content-type': 'application/json', 'idempotency-key': 'clave-9', 'x-request-id': 'alta-1' },
      payload: '{"nombre":"Ana"}',
    });

    const [pedido] = await leer(app);

    expect(pedido?.curl).toBe(
      `curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H 'Idempotency-Key: clave-9' -H 'X-Request-Id: alta-1' -d '{"nombre":"Ana"}' 'https://m2.ejemplo.test/api/v1/clientes'`,
    );
    expect(pedido?.curl).not.toMatch(/eyJ/);
  });

  it('un pedido sin identidad se registra sin Authorization', async () => {
    const app = panel();
    await app.inject({ method: 'GET', url: '/api/v1/clientes', headers: DESDE_EL_PANEL });

    const [pedido] = await leer(app);

    expect(pedido?.encabezados['Authorization']).toBeUndefined();
    expect(pedido?.curl).not.toContain('Authorization');
  });

  it('un pedido que M2 no contestó queda registrado con 504', async () => {
    m2.responderCon({ tipo: 'cuelga' });
    const app = panel({ esperaM2Ms: 150 });
    await app.inject({ method: 'GET', url: '/api/v1/clientes', headers: { ...DESDE_EL_PANEL, ...COMO_CLIENTE } });

    const [pedido] = await leer(app);

    expect(pedido).toMatchObject({ metodo: 'GET', ruta: '/api/v1/clientes', estado: 504 });
    expect(pedido?.duracionMs).toBeGreaterThanOrEqual(100);
  });

  it('lo que el panel rechaza antes de llamar a M2 no se registra', async () => {
    const app = panel();
    await app.inject({ method: 'GET', url: '/api/v1/conductores', headers: DESDE_EL_PANEL });
    await app.inject({ method: 'POST', url: '/api/v1/clientes', headers: { ...DESDE_EL_PANEL, ...COMO_CLIENTE } });
    await app.inject({ method: 'GET', url: '/api/v1/clientes', headers: { ...DESDE_EL_PANEL, 'x-panel-rol': 'ADMIN', 'x-panel-sub': SUB } });

    expect(await leer(app)).toEqual([]);
  });

  it('los pedidos a /panel/pedidos y /salud-panel no se cuentan', async () => {
    const app = panel();
    await app.inject({ method: 'GET', url: '/salud-panel', headers: DESDE_EL_PANEL });

    expect(await leer(app)).toEqual([]);
    expect(await leer(app)).toEqual([]);
  });

  it('guarda los últimos 50', async () => {
    const app = panel();
    for (let i = 0; i < 55; i++) await app.inject({ method: 'GET', url: `/api/v1/clientes?pagina=${i}`, headers: DESDE_EL_PANEL });

    const pedidos = await leer(app);

    expect(pedidos).toHaveLength(50);
    expect(pedidos[0]?.ruta).toBe('/api/v1/clientes?pagina=54');
    expect(pedidos.at(-1)?.ruta).toBe('/api/v1/clientes?pagina=5');
  });

  it('cada panel tiene su propio registro', async () => {
    const uno = panel();
    const otro = panel();
    await uno.inject({ method: 'GET', url: '/health', headers: DESDE_EL_PANEL });

    expect(await leer(uno)).toHaveLength(1);
    expect(await leer(otro)).toEqual([]);
  });

  it('el cuerpo no va a los logs aunque se guarde para el curl', async () => {
    const logs = capturarLogs();
    const app = panel({ flujoLog: logs.flujo });
    await app.inject({
      method: 'POST',
      url: '/api/v1/clientes',
      headers: { ...DESDE_EL_PANEL_CON_ORIGEN, ...COMO_CLIENTE, 'content-type': 'application/json' },
      payload: '{"telefono":"+5493624999999"}',
    });
    await app.inject({ method: 'GET', url: '/panel/pedidos', headers: DESDE_EL_PANEL });

    expect(logs.texto()).not.toContain('5493624999999');
    expect(logs.texto()).not.toContain('Bearer');
  });

  it('exige el Host propio como todo lo demás', async () => {
    const respuesta = await panel().inject({ method: 'GET', url: '/panel/pedidos', headers: { host: 'evil.test' } });

    expect(respuesta.statusCode).toBe(403);
  });
});
