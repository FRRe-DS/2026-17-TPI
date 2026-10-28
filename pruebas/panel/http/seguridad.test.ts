import { afterEach, describe, expect, it, vi } from 'vitest';
import { capturarLogs } from '../../ayudas/logs.js';
import { CONFIG_PANEL, crearAppPanel, DESDE_EL_PANEL, DESDE_EL_PANEL_CON_ORIGEN, PUERTO_PANEL } from '../ayudas/app.js';

type Panel = ReturnType<typeof crearAppPanel>;

const abiertas: Panel[] = [];
function crear(...argumentos: Parameters<typeof crearAppPanel>): Panel {
  const app = crearAppPanel(...argumentos);
  abiertas.push(app);
  return app;
}
afterEach(async () => {
  await Promise.all(abiertas.splice(0).map((app) => app.close()));
});

// Una ruta de mentira que cuenta cuántas veces llegó a ejecutarse: lo que el panel rechaza no la toca (RNF-12.8).
function conRutaQueCuenta(app: Panel) {
  const ejecutada = vi.fn(async () => ({ hecho: true }));
  app.route({ method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], url: '/probar', handler: ejecutada });
  return ejecutada;
}

describe('Host: el panel solo es accesible desde la propia máquina (RNF-12.8)', () => {
  it.each([`localhost:${PUERTO_PANEL}`, `127.0.0.1:${PUERTO_PANEL}`, `[::1]:${PUERTO_PANEL}`, `LOCALHOST:${PUERTO_PANEL}`])(
    'deja pasar %s',
    async (host) => {
      const respuesta = await crear().inject({ method: 'GET', url: '/salud-panel', headers: { host } });

      expect(respuesta.statusCode).toBe(200);
    },
  );

  it.each([
    'evil.test',
    `evil.test:${PUERTO_PANEL}`,
    `127.0.0.1.evil.test:${PUERTO_PANEL}`,
    `localhost.evil.test:${PUERTO_PANEL}`,
    'localhost:9999',
    'localhost',
    `0.0.0.0:${PUERTO_PANEL}`,
    `192.168.1.10:${PUERTO_PANEL}`,
    `localhost:${PUERTO_PANEL}@evil.test`,
  ])('rechaza con 403 problem+json un Host %j, también en una consulta', async (host) => {
    const app = crear();
    const ejecutada = conRutaQueCuenta(app);

    const respuesta = await app.inject({ method: 'GET', url: '/probar', headers: { host } });

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(respuesta.json()).toMatchObject({ type: '/panel/errores/host-no-permitido', status: 403 });
    expect(ejecutada).not.toHaveBeenCalled();
  });

  it('el puerto permitido es el configurado', async () => {
    const app = crear({ config: { puerto: 9090 } });

    expect((await app.inject({ method: 'GET', url: '/salud-panel', headers: { host: 'localhost:9090' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/salud-panel', headers: { host: `localhost:${PUERTO_PANEL}` } })).statusCode).toBe(403);
  });

  it('no repite el Host recibido en la respuesta', async () => {
    const respuesta = await crear().inject({ method: 'GET', url: '/salud-panel', headers: { host: 'sospechoso.evil.test' } });

    expect(respuesta.body).not.toContain('sospechoso');
  });

  it('rechaza también una ruta que no existe, antes de contestar 404', async () => {
    const respuesta = await crear().inject({ method: 'POST', url: '/no-existe', headers: { host: 'evil.test' } });

    expect(respuesta.statusCode).toBe(403);
  });
});

describe('Origin: una acción que no es una consulta tiene que venir del propio panel (RNF-12.8)', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)('%s sin Origin recibe 403 y no se ejecuta', async (method) => {
    const app = crear();
    const ejecutada = conRutaQueCuenta(app);

    const respuesta = await app.inject({ method, url: '/probar', headers: DESDE_EL_PANEL });

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(respuesta.json()).toMatchObject({ type: '/panel/errores/origen-no-permitido', status: 403 });
    expect(ejecutada).not.toHaveBeenCalled();
  });

  it.each([
    'http://evil.test',
    'https://127.0.0.1:8083',
    'http://localhost:8083',
    'http://127.0.0.1:9999',
    'http://127.0.0.1:8083.evil.test',
    'http://127.0.0.1',
    'null',
    '',
  ])('POST con Origin %j recibe 403 y no se ejecuta', async (origin) => {
    const app = crear();
    const ejecutada = conRutaQueCuenta(app);

    const respuesta = await app.inject({ method: 'POST', url: '/probar', headers: { ...DESDE_EL_PANEL, origin } });

    expect(respuesta.statusCode).toBe(403);
    expect(ejecutada).not.toHaveBeenCalled();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)('%s con el Origin propio se ejecuta', async (method) => {
    const app = crear();
    const ejecutada = conRutaQueCuenta(app);

    const respuesta = await app.inject({ method, url: '/probar', headers: DESDE_EL_PANEL_CON_ORIGEN });

    expect(respuesta.statusCode).toBe(200);
    expect(ejecutada).toHaveBeenCalledTimes(1);
  });

  it('el Origin propio es el del Host con que se pidió', async () => {
    const respuesta = await crear().inject({
      method: 'POST',
      url: '/probar-localhost',
      headers: { host: `localhost:${PUERTO_PANEL}`, origin: `http://localhost:${PUERTO_PANEL}` },
    });

    // La ruta no existe, así que el panel contesta 404: lo que importa es que no fue 403.
    expect(respuesta.statusCode).toBe(404);
  });

  it('una consulta (GET, HEAD, OPTIONS) no exige Origin ni se rechaza por tener uno ajeno', async () => {
    const app = crear();

    for (const method of ['GET', 'HEAD', 'OPTIONS'] as const) {
      const respuesta = await app.inject({ method, url: '/salud-panel', headers: { ...DESDE_EL_PANEL, origin: 'http://evil.test' } });
      expect(respuesta.statusCode, method).not.toBe(403);
    }
  });
});

describe('sin CORS (RNF-12.8)', () => {
  it('ninguna respuesta lleva cabeceras Access-Control-*, ni siquiera a una consulta previa', async () => {
    const app = crear();
    conRutaQueCuenta(app);
    const pedidos = [
      { method: 'GET', url: '/salud-panel', headers: { ...DESDE_EL_PANEL, origin: 'http://evil.test' } },
      { method: 'GET', url: '/no-existe', headers: DESDE_EL_PANEL },
      { method: 'POST', url: '/probar', headers: { ...DESDE_EL_PANEL, origin: 'http://evil.test' } },
      { method: 'POST', url: '/probar', headers: DESDE_EL_PANEL_CON_ORIGEN },
      { method: 'GET', url: '/salud-panel', headers: { host: 'evil.test', origin: 'http://evil.test' } },
      {
        method: 'OPTIONS',
        url: '/probar',
        headers: { ...DESDE_EL_PANEL, origin: 'http://evil.test', 'access-control-request-method': 'POST' },
      },
    ] as const;

    for (const pedido of pedidos) {
      const respuesta = await app.inject(pedido);
      const cabeceras = Object.keys(respuesta.headers).filter((nombre) => nombre.startsWith('access-control-'));
      expect(cabeceras, `${pedido.method} ${pedido.url}`).toEqual([]);
    }
  });
});

describe('GET /salud-panel', () => {
  it('responde 200 sin llamar a M2', async () => {
    const respuesta = await crear().inject({ method: 'GET', url: '/salud-panel', headers: DESDE_EL_PANEL });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({ estado: 'ok' });
  });
});

describe('logs: una línea JSON por pedido, sin token ni cuerpo (RNF-19.3)', () => {
  const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0b2tlbi1kZS1wcnVlYmEifQ.firma-secreta-del-token';
  const CUERPO = 'contrasena-dentro-del-cuerpo';

  it('cada pedido deja exactamente una línea JSON con método, ruta, código y duración', async () => {
    const logs = capturarLogs();
    const app = crear({ flujoLog: logs.flujo });
    conRutaQueCuenta(app);

    await app.inject({ method: 'GET', url: '/salud-panel', headers: DESDE_EL_PANEL });
    await app.inject({ method: 'POST', url: '/probar', headers: DESDE_EL_PANEL_CON_ORIGEN });
    await app.inject({ method: 'GET', url: '/no-existe', headers: DESDE_EL_PANEL });
    await app.inject({ method: 'GET', url: '/salud-panel', headers: { host: 'evil.test' } });

    const lineas = logs.lineas();
    expect(lineas.map((linea) => [linea['metodo'], linea['ruta'], linea['estado']])).toEqual([
      ['GET', '/salud-panel', 200],
      ['POST', '/probar', 200],
      ['GET', '/no-existe', 404],
      ['GET', '/salud-panel', 403],
    ]);
    for (const linea of lineas) {
      expect(typeof linea['duracionMs']).toBe('number');
      expect(linea.idCorrelacion).toEqual(expect.any(String));
    }
  });

  it('no escribe el Authorization, el cuerpo ni la query string', async () => {
    const logs = capturarLogs();
    const app = crear({ flujoLog: logs.flujo });
    conRutaQueCuenta(app);

    await app.inject({
      method: 'POST',
      url: '/probar?token=valor-en-la-query',
      headers: { ...DESDE_EL_PANEL_CON_ORIGEN, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      payload: { contrasena: CUERPO },
    });
    await app.inject({ method: 'POST', url: '/probar', headers: { ...DESDE_EL_PANEL, authorization: `Bearer ${TOKEN}` }, payload: CUERPO });

    const texto = logs.texto();
    expect(texto).not.toContain(TOKEN);
    expect(texto).not.toContain('firma-secreta');
    expect(texto).not.toContain(CUERPO);
    expect(texto).not.toContain('valor-en-la-query');
    expect(texto).not.toContain(CONFIG_PANEL.claveTokens);
  });

  it('el id del pedido es el X-Request-Id recibido, si es válido, y si no uno propio', async () => {
    const logs = capturarLogs();
    const app = crear({ flujoLog: logs.flujo });

    const conId = await app.inject({ method: 'GET', url: '/salud-panel', headers: { ...DESDE_EL_PANEL, 'x-request-id': 'mi-pedido-1' } });
    const sinId = await app.inject({ method: 'GET', url: '/salud-panel', headers: DESDE_EL_PANEL });
    const roto = await app.inject({ method: 'GET', url: '/salud-panel', headers: { ...DESDE_EL_PANEL, 'x-request-id': 'con espacios y\tmás' } });

    expect(conId.headers['x-request-id']).toBe('mi-pedido-1');
    expect(sinId.headers['x-request-id']).toMatch(/^panel-[0-9a-f-]{36}$/);
    expect(roto.headers['x-request-id']).toMatch(/^panel-[0-9a-f-]{36}$/);
    expect(logs.lineas().map((linea) => linea.idCorrelacion)).toEqual([
      'mi-pedido-1',
      sinId.headers['x-request-id'],
      roto.headers['x-request-id'],
    ]);
  });
});
