import { createServer } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { verificarToken } from '../../../src/auth/tokens.js';
import { ESPERA_M2_MS } from '../../../panel/servidor/proxy.js';
import { capturarLogs } from '../../ayudas/logs.js';
import { escuchar, leerRespuesta, porSocket } from '../../ayudas/socket.js';
import { crearServidorModulo } from '../../ayudas/servidor-modulo.js';
import { CONFIG_PANEL, crearAppPanel, DESDE_EL_PANEL, DESDE_EL_PANEL_CON_ORIGEN, PUERTO_PANEL } from '../ayudas/app.js';

const ID = '3f2a1c4e-8b7d-4e2f-9a1b-6c5d4e3f2a1b';
const SUB = '00000000-0000-4000-8000-000000000001';
const COMO_CLIENTE = { 'x-panel-rol': 'CLIENTE', 'x-panel-sub': SUB };
const PROBLEMA = 'application/problem+json';

// Un M2 de mentira en un puerto real: el panel le llega con fetch, como al de verdad.
const m2 = crearServidorModulo();
beforeAll(async () => {
  await m2.levantar();
});
afterAll(async () => {
  await m2.cerrar();
});

const abiertas: ReturnType<typeof crearAppPanel>[] = [];
function panel(opciones: Parameters<typeof crearAppPanel>[0] = {}) {
  const app = crearAppPanel({ ...opciones, config: { urlM2: m2.url, ...opciones.config } });
  abiertas.push(app);
  return app;
}
afterEach(async () => {
  await Promise.all(abiertas.splice(0).map((app) => app.close()));
  m2.responderCon({ tipo: 'ok' });
});

// Un puerto donde no escucha nadie: la conexión se rechaza.
async function puertoCerrado(): Promise<number> {
  const servidor = createServer();
  await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
  const { port } = servidor.address() as { port: number };
  await new Promise<void>((listo) => servidor.close(() => listo()));
  return port;
}

