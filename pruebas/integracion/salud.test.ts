import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearPool, type PoolBd } from '../../src/bd/pool.js';
import { cargarContrato } from '../../src/contrato/cargar.js';
import type { Manejador } from '../../src/contrato/operaciones.js';
import { BaseNoDisponible } from '../../src/errores.js';
import { manejadores } from '../../src/operaciones/index.js';
import { contratoCon, contratoDePrueba, crearApp } from '../ayudas/app.js';
import { type BaseDePrueba, crearBaseDePrueba } from '../ayudas/bd.js';
import { capturarLogs } from '../ayudas/logs.js';
import { crearProxy, type ProxyDeBase } from '../ayudas/proxy.js';
import { AUTORIZADO, bearer } from '../ayudas/tokens.js';

const contratoDelRepositorio = cargarContrato();
const contratoSalud = cargarContrato(fileURLToPath(new URL('../ayudas/contrato-salud.yml', import.meta.url)));

const PROBLEMA_JSON = /^application\/problem\+json/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ahora = () => Math.floor(Date.now() / 1000);

// Cualquier cosa que venga en Authorization: GET /health la ignora (RNF-14.1).
const AUTORIZACIONES: [string, Record<string, string>][] = [
  ['sin token', {}],
  ['un token válido', AUTORIZADO],
  ['un token vencido', bearer({ claims: { exp: ahora() - 3600 } })],
  ['un token firmado con otra clave', bearer({ clave: 'otra-clave-que-el-servicio-no-conoce' })],
  ['un token sin roles conocidos', bearer({ claims: { roles: ['ADMIN'] } })],
  ['un valor que no es un token', { authorization: 'Bearer esto-no-es-un-token' }],
  ['otro esquema', { authorization: 'Basic dXN1YXJpbzpjbGF2ZQ==' }],
  ['un Authorization vacío', { authorization: '' }],
];

// Los contratos que declaran GET /health como verificarSalud: el del repositorio, que es el que lee el servicio, y el de
// prueba, con el que se arma la misma app. Los manejadores son los del servicio en los dos.
const CONTRATOS_CON_SALUD = [
  ['el contrato del repositorio', contratoDelRepositorio],
  ['el contrato de prueba', contratoDePrueba],
] as const;

