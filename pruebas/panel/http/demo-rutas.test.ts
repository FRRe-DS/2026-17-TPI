import { afterEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import type { ConfigPanel } from '../../../panel/servidor/config.js';
import { crearBaseDemo } from '../../../panel/servidor/demo/base.js';
import { ComandoDockerFallido, DockerNoDisponible } from '../../../panel/servidor/demo/docker.js';
import { puertoLibre } from '../../ayudas/arranque.js';
import { capturarLogs } from '../../ayudas/logs.js';
import { CONFIG_PANEL, crearAppPanel, DESDE_EL_PANEL, DESDE_EL_PANEL_CON_ORIGEN } from '../ayudas/app.js';
import { m2YControl } from '../ayudas/m2-y-control.js';

// Las rutas /panel/demo/… del servidor del panel (spec 072, T8), con la base, Docker y M2 de mentira (RNF-12.10, RNF-13.4,
// RNF-13.6, RNF-19.4, RNF-05.4).
const CONTRASENA = 'contrasena-secreta-de-prueba';

type Panel = ReturnType<typeof crearAppPanel>;
const abiertos: { close?: () => Promise<unknown>; cerrar?: () => Promise<unknown> }[] = [];
afterEach(async () => {
  for (const abierto of abiertos.splice(0)) await (abierto.close ?? abierto.cerrar)?.call(abierto);
});

// Una base de mentira que anota qué se le pidió, y un pool cuya inserción falla como la restricción.
function baseDeMentira(cambios: Record<string, unknown> = {}) {
  const base = {
    pool: {
      connect: async () => ({
        query: async (sql: string) => {
          if (sql.startsWith('INSERT')) {
            throw Object.assign(new pg.DatabaseError('new row violates check constraint "calificaciones_puntaje_valido"', 0, 'error'), {
              code: '23514',
              constraint: 'calificaciones_puntaje_valido',
            });
          }
          return { rows: [] };
        },
        release: () => {},
      }),
    },
    contarClientes: vi.fn(async () => ({ filas: 1 })),
    contarCalificaciones: vi.fn(async () => ({ filas: 1 })),
    disponibilidad: vi.fn(async () => ({ disponible: true })),
    ...cambios,
  };
  return base;
}

function dockerDeMentira(cambios: Record<string, unknown> = {}) {
  return {
    disponibilidad: vi.fn(async () => ({ disponible: true })),
    apagar: vi.fn(async () => undefined),
    encender: vi.fn(async () => undefined),
    ...cambios,
  };
}

async function levantar(
  opciones: { base?: ReturnType<typeof baseDeMentira>; docker?: ReturnType<typeof dockerDeMentira>; modo?: string; config?: Partial<ConfigPanel>; flujoLog?: Parameters<typeof crearAppPanel>[0] extends infer O ? (O extends { flujoLog?: infer F } ? F : never) : never; esperaSaludMs?: number } = {},
) {
  const m2 = m2YControl(opciones.modo ?? 'normal');
  abiertos.push(m2);
  const url = await m2.levantar();
  const base = opciones.base ?? baseDeMentira();
  const docker = opciones.docker ?? dockerDeMentira();
  const app: Panel = crearAppPanel({
    config: { urlM2: url, urlM6Control: url, ...opciones.config },
    demo: { base: base as never, docker: docker as never, esperaSaludMs: opciones.esperaSaludMs },
    flujoLog: opciones.flujoLog,
  });
  abiertos.push(app);
  return { app, m2, base, docker };
}

const get = (app: Panel, url: string, headers: Record<string, string> = DESDE_EL_PANEL) => app.inject({ method: 'GET', url, headers });
const post = (app: Panel, url: string, payload: unknown = {}, headers: Record<string, string> = DESDE_EL_PANEL_CON_ORIGEN) =>
  app.inject({ method: 'POST', url, headers, payload: payload as never });

describe('GET /panel/demo/estado (RNF-13.6, RNF-05.4)', () => {
  it('informa la disponibilidad de la base y de Docker, con su motivo y cómo activarlos', async () => {
    const { app } = await levantar({
      base: baseDeMentira({ disponibilidad: vi.fn(async () => ({ disponible: false, motivo: 'no configurada (PANEL_URL_BD)', comoActivar: 'Definí PANEL_URL_BD' })) }),
      docker: dockerDeMentira({ disponibilidad: vi.fn(async () => ({ disponible: false, motivo: 'el panel corre en un contenedor', comoActivar: 'npm run panel' })) }),
    });

    const respuesta = await get(app, '/panel/demo/estado');

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({
      base: { disponible: false, motivo: 'no configurada (PANEL_URL_BD)', comoActivar: 'Definí PANEL_URL_BD' },
      docker: { disponible: false, motivo: 'el panel corre en un contenedor', comoActivar: 'npm run panel' },
    });
  });

  it('con las dos disponibles, solo dice que lo están', async () => {
    const { app } = await levantar();

    expect((await get(app, '/panel/demo/estado')).json()).toEqual({ base: { disponible: true }, docker: { disponible: true } });
  });
});

describe('POST /panel/demo/altas-simultaneas (RNF-08.2, RNF-08.3)', () => {
  it('lanza las altas y responde el ResultadoSimultaneo', async () => {
    const { app, m2 } = await levantar();

    const respuesta = await post(app, '/panel/demo/altas-simultaneas', { n: 4, modo: 'misma-clave' });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toMatchObject({ n: 4, porCodigo: { 201: 4 }, cuerposIguales: true, filas: 1, cumple: true });
    expect(m2.pedidos.filter((p) => p === 'POST /api/v1/clientes')).toHaveLength(4);
  });

  it.each([
    ['N = 1', { n: 1, modo: 'misma-clave' }],
    ['N = 51', { n: 51, modo: 'misma-clave' }],
    ['N con decimales', { n: 2.5, modo: 'misma-clave' }],
    ['N como texto', { n: '10', modo: 'misma-clave' }],
    ['otro modo', { n: 10, modo: 'todos-distintos' }],
    ['sin modo', { n: 10 }],
    ['sin n', { modo: 'misma-clave' }],
    ['campos de más', { n: 10, modo: 'misma-clave', clienteId: 'x' }],
  ])('rechaza con 400 un cuerpo con %s, sin lanzar ningún pedido', async (_caso, cuerpo) => {
    const { app, m2 } = await levantar();

    const respuesta = await post(app, '/panel/demo/altas-simultaneas', cuerpo);

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.headers['content-type']).toContain('application/problem+json');
    expect(respuesta.json()).toMatchObject({ type: '/panel/errores/pedido-invalido', status: 400 });
    expect(m2.pedidos).toEqual([]);
  });

  it.each([2, 50])('acepta N = %i', async (n) => {
    const { app } = await levantar();

    expect((await post(app, '/panel/demo/altas-simultaneas', { n, modo: 'claves-distintas' })).statusCode).toBe(200);
  });
});