describe('qué se reenvía (RNF-12.8, plan Reenvío)', () => {
  it('GET /health llega a M2 tal cual, sin token si no se pidió una identidad', async () => {
    m2.responderCon({ tipo: 'ok', cuerpo: { estado: 'ok' } });

    const respuesta = await panel().inject({ method: 'GET', url: '/health', headers: DESDE_EL_PANEL });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({ estado: 'ok' });
    expect(m2.rutaRecibida).toBe('/health');
    expect(m2.autorizaciones).toEqual([undefined]);
  });

  it('una ruta de clientes llega con la misma ruta y query string', async () => {
    const ruta = `/api/v1/clientes/${ID}/direcciones?limite=5&cursor=abc`;

    await panel().inject({ method: 'GET', url: ruta, headers: { ...DESDE_EL_PANEL, ...COMO_CLIENTE } });

    expect(m2.llamadas).toBe(1);
    expect(m2.rutaRecibida).toBe(ruta);
    expect(m2.metodoRecibido).toBe('GET');
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)('%s llega con su método', async (method) => {
    await panel().inject({ method, url: `/api/v1/clientes/${ID}`, headers: { ...DESDE_EL_PANEL_CON_ORIGEN, ...COMO_CLIENTE } });

    expect(m2.metodoRecibido).toBe(method);
  });

  it.each([
    ['GET', '/api/v1/conductores'],
    ['GET', '/api/v1/clientesX'],
    ['GET', '/api/v2/clientes'],
    ['GET', '/'],
    ['GET', '/health/detalle'],
    ['POST', '/health'],
    ['HEAD', '/api/v1/clientes'],
  ] as const)('%s %s no se reenvía: 404', async (method, url) => {
    const headers = method === 'GET' || method === 'HEAD' ? DESDE_EL_PANEL : DESDE_EL_PANEL_CON_ORIGEN;

    const respuesta = await panel().inject({ method, url, headers });

    expect(respuesta.statusCode).toBe(404);
    expect(m2.llamadas).toBe(0);
  });

  it('una acción sin el Origin propio no llega a M2 (RNF-12.8)', async () => {
    const respuesta = await panel().inject({ method: 'POST', url: '/api/v1/clientes', headers: { ...DESDE_EL_PANEL, ...COMO_CLIENTE } });

    expect(respuesta.statusCode).toBe(403);
    expect(m2.llamadas).toBe(0);
  });
});

// Por un socket real y no con inject: inject arma la URL con `new URL`, que decodifica `%2e` y resuelve los `..` antes de que
// lleguen al panel, y la prueba no vería lo que manda un cliente que no normaliza (curl --path-as-is, un script).
describe('rutas peligrosas tal como las manda un cliente, sin normalizar (RNF-12.8)', () => {
  async function pedirCrudo(ruta: string) {
    const app = panel();
    const puerto = await escuchar(app);
    const cruda = await porSocket(
      puerto,
      `GET ${ruta} HTTP/1.1\r\nHost: 127.0.0.1:${PUERTO_PANEL}\r\nX-Panel-Rol: CLIENTE\r\nX-Panel-Sub: ${SUB}\r\nConnection: close\r\n\r\n`,
    );
    return leerRespuesta(cruda);
  }

  it.each([
    '/api/v1/clientes/../../admin',
    '/api/v1/clientes/../../health',
    '/api/v1/clientes/%2e%2e/%2e%2e/admin',
    '/api/v1/clientes/%2E%2E/x',
    '/api/v1/clientes/%2e/x',
    '/api/v1/clientes/./x',
    `/api/v1/clientes/${ID}%2f..%2fx`,
    '/api/v1/clientes/a%5c..%5cx',
    '/api/v1/clientes/a\\..\\x',
    '/api/v1/clientes//x',
    '/api/v1/clientes/a@evil.test',
    '/health?x=1',
  ])('%s no llega a M2', async (ruta) => {
    const { estado, encabezados } = await pedirCrudo(ruta);

    expect(estado).toMatch(/^HTTP\/1\.1 40[04] /);
    expect(encabezados['content-type']).toMatch(/^application\/problem\+json/);
    expect(m2.llamadas).toBe(0);
  });

  it('una ruta de clientes mal formada da 400 con el type del panel', async () => {
    const { estado, resto } = await pedirCrudo('/api/v1/clientes/%2e%2e/x');

    expect(estado).toMatch(/^HTTP\/1\.1 400 /);
    expect(JSON.parse(resto)).toMatchObject({ type: '/panel/errores/ruta-no-permitida', status: 400 });
  });
});

describe('el pedido que sale hacia M2 (RNF-12.6, RNF-14.9)', () => {
  it('lleva un Authorization firmado por el panel que M2 acepta, con el rol y el sub pedidos', async () => {
    await panel().inject({ method: 'GET', url: `/api/v1/clientes/${ID}`, headers: { ...DESDE_EL_PANEL, 'x-panel-rol': 'OPERADOR', 'x-panel-sub': 'operador-1' } });

    const autorizacion = m2.encabezadosRecibidos.get('authorization');
    expect(await verificarToken(autorizacion, CONFIG_PANEL)).toEqual({ sub: 'operador-1', roles: ['OPERADOR'] });
  });

  it('cada pedido lleva su propio token', async () => {
    const app = panel();
    await app.inject({ method: 'GET', url: '/api/v1/clientes', headers: { ...DESDE_EL_PANEL, ...COMO_CLIENTE } });
    await app.inject({ method: 'GET', url: '/api/v1/clientes', headers: { ...DESDE_EL_PANEL, 'x-panel-rol': 'SERVICIO', 'x-panel-sub': 'm9-reservas' } });

    const [primero, segundo] = m2.autorizaciones;
    expect(primero).not.toBe(segundo);
    expect((await verificarToken(segundo, CONFIG_PANEL)).roles).toEqual(['SERVICIO']);
  });

  it('descarta el Authorization que mande el navegador y pone el suyo', async () => {
    await panel().inject({
      method: 'GET',
      url: '/api/v1/clientes',
      headers: { ...DESDE_EL_PANEL, ...COMO_CLIENTE, authorization: 'Bearer token-que-trajo-el-navegador' },
    });

    expect(m2.encabezadosRecibidos.get('authorization')).not.toContain('token-que-trajo-el-navegador');
    expect((await verificarToken(m2.encabezadosRecibidos.get('authorization'), CONFIG_PANEL)).sub).toBe(SUB);
  });

  it('sin identidad tampoco pasa el Authorization del navegador', async () => {
    await panel().inject({ method: 'GET', url: '/api/v1/clientes', headers: { ...DESDE_EL_PANEL, authorization: 'Bearer ajeno' } });

    expect(m2.encabezadosRecibidos.has('authorization')).toBe(false);
  });

  it('lleva el cuerpo byte por byte, Idempotency-Key, Content-Type, Accept y el X-Request-Id recibido', async () => {
    const cuerpo = '{"puntaje": 5,  "comentario":"Muy bien ñandú"}';

    await panel().inject({
      method: 'POST',
      url: `/api/v1/clientes/${ID}/calificaciones`,
      headers: {
        ...DESDE_EL_PANEL_CON_ORIGEN,
        ...COMO_CLIENTE,
        'content-type': 'application/json',
        accept: 'application/json',
        'idempotency-key': 'clave-1234',
        'x-request-id': 'pedido-del-panel-1',
      },
      payload: cuerpo,
    });

    expect(m2.cuerpoRecibido.toString('utf8')).toBe(cuerpo);
    expect(m2.encabezadosRecibidos.get('content-type')).toBe('application/json');
    expect(m2.encabezadosRecibidos.get('accept')).toBe('application/json');
    expect(m2.encabezadosRecibidos.get('idempotency-key')).toBe('clave-1234');
    expect(m2.encabezadosRecibidos.get('x-request-id')).toBe('pedido-del-panel-1');
  });

  it('un cuerpo que no es JSON también pasa tal cual: lo juzga M2', async () => {
    await panel().inject({
      method: 'POST',
      url: '/api/v1/clientes',
      headers: { ...DESDE_EL_PANEL_CON_ORIGEN, ...COMO_CLIENTE, 'content-type': 'text/plain' },
      payload: '{roto',
    });

    expect(m2.cuerpoRecibido.toString('utf8')).toBe('{roto');
    expect(m2.encabezadosRecibidos.get('content-type')).toBe('text/plain');
  });

  it('sin X-Request-Id, manda uno panel-… y es el mismo que vuelve en la respuesta', async () => {
    const respuesta = await panel().inject({ method: 'GET', url: '/api/v1/clientes', headers: { ...DESDE_EL_PANEL, ...COMO_CLIENTE } });

    expect(m2.encabezadosRecibidos.get('x-request-id')).toMatch(/^panel-[0-9a-f-]{36}$/);
    expect(respuesta.headers['x-request-id']).toBe(m2.encabezadosRecibidos.get('x-request-id'));
  });

  it('no reenvía los demás encabezados del navegador', async () => {
    await panel().inject({
      method: 'POST',
      url: '/api/v1/clientes',
      headers: { ...DESDE_EL_PANEL_CON_ORIGEN, ...COMO_CLIENTE, cookie: 'sesion=abc', 'x-otro': '1', 'content-type': 'application/json' },
      payload: '{}',
    });

    const recibidos = [...m2.encabezadosRecibidos.keys()];
    for (const nombre of ['cookie', 'origin', 'x-otro', 'x-panel-rol', 'x-panel-sub']) expect(recibidos, nombre).not.toContain(nombre);
    expect(m2.encabezadosRecibidos.get('host')).toBe(new URL(m2.url).host);
  });

  it('un cuerpo de 1 MiB pasa y uno de más se rechaza con 413 sin llamar a M2', async () => {
    const app = panel();
    const headers = { ...DESDE_EL_PANEL_CON_ORIGEN, ...COMO_CLIENTE, 'content-type': 'application/json' };

    await app.inject({ method: 'POST', url: '/api/v1/clientes', headers, payload: 'x'.repeat(1024 * 1024) });
    expect(m2.cuerpoRecibido.length).toBe(1024 * 1024);

    m2.responderCon({ tipo: 'ok' });
    const grande = await app.inject({ method: 'POST', url: '/api/v1/clientes', headers, payload: 'x'.repeat(1024 * 1024 + 1) });
    expect(grande.statusCode).toBe(413);
    expect(grande.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(m2.llamadas).toBe(0);
  });
});

describe('identidad de prueba inválida (RNF-12.6)', () => {
  it.each([
    ['un rol desconocido', { 'x-panel-rol': 'ADMIN', 'x-panel-sub': SUB }],
    ['un rol sin sub', { 'x-panel-rol': 'CLIENTE' }],
    ['un sub sin rol', { 'x-panel-sub': SUB }],
    ['un sub de 129 caracteres', { 'x-panel-rol': 'CLIENTE', 'x-panel-sub': 'x'.repeat(129) }],
  ])('%s da 400 sin llamar a M2', async (_caso, identidad) => {
    const respuesta = await panel().inject({ method: 'GET', url: '/api/v1/clientes', headers: { ...DESDE_EL_PANEL, ...identidad } });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json()).toMatchObject({ type: '/panel/errores/identidad-invalida', status: 400 });
    expect(respuesta.body).not.toContain('ADMIN');
    expect(m2.llamadas).toBe(0);
  });
});

describe('la respuesta de M2 vuelve tal cual (RNF-03.6)', () => {
  it('un problem+json vuelve intacto, con su código y Retry-After', async () => {
    const cuerpo = { type: '/errores/modulo-no-disponible', title: 'M6 no disponible', status: 503, detail: 'Reintentar en 5 s' };
    m2.responderCon({ tipo: 'ok', estado: 503, cuerpo, encabezados: { 'Content-Type': PROBLEMA, 'Retry-After': '5' } });

    const respuesta = await panel().inject({ method: 'GET', url: `/api/v1/clientes/${ID}/viajes`, headers: { ...DESDE_EL_PANEL, ...COMO_CLIENTE } });

    expect(respuesta.statusCode).toBe(503);
    expect(respuesta.headers['content-type']).toBe(PROBLEMA);
    expect(respuesta.headers['retry-after']).toBe('5');
    expect(respuesta.body).toBe(JSON.stringify(cuerpo));
  });

  it.each([400, 401, 403, 404, 409, 415, 422, 500])('un %i de M2 vuelve con su código y su cuerpo', async (estado) => {
    const cuerpo = { type: `/errores/caso-${estado}`, title: 'Algo', status: estado, detail: 'detalle de M2' };
    m2.responderCon({ tipo: 'ok', estado, cuerpo, encabezados: { 'Content-Type': PROBLEMA } });

    const respuesta = await panel().inject({ method: 'GET', url: '/api/v1/clientes', headers: { ...DESDE_EL_PANEL, ...COMO_CLIENTE } });

    expect(respuesta.statusCode).toBe(estado);
    expect(respuesta.headers['content-type']).toBe(PROBLEMA);
    expect(respuesta.body).toBe(JSON.stringify(cuerpo));
  });

  it('un 201 vuelve con su Location', async () => {
    m2.responderCon({ tipo: 'ok', estado: 201, cuerpo: { clienteId: ID }, encabezados: { Location: `/api/v1/clientes/${ID}` } });

    const respuesta = await panel().inject({
      method: 'POST',
      url: '/api/v1/clientes',
      headers: { ...DESDE_EL_PANEL_CON_ORIGEN, ...COMO_CLIENTE, 'content-type': 'application/json' },
      payload: '{}',
    });

    expect(respuesta.statusCode).toBe(201);
    expect(respuesta.headers['location']).toBe(`/api/v1/clientes/${ID}`);
    expect(respuesta.json()).toEqual({ clienteId: ID });
  });

  it('un 405 vuelve con su Allow', async () => {
    m2.responderCon({ tipo: 'ok', estado: 405, cuerpo: { status: 405 }, encabezados: { 'Content-Type': PROBLEMA, Allow: 'GET, PATCH' } });

    const respuesta = await panel().inject({ method: 'GET', url: '/api/v1/clientes', headers: { ...DESDE_EL_PANEL, ...COMO_CLIENTE } });

    expect(respuesta.headers['allow']).toBe('GET, PATCH');
  });

  it('no deja pasar otros encabezados de M2', async () => {
    m2.responderCon({ tipo: 'ok', encabezados: { 'Set-Cookie': 'x=1', 'Access-Control-Allow-Origin': '*', 'X-Interno': 'si' } });

    const respuesta = await panel().inject({ method: 'GET', url: '/api/v1/clientes', headers: { ...DESDE_EL_PANEL, ...COMO_CLIENTE } });

    expect(respuesta.headers['set-cookie']).toBeUndefined();
    expect(respuesta.headers['access-control-allow-origin']).toBeUndefined();
    expect(respuesta.headers['x-interno']).toBeUndefined();
  });

  it('una redirección de M2 no se sigue: vuelve como está', async () => {
    m2.responderCon({ tipo: 'ok', estado: 302, cuerpo: {}, encabezados: { Location: 'http://evil.test/' } });

    const respuesta = await panel().inject({ method: 'GET', url: '/api/v1/clientes', headers: { ...DESDE_EL_PANEL, ...COMO_CLIENTE } });

    expect(respuesta.statusCode).toBe(302);
    expect(m2.llamadas).toBe(1);
  });

  it('el navegador no recibe la clave ni el token firmado (RNF-19.3)', async () => {
    const respuesta = await panel().inject({ method: 'GET', url: '/api/v1/clientes', headers: { ...DESDE_EL_PANEL, ...COMO_CLIENTE } });

    const token = (m2.encabezadosRecibidos.get('authorization') ?? '').replace('Bearer ', '');
    const todo = JSON.stringify(respuesta.headers) + respuesta.body;
    expect(token.length).toBeGreaterThan(20);
    expect(todo).not.toContain(token);
    expect(todo).not.toContain(CONFIG_PANEL.claveTokens);
  });
});

describe('M2 no responde (RNF-15.4)', () => {
  it('la espera por defecto es de 10 segundos', () => {
    expect(ESPERA_M2_MS).toBe(10_000);
  });

  it('si M2 no contesta a tiempo, 504 con el type del panel', async () => {
    m2.responderCon({ tipo: 'cuelga' });
    const inicio = Date.now();

    const respuesta = await panel({ esperaM2Ms: 200 }).inject({ method: 'GET', url: '/api/v1/clientes', headers: { ...DESDE_EL_PANEL, ...COMO_CLIENTE } });

    expect(respuesta.statusCode).toBe(504);
    expect(respuesta.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(respuesta.json()).toMatchObject({ type: '/panel/errores/m2-no-responde', title: 'M2 no responde', status: 504 });
    expect(Date.now() - inicio).toBeLessThan(2000);
  });

  it('si M2 manda los encabezados pero el cuerpo no llega a tiempo, también 504', async () => {
    m2.responderCon({ tipo: 'demora-cuerpo', retardoMs: 1000 });

    const respuesta = await panel({ esperaM2Ms: 200 }).inject({ method: 'GET', url: '/api/v1/clientes', headers: { ...DESDE_EL_PANEL, ...COMO_CLIENTE } });

    expect(respuesta.statusCode).toBe(504);
  });

  it('si M2 corta la conexión, 504', async () => {
    m2.responderCon({ tipo: 'corta' });

    const respuesta = await panel().inject({ method: 'GET', url: '/api/v1/clientes', headers: { ...DESDE_EL_PANEL, ...COMO_CLIENTE } });

    expect(respuesta.statusCode).toBe(504);
  });

  it('si la conexión se rechaza, 504, y queda en el log sin el token', async () => {
    const logs = capturarLogs();
    const app = crearAppPanel({ config: { urlM2: `http://127.0.0.1:${await puertoCerrado()}` }, flujoLog: logs.flujo });
    abiertas.push(app);

    const respuesta = await app.inject({ method: 'GET', url: '/api/v1/clientes', headers: { ...DESDE_EL_PANEL, ...COMO_CLIENTE } });

    expect(respuesta.statusCode).toBe(504);
    expect(respuesta.json()).toMatchObject({ type: '/panel/errores/m2-no-responde' });
    const aviso = logs.lineas().find((linea) => linea.msg === 'M2 no responde');
    expect(aviso).toBeDefined();
    expect(logs.texto()).not.toMatch(/Bearer|eyJ/);
  });
});

describe('logs del reenvío (RNF-19.3)', () => {
  it('la ruta del log es la plantilla, sin el id del cliente ni la query', async () => {
    const logs = capturarLogs();
    const app = crearAppPanel({ config: { urlM2: m2.url }, flujoLog: logs.flujo });
    abiertas.push(app);

    await app.inject({ method: 'GET', url: `/api/v1/clientes/${ID}/direcciones?limite=5`, headers: { ...DESDE_EL_PANEL, ...COMO_CLIENTE } });

    expect(logs.texto()).not.toContain(ID);
    expect(logs.lineas().at(-1)).toMatchObject({ metodo: 'GET', ruta: '/api/v1/clientes/*', estado: 200 });
  });
});