describe('GET /health con la base arriba (RNF-14.1, RNF-03.4)', () => {
  let base: BaseDePrueba;
  let pool: PoolBd;

  beforeEach(async () => {
    base = await crearBaseDePrueba();
    pool = crearPool({ urlBd: base.urlBd, tiempoBdMs: 2000 });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await pool.end();
    await base.borrar();
  });

  describe.each(CONTRATOS_CON_SALUD)('con %s', (_contrato, contrato) => {
    const crear = () => crearApp(manejadores, { contrato, pool });
    const salud = (headers: Record<string, string> = {}) => crear().inject({ method: 'GET', url: '/health', headers });

    it('responde 200 con {"estado": "ok"} en JSON', async () => {
      const respuesta = await salud();

      expect(respuesta.statusCode).toBe(200);
      expect(respuesta.headers['content-type']).toMatch(/^application\/json/);
      expect(respuesta.json()).toEqual({ estado: 'ok' });
    });

    it('comprueba que la base responde, con una consulta', async () => {
      const consultar = vi.spyOn(pool, 'consultar');

      await salud();

      expect(consultar).toHaveBeenCalledOnce();
    });

    it.each(AUTORIZACIONES)('con %s: 200, porque ignora el token', async (_caso, headers) => {
      const respuesta = await salud(headers);

      expect(respuesta.statusCode).toBe(200);
      expect(respuesta.json()).toEqual({ estado: 'ok' });
    });

    it('trae el encabezado de correlación: el que llegó, o uno nuevo si es inválido', async () => {
      const propio = await salud({ 'x-request-id': 'mi-id.123' });
      const invalido = await salud({ 'x-request-id': 'con espacios y ñ' });

      expect(propio.headers['x-request-id']).toBe('mi-id.123');
      expect(invalido.statusCode).toBe(200);
      expect(invalido.headers['x-request-id']).toMatch(UUID_V4);
    });

    it('si la base no está disponible, responde 503 en problem+json', async () => {
      const sinBase = { consultar: async () => Promise.reject(new BaseNoDisponible()) };

      const respuesta = await crearApp(manejadores, { contrato, pool: sinBase }).inject({ method: 'GET', url: '/health' });

      expect(respuesta.statusCode).toBe(503);
      expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
      expect(respuesta.json()).toEqual({
        type: 'about:blank',
        title: 'Servicio no disponible',
        status: 503,
        detail: 'La base de datos no está disponible',
        instance: '/health',
      });
    });

    it('si la consulta falla por otra razón, responde 500 sin detalles internos', async () => {
      const rota = { consultar: async () => Promise.reject(new Error('relation "secreta" does not exist')) };

      const respuesta = await crearApp(manejadores, { contrato, pool: rota }).inject({ method: 'GET', url: '/health' });

      expect(respuesta.statusCode).toBe(500);
      expect(respuesta.body).not.toContain('secreta');
    });

    // RNF-03.2, RNF-03.5: toda ruta que existe responde 405 con Allow a un método que no tiene, con o sin token.
    describe.each([
      ['sin token', {}],
      ['con token', AUTORIZADO],
    ])('un método que no tiene, %s', (_caso, headers) => {
      it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'TRACE', 'PROPFIND'])(
        '%s /health: 405 con Allow: GET',
        async (method) => {
          const respuesta = await crear().inject({ method: method as 'POST', url: '/health', headers });

          expect(respuesta.statusCode).toBe(405);
          expect(respuesta.headers.allow).toBe('GET');
          if (method !== 'HEAD') {
            expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
            expect(respuesta.json()).toMatchObject({ status: 405, title: 'Método no permitido', instance: '/health' });
          }
        },
      );
    });
  });
});