describe('POST /panel/demo/calificaciones-simultaneas (RNF-08.4)', () => {
  it('prepara la prueba y responde el ResultadoSimultaneo', async () => {
    const { app } = await levantar();

    const respuesta = await post(app, '/panel/demo/calificaciones-simultaneas', { n: 5 });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toMatchObject({ n: 5, porCodigo: { 201: 1, 409: 4 }, filas: 1, cumple: true });
  });

  it.each([{ n: 1 }, { n: 51 }, { n: 10, modo: 'misma-clave' }, {}])('rechaza con 400 el cuerpo %j', async (cuerpo) => {
    const { app, m2 } = await levantar();

    expect((await post(app, '/panel/demo/calificaciones-simultaneas', cuerpo)).statusCode).toBe(400);
    expect(m2.pedidos).toEqual([]);
  });

  it('si no se puede preparar, responde 502 problem+json con el paso, sin la dirección', async () => {
    const { app } = await levantar({ config: { urlM6Control: 'http://127.0.0.1:9' } });

    const respuesta = await post(app, '/panel/demo/calificaciones-simultaneas', { n: 3 });

    expect(respuesta.statusCode).toBe(502);
    expect(respuesta.headers['content-type']).toContain('application/problem+json');
    expect(respuesta.json()).toMatchObject({ type: '/panel/errores/preparacion-fallida', status: 502 });
    expect(respuesta.json().detail).toContain('canal de control');
    expect(respuesta.body).not.toContain('127.0.0.1:9');
  });
});

