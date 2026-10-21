import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearPool, type PoolBd } from '../../src/bd/pool.js';
import { cargarContrato } from '../../src/contrato/cargar.js';
import type { Manejador } from '../../src/contrato/operaciones.js';
import { BaseNoDisponible } from '../../src/errores.js';
import { manejadores } from '../../src/operaciones/index.js';
import { contratoCon, crearApp } from '../ayudas/app.js';
import { type BaseDePrueba, crearBaseDePrueba } from '../ayudas/bd.js';
import { AUTORIZADO, bearer } from '../ayudas/tokens.js';

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

// Las dos maneras en que el servicio registra GET /health (ADR de la base): a mano, mientras el contrato no la tenga, y desde
// el contrato, cuando la tiene. Los manejadores son los del servicio en las dos.
const REGISTROS = [
  ['a mano (el contrato no la tiene)', undefined],
  ['desde el contrato (contrato-salud.yml)', contratoSalud],
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

  describe.each(REGISTROS)('registrada %s', (_registro, contrato) => {
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

// Qué manejador atiende GET /health se ve en lo que contesta: el de verificarSalud que le pasen, si el contrato la trae y
// tiene manejador (RNF-03.4), o el propio del servicio, si no.
describe('GET /health: desde el contrato o a mano (RNF-03.4, ADR de la base)', () => {
  const sano = { consultar: async () => ({}) as never };
  const propio: Manejador = async () => ({ estado: 'ok', atendidoPor: 'el manejador del contrato' });
  const pedir = (app: ReturnType<typeof crearApp>) => app.inject({ method: 'GET', url: '/health' });

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

  it('con /health en el contrato y sin manejador, la registra a mano: la operación del contrato queda pendiente', async () => {
    const respuesta = await pedir(crearApp({}, { contrato: contratoSalud, pool: sano }));

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({ estado: 'ok' });
  });

  it('sin /health en el contrato, la registra a mano y la atiende el servicio, aunque haya otro verificarSalud', async () => {
    const respuesta = await pedir(crearApp({ verificarSalud: propio }, { pool: sano }));

    expect(respuesta.json()).toEqual({ estado: 'ok' });
  });

  // Lo que cuenta es el método y la ruta de la operación implementada: otro método en /health no alcanza.
  it('con otro método en /health en el contrato y sin GET, GET /health se registra a mano', async () => {
    const contrato = contratoCon({
      '/health': { post: { operationId: 'otraCosa', security: [], responses: { '200': { description: 'Bien' } } } },
    });
    const app = crearApp({ otraCosa: propio }, { contrato, pool: sano });

    expect((await pedir(app)).json()).toEqual({ estado: 'ok' });
    expect((await app.inject({ method: 'POST', url: '/health' })).json()).toEqual({
      estado: 'ok',
      atendidoPor: 'el manejador del contrato',
    });
  });

  it('el servicio trae el manejador de verificarSalud, la operación del borrador del contrato v1', () => {
    expect(Object.keys(manejadores)).toEqual(['verificarSalud']);
  });

  it('un contrato con otra operación en otra ruta no cambia nada: /health sigue a mano', async () => {
    const contrato = contratoCon({
      '/otra': { get: { operationId: 'verificarSalud', security: [], responses: { '200': { description: 'Bien' } } } },
    });
    const app = crearApp({ verificarSalud: propio }, { contrato, pool: sano });

    expect((await pedir(app)).json()).toEqual({ estado: 'ok' });
    expect((await app.inject({ method: 'GET', url: '/otra' })).json()).toEqual({
      estado: 'ok',
      atendidoPor: 'el manejador del contrato',
    });
  });
});