// GET /health sale solo del contrato (RNF-03.4, ADR de la base): la atiende el manejador de verificarSalud que le pasen, si el
// contrato la declara, y si no, no existe. Qué manejador la atiende se ve en lo que contesta.
describe('GET /health: sale solo del contrato (RNF-03.4, ADR de la base)', () => {
  const sano = { consultar: async () => ({}) as never };
  const propio: Manejador = async () => ({ estado: 'ok', atendidoPor: 'el manejador del contrato' });
  const pedir = (app: ReturnType<typeof crearApp>, method: 'GET' | 'POST' = 'GET') =>
    app.inject({ method, url: '/health' });

  it('con el contrato del repositorio, responde 200 sin token', async () => {
    const respuesta = await pedir(crearApp(manejadores, { contrato: contratoDelRepositorio, pool: sano }));

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({ estado: 'ok' });
  });

  it('con un contrato sin /health, da 404 en problem+json, aunque haya un manejador de verificarSalud', async () => {
    const contrato = contratoCon({
      '/otra': { get: { operationId: 'otra', security: [], responses: { '200': { description: 'Bien' } } } },
    });

    const respuesta = await pedir(crearApp({ ...manejadores, otra: propio }, { contrato, pool: sano }));

    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
    expect(respuesta.json()).toMatchObject({ status: 404, title: 'No encontrado', instance: '/health' });
  });

  it('con un contrato que no tiene paths, como uno con solo info, también da 404', async () => {
    const soloInfo = { openapi: '3.1.0', info: { title: 'Solo info', version: '0.0.0' } };

    const respuesta = await pedir(crearApp(manejadores, { contrato: soloInfo, pool: sano }));

    expect(respuesta.statusCode).toBe(404);
  });

  it('con /health en el contrato y un manejador de verificarSalud, la atiende ese manejador', async () => {
    const respuesta = await pedir(crearApp({ verificarSalud: propio }, { contrato: contratoSalud, pool: sano }));

    expect(respuesta.json()).toEqual({ estado: 'ok', atendidoPor: 'el manejador del contrato' });
  });

  it('con /health en el contrato bajo otro operationId que tiene manejador, también', async () => {
    const contrato = contratoCon({
      '/health': { get: { operationId: 'obtenerSalud', security: [], responses: { '200': { description: 'Bien' } } } },
    });

    const respuesta = await pedir(crearApp({ obtenerSalud: propio }, { contrato, pool: sano }));

    expect(respuesta.json()).toEqual({ estado: 'ok', atendidoPor: 'el manejador del contrato' });
  });

  it('con /health en el contrato y sin manejador, la operación queda pendiente: da 404', async () => {
    const respuesta = await pedir(crearApp({}, { contrato: contratoSalud, pool: sano }));

    expect(respuesta.statusCode).toBe(404);
  });

  // Lo que cuenta es el método y la ruta de la operación: otro método en /health no la crea.
  it('con otro método en /health en el contrato y sin GET, GET /health da 405 con Allow: POST', async () => {
    const contrato = contratoCon({
      '/health': { post: { operationId: 'otraCosa', security: [], responses: { '200': { description: 'Bien' } } } },
    });
    const app = crearApp({ ...manejadores, otraCosa: propio }, { contrato, pool: sano });

    const get = await pedir(app);
    const post = await pedir(app, 'POST');

    expect(get.statusCode).toBe(405);
    expect(get.headers.allow).toBe('POST');
    expect(post.json()).toEqual({ estado: 'ok', atendidoPor: 'el manejador del contrato' });
  });

  it('el servicio trae el manejador de verificarSalud, la operación del contrato v1, y los ocho de la spec 004', () => {
    expect(Object.keys(manejadores).sort()).toEqual(
      [
        'actualizarCliente',
        'crearBloqueo',
        'crearCliente',
        'levantarBloqueo',
        'listarBloqueos',
        'obtenerBloqueo',
        'obtenerCliente',
        'obtenerEstadoCuenta',
        'verificarSalud',
      ].sort(),
    );
  });

  it('verificarSalud en otra ruta del contrato no crea /health: la otra ruta la atiende y /health da 404', async () => {
    const contrato = contratoCon({
      '/otra': { get: { operationId: 'verificarSalud', security: [], responses: { '200': { description: 'Bien' } } } },
    });
    const app = crearApp({ verificarSalud: propio }, { contrato, pool: sano });

    expect((await pedir(app)).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/otra' })).json()).toEqual({
      estado: 'ok',
      atendidoPor: 'el manejador del contrato',
    });
  });
});

// El valor por defecto de M2_TIEMPO_BD_MS: RNF-14.2 pide 503 en 2 s.
const TIEMPO_BD_MS = 2000;

// Lo que se acepta por encima del tiempo de base: la máquina de CI puede ir lenta.
const MARGEN_MS = 1000;

// Node puede disparar un temporizador unos milisegundos antes de lo que mide performance.now().
const TOLERANCIA_MS = 20;

// Las pruebas que esperan de verdad el tiempo de base tardan unos 2 s; el límite de Vitest por defecto es 5 s.
const LIMITE_PRUEBA_MS = 15_000;

type Registro = { error: unknown; mensaje: string };