describe('POST /panel/demo/restriccion-puntaje (RNF-05.5)', () => {
  it('crea un cliente por M2, prueba la restricción y responde el ResultadoRestriccion', async () => {
    const { app, m2 } = await levantar();

    const respuesta = await post(app, '/panel/demo/restriccion-puntaje');

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toMatchObject({ restriccion: 'calificaciones_puntaje_valido', codigo: '23514', filasAntes: 1, filasDespues: 1, cumple: true });
    expect(m2.pedidos).toEqual(['POST /api/v1/clientes']);
  });

  it('rechaza con 400 un cuerpo con campos', async () => {
    const { app } = await levantar();

    expect((await post(app, '/panel/demo/restriccion-puntaje', { puntaje: 9 })).statusCode).toBe(400);
  });

  it('si no se puede crear el cliente, responde 502 y no toca la base', async () => {
    const base = baseDeMentira();
    const { app } = await levantar({ base, config: { urlM2: 'http://127.0.0.1:9' } });

    const respuesta = await post(app, '/panel/demo/restriccion-puntaje');

    expect(respuesta.statusCode).toBe(502);
    expect(base.contarCalificaciones).not.toHaveBeenCalled();
  });
});

describe('POST /panel/demo/base/apagar y encender (RNF-13.4, RNF-13.6)', () => {
  it.each([['apagar'], ['encender']] as const)('%s ejecuta el comando una vez y responde ejecutado', async (accion) => {
    const { app, docker } = await levantar();

    const respuesta = await post(app, `/panel/demo/base/${accion}`);

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({ ejecutado: true });
    expect(docker[accion]).toHaveBeenCalledTimes(1);
  });

  it.each([['apagar'], ['encender']] as const)('sin Docker, %s responde 409 docker-no-disponible con el motivo', async (accion) => {
    const disponibilidad = { disponible: false, motivo: 'el panel corre en un contenedor y no tiene acceso a Docker', comoActivar: 'npm run panel' };
    const docker = dockerDeMentira({ [accion]: vi.fn(async () => { throw new DockerNoDisponible(disponibilidad); }) });
    const { app } = await levantar({ docker });

    const respuesta = await post(app, `/panel/demo/base/${accion}`);

    expect(respuesta.statusCode).toBe(409);
    expect(respuesta.headers['content-type']).toContain('application/problem+json');
    expect(respuesta.json()).toMatchObject({ type: '/panel/errores/docker-no-disponible', status: 409 });
    expect(respuesta.json().detail).toContain('el panel corre en un contenedor');
  });

  it('si el comando falla, responde 502 docker-fallo con el error', async () => {
    const docker = dockerDeMentira({ apagar: vi.fn(async () => { throw new ComandoDockerFallido('docker compose no respondió en 30 s'); }) });
    const { app } = await levantar({ docker });

    const respuesta = await post(app, '/panel/demo/base/apagar');

    expect(respuesta.statusCode).toBe(502);
    expect(respuesta.json()).toMatchObject({ type: '/panel/errores/docker-fallo', detail: 'docker compose no respondió en 30 s' });
  });

  it('rechaza con 400 un cuerpo con campos, sin ejecutar nada', async () => {
    const { app, docker } = await levantar();

    expect((await post(app, '/panel/demo/base/apagar', { servicio: 'm2' })).statusCode).toBe(400);
    expect(docker.apagar).not.toHaveBeenCalled();
  });
});

describe('GET /panel/demo/salud (RNF-13.4)', () => {
  it('pide /health a M2 y responde el código y la duración', async () => {
    const { app, m2 } = await levantar();

    const respuesta = await get(app, '/panel/demo/salud');

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({ estado: 200, duracionMs: expect.any(Number) });
    expect(m2.pedidos).toEqual(['GET /health']);
  });

  it('si M2 no contesta en el corte, estado null', async () => {
    const puerto = await puertoLibre();
    const { app } = await levantar({ config: { urlM2: `http://127.0.0.1:${puerto}` } });

    const respuesta = await get(app, '/panel/demo/salud');

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({ estado: null, duracionMs: expect.any(Number) });
  });

  it('no queda en el detalle técnico: un sondeo cada 2 s lo llenaría', async () => {
    const { app } = await levantar();

    await get(app, '/panel/demo/salud');
    await get(app, '/panel/demo/salud');

    expect((await get(app, '/panel/pedidos')).json()).toEqual({ pedidos: [] });
  });
});