// La base se cuelga o se cae con el servicio andando, y después vuelve (RNF-14.2). Entre el pool y la base de la prueba hay un
// proxy TCP que se cuelga (acepta la conexión y no contesta), se cierra (rechaza las conexiones) y se reabre. La app y el pool
// son los mismos de principio a fin: nada se reinicia.
describe('GET /health y una operación con la base caída y el servicio andando (RNF-14.2)', () => {
  let base: BaseDePrueba;
  let proxy: ProxyDeBase;
  let pool: PoolBd;
  let registros: Registro[];

  beforeEach(async () => {
    base = await crearBaseDePrueba();
    proxy = await crearProxy(base.urlBd);
    // Cada prueba con su lista: un error que el pool registre al cerrarse no cae en la de la prueba siguiente.
    const propios: Registro[] = [];
    registros = propios;
    pool = crearPool({ urlBd: proxy.urlBd, tiempoBdMs: TIEMPO_BD_MS }, (error, mensaje) => propios.push({ error, mensaje }));
  });

  afterEach(async () => {
    await proxy.terminar();
    await pool.end();
    await base.borrar();
  });

  // Una operación del contrato de prueba que consulta la base como lo harán las de negocio.
  const consultaLaBase: Manejador = async (request) => {
    await request.server.pool.consultar('SELECT 1');
    return { ok: true };
  };

  // Las dos rutas que consultan la base.
  const RUTAS = ['/health', '/pruebas/publica'];

  // La app de la prueba y un `pedir` que mide cuánto tarda cada respuesta. Antes de devolverla responde una solicitud, como
  // un servicio que ya estaba andando: el pool queda con una conexión abierta a la base, que se cuelga o se cae con ella.
  async function andando() {
    const logs = capturarLogs();
    const app = crearApp({ ...manejadores, probarPublica: consultaLaBase }, { pool, flujoLog: logs.flujo });
    const pedir = async (url: string) => {
      const desde = performance.now();
      const respuesta = await app.inject({ method: 'GET', url });
      return { respuesta, duracion: performance.now() - desde };
    };
    expect((await pedir('/health')).respuesta.statusCode).toBe(200);
    expect(pool.idleCount).toBe(1);
    return { logs, pedir };
  }

  type Pedido = Awaited<ReturnType<Awaited<ReturnType<typeof andando>>['pedir']>>;

  // Las líneas de error del log: desde T41, una por cada 503 por la base, con el id de su solicitud y la causa (RNF-14.8).
  const lineasDeError = (logs: ReturnType<typeof capturarLogs>) => logs.lineas().filter((linea) => linea.level >= 50);

  // Que cada pedido dejó exactamente una línea «La base de datos no está disponible» con su id y una causa, y nada más.
  function unaLineaPorPedido(logs: ReturnType<typeof capturarLogs>, pedidos: Pedido[], causa: object = {}) {
    const lineas = lineasDeError(logs);
    expect(lineas).toHaveLength(pedidos.length);
    for (const { respuesta } of pedidos) {
      expect(lineas.filter((linea) => linea.idCorrelacion === respuesta.headers['x-request-id'])).toEqual([
        expect.objectContaining({
          msg: 'La base de datos no está disponible',
          err: expect.objectContaining({ tipo: 'BaseNoDisponible', causa: expect.objectContaining(causa) }),
        }),
      ]);
    }
  }

  function esBaseNoDisponible({ respuesta }: Pedido, url: string) {
    expect(respuesta.statusCode).toBe(503);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
    expect(respuesta.json()).toEqual({
      type: 'about:blank',
      title: 'Servicio no disponible',
      status: 503,
      detail: 'La base de datos no está disponible',
      instance: url,
    });
  }

  describe('con la base colgada: acepta la conexión y no contesta', () => {
    // Las dos a la vez: una toma la conexión que el pool ya tenía y queda esperando la respuesta a su consulta; la otra abre
    // una conexión nueva y queda esperando que la base la acepte. Las dos cortan en el tiempo de base.
    it(
      'GET /health y una operación que consulta la base responden 503 en problem+json en 2 s más un margen',
      async () => {
        const { logs, pedir } = await andando();
        proxy.colgar();

        const pedidos = await Promise.all(RUTAS.map(pedir));

        for (const [indice, url] of RUTAS.entries()) {
          const pedido = pedidos[indice] as Pedido;
          esBaseNoDisponible(pedido, url);
          expect(pedido.duracion).toBeGreaterThanOrEqual(TIEMPO_BD_MS - TOLERANCIA_MS);
          expect(pedido.duracion).toBeLessThan(TIEMPO_BD_MS + MARGEN_MS);
        }
        // Una línea por solicitud, con su id y la causa (RNF-14.8), y ninguna como error interno. El pool ya no registra
        // nada: la causa va en el error.
        unaLineaPorPedido(logs, pedidos, { mensaje: expect.any(String) });
        expect(logs.texto()).not.toContain('Error interno');
        expect(logs.texto()).not.toContain(new URL(base.urlBd).password);
        expect(registros).toEqual([]);
      },
      LIMITE_PRUEBA_MS,
    );

    // Con 12 solicitudes y 10 conexiones como máximo, dos esperan una conexión que el pool no puede dar: tampoco pasan del
    // tiempo de base.
    it(
      'con más solicitudes que conexiones en el pool, ninguna espera más que el tiempo de base',
      async () => {
        const { pedir } = await andando();
        proxy.colgar();

        const pedidos = await Promise.all(Array.from({ length: 12 }, (_, indice) => pedir(RUTAS[indice % 2] as string)));

        for (const [indice, pedido] of pedidos.entries()) {
          esBaseNoDisponible(pedido, RUTAS[indice % 2] as string);
          expect(pedido.duracion).toBeLessThan(TIEMPO_BD_MS + MARGEN_MS);
        }
      },
      LIMITE_PRUEBA_MS,
    );

    it(
      'cuando la base vuelve, las dos responden 200 sin reiniciar la app',
      async () => {
        const { pedir } = await andando();
        proxy.colgar();
        esBaseNoDisponible(await pedir('/health'), '/health');

        await proxy.reabrir();

        for (const url of RUTAS) expect((await pedir(url)).respuesta.statusCode).toBe(200);
      },
      LIMITE_PRUEBA_MS,
    );

    // Un corte más corto que el tiempo de base no es una falta de base. Las dos a la vez: una espera la respuesta a su consulta
    // en la conexión que el pool ya tenía, y la otra, que la base acepte una conexión nueva. Cuando el proxy suelta lo que
    // retuvo, las dos terminan bien.
    it('si la base vuelve antes del tiempo de base, las consultas que esperaban terminan bien', async () => {
      const { pedir } = await andando();
      proxy.colgar();

      const pendientes = RUTAS.map(pedir);
      await new Promise((listo) => setTimeout(listo, 300));
      await proxy.reabrir();
      const pedidos = await Promise.all(pendientes);

      for (const { respuesta, duracion } of pedidos) {
        expect(respuesta.statusCode).toBe(200);
        expect(duracion).toBeGreaterThanOrEqual(300 - TOLERANCIA_MS);
        expect(duracion).toBeLessThan(TIEMPO_BD_MS);
      }
      expect(pool.totalCount).toBe(2);
      expect(registros).toEqual([]);
    });
  });

  describe('con la conexión rechazada: la base se cayó', () => {
    // Sin un oyente de 'error' en el pool, esto tira el proceso: Vitest lo cuenta como error de la corrida.
    it('la conexión que el pool tenía abierta se cae, se registra y el servicio sigue', async () => {
      await andando();

      await proxy.cerrar();

      await vi.waitFor(() => expect(pool.totalCount).toBe(0));
      expect(registros).toHaveLength(1);
    });

    // La conexión rechazada falla enseguida: no hace falta esperar el tiempo de base para saber que la base no está.
    it('GET /health y la operación responden 503 en problem+json, sin esperar el tiempo de base', async () => {
      const { logs, pedir } = await andando();
      await proxy.cerrar();

      const pedidos: Pedido[] = [];
      for (const url of RUTAS) {
        const pedido = await pedir(url);
        esBaseNoDisponible(pedido, url);
        expect(pedido.duracion).toBeLessThan(TIEMPO_BD_MS);
        pedidos.push(pedido);
      }
      // La causa depende de la conexión: «Connection terminated» si la solicitud tomó la que el pool tenía y se cortó, o
      // ECONNREFUSED si abrió una nueva.
      unaLineaPorPedido(logs, pedidos, { mensaje: expect.any(String) });
    });

    it('cuando la base vuelve, las dos responden 200 sin reiniciar la app', async () => {
      const { pedir } = await andando();
      await proxy.cerrar();
      esBaseNoDisponible(await pedir('/health'), '/health');

      await proxy.reabrir();

      for (const url of RUTAS) expect((await pedir(url)).respuesta.statusCode).toBe(200);
    });
  });
});