describe('seguridad de las rutas nuevas (RNF-12.10)', () => {
  const rutas = [
    ['GET', '/panel/demo/estado'],
    ['GET', '/panel/demo/salud'],
    ['POST', '/panel/demo/altas-simultaneas'],
    ['POST', '/panel/demo/calificaciones-simultaneas'],
    ['POST', '/panel/demo/restriccion-puntaje'],
    ['POST', '/panel/demo/base/apagar'],
    ['POST', '/panel/demo/base/encender'],
  ] as const;
  const CUERPOS: Record<string, unknown> = {
    '/panel/demo/altas-simultaneas': { n: 3, modo: 'misma-clave' },
    '/panel/demo/calificaciones-simultaneas': { n: 3 },
  };

  it.each(rutas)('%s %s con un Host ajeno da 403 y no ejecuta nada', async (metodo, ruta) => {
    const { app, m2, base, docker } = await levantar();

    const respuesta = await app.inject({ method: metodo, url: ruta, headers: { host: 'evil.test' }, payload: (CUERPOS[ruta] ?? {}) as never });

    expect(respuesta.statusCode).toBe(403);
    expect(m2.pedidos).toEqual([]);
    expect(base.disponibilidad).not.toHaveBeenCalled();
    expect(base.contarClientes).not.toHaveBeenCalled();
    expect(docker.disponibilidad).not.toHaveBeenCalled();
    expect(docker.apagar).not.toHaveBeenCalled();
  });

  it.each(rutas.filter(([metodo]) => metodo === 'POST'))('POST %s con un Origin ajeno, o sin Origin, da 403 y no ejecuta nada', async (_metodo, ruta) => {
    const { app, m2, docker } = await levantar();

    for (const headers of [{ ...DESDE_EL_PANEL, origin: 'http://evil.test' }, DESDE_EL_PANEL]) {
      const respuesta = await app.inject({ method: 'POST', url: ruta, headers, payload: (CUERPOS[ruta] ?? {}) as never });
      expect(respuesta.statusCode).toBe(403);
    }
    expect(m2.pedidos).toEqual([]);
    expect(docker.apagar).not.toHaveBeenCalled();
    expect(docker.encender).not.toHaveBeenCalled();
  });
});

describe('la URL y la contraseña de la base no salen (RNF-19.4)', () => {
  it('ni en las respuestas ni en el log, aunque la base no responda', async () => {
    const puertoBd = await puertoLibre();
    const urlBd = `postgres://m2:${CONTRASENA}@127.0.0.1:${puertoBd}/m2`;
    const base = crearBaseDemo(urlBd);
    abiertos.push(base);
    const registro = capturarLogs();
    const { app } = await levantar({ base: base as never, config: { urlBd }, flujoLog: registro.flujo });

    const respuestas = [
      await get(app, '/panel/demo/estado'),
      await post(app, '/panel/demo/altas-simultaneas', { n: 2, modo: 'misma-clave' }),
      await post(app, '/panel/demo/calificaciones-simultaneas', { n: 2 }),
      await post(app, '/panel/demo/restriccion-puntaje'),
    ];

    expect(respuestas[0]?.json().base).toMatchObject({ disponible: false });
    expect(respuestas[1]?.json()).toMatchObject({ filas: null, cumple: false });
    for (const texto of [...respuestas.map((r) => r.body), registro.texto()]) {
      expect(texto).not.toContain(CONTRASENA);
      expect(texto).not.toContain(`:${puertoBd}`);
      expect(texto).not.toContain('postgres://');
    }
  });
});

describe('por defecto, sin demo inyectada', () => {
  it('toma la base y Docker de la configuración: sin PANEL_URL_BD y con PANEL_DOCKER=no, ninguno está disponible', async () => {
    const app = crearAppPanel({ config: { urlBd: undefined, docker: false } });
    abiertos.push(app);

    const respuesta = await get(app, '/panel/demo/estado');

    expect(respuesta.json()).toMatchObject({
      base: { disponible: false, motivo: expect.stringContaining('PANEL_URL_BD') },
      docker: { disponible: false, motivo: expect.stringContaining('contenedor') },
    });
    expect((await post(app, '/panel/demo/base/apagar')).statusCode).toBe(409);
  });
});

void CONFIG_PANEL;
