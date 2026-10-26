import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Identidad } from '../../src/auth/tokens.js';
import { migrar } from '../../src/bd/migraciones.js';
import { crearPool, type BaseDeDatos, type PoolBd } from '../../src/bd/pool.js';
import { BaseNoDisponible, ModuloNoDisponible, NoEncontrado, SinPermiso } from '../../src/errores.js';
import { crearCalificacion } from '../../src/calificaciones/repositorio.js';
import { crearM6 } from '../../src/historial/m6.js';
import { listarHistorialViajes, type LogHistorial } from '../../src/historial/servicio.js';
import { CONFIG, POOL_FALSO } from '../ayudas/app.js';
import { type BaseDePrueba, crearBaseDePrueba } from '../ayudas/bd.js';
import { paginaDeM6, resumenDeM6 } from '../ayudas/m6-simulado.js';
import { crearServidorModulo } from '../ayudas/servidor-modulo.js';

const ROLES = ['CLIENTE', 'OPERADOR'] as const;
const CONDUCTOR = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';

const viaje = (n: number, clientId: string, extra: object = {}) => resumenDeM6(n, clientId, CONDUCTOR, extra);
const pagina = paginaDeM6;

describe('listarHistorialViajes con PostgreSQL real y M6 simulado (007/T5)', () => {
  let base: BaseDePrueba;
  let pool: PoolBd;
  const serv = crearServidorModulo();
  let log: LogHistorial & { warn: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    base = await crearBaseDePrueba();
    await migrar({ urlBd: base.urlBd, tiempoBdMs: 2000 });
    pool = crearPool({ urlBd: base.urlBd, tiempoBdMs: 2000 });
    await serv.levantar();
  });
  afterAll(async () => {
    await pool?.end();
    await base?.borrar();
    await serv.cerrar();
  });
  beforeEach(() => {
    log = { warn: vi.fn() };
  });

  const perfil = async () => {
    const id = randomUUID();
    await pool.consultar(
      `INSERT INTO clientes (cliente_id, nombre, apellido, telefono) VALUES ($1, 'Ana', 'Ejemplo', '+5493624000000')`,
      [id],
    );
    return id;
  };
  // Se crea en cada llamada: la URL del M6 simulado se conoce recién cuando levanta.
  const m6 = () => crearM6({ ...CONFIG, urlM6: serv.url, tiempoModulosMs: 500, reintentosModulos: 1 });
  const listar = (identidad: Identidad, clienteId: string, page = 0, size = 20, bd: BaseDeDatos = pool) =>
    listarHistorialViajes(bd, m6(), log, identidad, ROLES, clienteId, { page, size }, 'id-de-correlacion');
  const consultaDeM6 = () => Object.fromEntries(new URL(serv.rutaRecibida, serv.url).searchParams);

  describe('quién puede consultar (RF-2.4, RF-2.4.5)', () => {
    it('un CLIENTE, su propio historial: la página convertida, con lo que pidió', async () => {
      const id = await perfil();
      serv.responderCon({ tipo: 'ok', cuerpo: pagina([viaje(1, id), viaje(2, id, { driverId: undefined })], 42) });

      const resultado = await listar({ sub: id, roles: ['CLIENTE'] }, id, 1, 2);

      expect(resultado).toEqual({
        page: 1,
        size: 2,
        totalElementos: 42,
        totalPaginas: 21,
        items: [
          { viajeId: viaje(1, id).id, estado: 'COMPLETED', conductorId: CONDUCTOR, calificado: false },
          { viajeId: viaje(2, id).id, estado: 'COMPLETED', calificado: false },
        ],
      });
      expect(consultaDeM6()).toEqual({ clientId: id, page: '2', pageSize: '2' });
      expect(serv.encabezadosRecibidos.get('x-request-id')).toBe('id-de-correlacion');
    });

    it('un CLIENTE, el de otro: 403 sin tocar la base ni llamar a M6', async () => {
      serv.responderCon({ tipo: 'ok', cuerpo: pagina([], 0) });

      await expect(listar({ sub: randomUUID(), roles: ['CLIENTE'] }, randomUUID(), 0, 20, POOL_FALSO)).rejects.toBeInstanceOf(
        SinPermiso,
      );
      expect(serv.llamadas).toBe(0);
    });

    it.each([
      ['un OPERADOR', ['OPERADOR'] as const],
      ['un CLIENTE+OPERADOR', ['CLIENTE', 'OPERADOR'] as const],
    ])('%s, el historial de otro cliente', async (_caso, roles) => {
      const id = await perfil();
      serv.responderCon({ tipo: 'ok', cuerpo: pagina([viaje(1, id)], 1) });

      const resultado = await listar({ sub: randomUUID(), roles: [...roles] }, id);

      expect(resultado.items).toHaveLength(1);
      expect(consultaDeM6().clientId).toBe(id);
    });
  });

  describe('el perfil va antes que M6 (RF-2.4.4)', () => {
    it('sin perfil: 404 sin llamar a M6', async () => {
      const id = randomUUID();
      serv.responderCon({ tipo: 'ok', cuerpo: pagina([], 0) });

      await expect(listar({ sub: id, roles: ['CLIENTE'] }, id)).rejects.toBeInstanceOf(NoEncontrado);
      expect(serv.llamadas).toBe(0);
    });

    it('con la base caída: el 503 de la base, sin llamar a M6 (Casos límite)', async () => {
      const id = randomUUID();
      const caida: BaseDeDatos = { ...POOL_FALSO, consultar: async () => Promise.reject(new BaseNoDisponible()) };
      serv.responderCon({ tipo: 'ok', cuerpo: pagina([], 0) });

      await expect(listar({ sub: id, roles: ['CLIENTE'] }, id, 0, 20, caida)).rejects.toBeInstanceOf(BaseNoDisponible);
      expect(serv.llamadas).toBe(0);
    });

    it('con perfil y M6 caído: el 503 de M6', async () => {
      const id = await perfil();
      serv.responderCon({ tipo: '5xx', estado: 500 });

      await expect(listar({ sub: id, roles: ['CLIENTE'] }, id)).rejects.toBeInstanceOf(ModuloNoDisponible);
      expect(serv.llamadas).toBe(2);
    });
  });

  describe('lo que responde M6 (RF-2.4.3, RF-2.4.9)', () => {
    it('un cliente sin viajes: 200 con items vacío, nunca 404', async () => {
      const id = await perfil();
      serv.responderCon({ tipo: 'ok', cuerpo: pagina([], 0) });

      expect(await listar({ sub: id, roles: ['CLIENTE'] }, id)).toEqual({
        page: 0,
        size: 20,
        totalElementos: 0,
        totalPaginas: 0,
        items: [],
      });
      expect(log.warn).not.toHaveBeenCalled();
    });

    it('el clienteId de la ruta en mayúsculas va a M6 como lo guarda M2, y sus viajes son del cliente', async () => {
      const id = await perfil();
      serv.responderCon({ tipo: 'ok', cuerpo: pagina([viaje(1, id.toUpperCase())], 1) });

      const resultado = await listar({ sub: id, roles: ['CLIENTE'] }, id.toUpperCase());

      expect(consultaDeM6().clientId).toBe(id);
      expect(resultado.items).toHaveLength(1);
      expect(log.warn).not.toHaveBeenCalled();
    });

    it('un viaje de otro cliente no sale y se registra un aviso con la cantidad, sin identificadores', async () => {
      const id = await perfil();
      const otro = randomUUID();
      serv.responderCon({ tipo: 'ok', cuerpo: pagina([viaje(1, id), viaje(2, otro), viaje(3, otro)], 3) });

      const resultado = await listar({ sub: id, roles: ['CLIENTE'] }, id);

      expect(resultado.items.map((item) => item.viajeId)).toEqual([viaje(1, id).id]);
      expect(resultado.totalElementos).toBe(3);
      expect(log.warn).toHaveBeenCalledOnce();
      expect(log.warn).toHaveBeenCalledWith({ descartados: 2 }, 'M6 devolvió viajes de otro cliente');
      const registrado = JSON.stringify(log.warn.mock.calls);
      for (const dato of [id, otro, viaje(2, otro).id, CONDUCTOR]) expect(registrado).not.toContain(dato);
    });
  });

  // 008/T9, RF-2.5.14: `calificado` sale de la base de M2, con una sola consulta por página.
  describe('calificado (RF-2.5.14)', () => {
    const calificar = (clienteId: string, viajeId: string) =>
      crearCalificacion((sql, parametros) => pool.consultar(sql, parametros), clienteId, randomUUID(), {
        viajeId,
        conductorId: CONDUCTOR,
        puntaje: 5,
      });

    // Un pool que cuenta las sentencias que tocan `calificaciones`: el historial hace una por página, y ninguna si no hay viajes.
    function contando() {
      const sentencias: string[] = [];
      const bd: BaseDeDatos = {
        tiempoBdMs: pool.tiempoBdMs,
        connect: () => pool.connect(),
        consultar: (sql, parametros) => {
          if (/calificaciones/i.test(sql)) sentencias.push(sql);
          return pool.consultar(sql, parametros);
        },
      };
      return { bd, sentencias };
    }

    it('true si el cliente calificó el viaje y false si no, con una sola consulta a la base para toda la página', async () => {
      const id = await perfil();
      await calificar(id, viaje(1, id).id);
      serv.responderCon({ tipo: 'ok', cuerpo: pagina([viaje(1, id), viaje(2, id), viaje(3, id, { driverId: undefined })], 3) });
      const { bd, sentencias } = contando();

      const resultado = await listar({ sub: id, roles: ['CLIENTE'] }, id, 0, 20, bd);

      expect(resultado.items.map(({ viajeId, calificado }) => [viajeId, calificado])).toEqual([
        [viaje(1, id).id, true],
        [viaje(2, id).id, false],
        [viaje(3, id).id, false],
      ]);
      expect(sentencias).toHaveLength(1);
      expect(serv.llamadas).toBe(1);
    });

    it('la calificación de otro cliente del mismo viaje no cuenta', async () => {
      const [id, otro] = [await perfil(), await perfil()];
      await calificar(otro, viaje(1, id).id);
      serv.responderCon({ tipo: 'ok', cuerpo: pagina([viaje(1, id)], 1) });

      expect((await listar({ sub: id, roles: ['CLIENTE'] }, id)).items[0]?.calificado).toBe(false);
    });

    it('un OPERADOR que mira el historial de otro cliente ve lo que ese cliente calificó', async () => {
      const id = await perfil();
      await calificar(id, viaje(1, id).id);
      serv.responderCon({ tipo: 'ok', cuerpo: pagina([viaje(1, id)], 1) });

      const resultado = await listar({ sub: randomUUID(), roles: ['OPERADOR'] }, id);

      expect(resultado.items[0]?.calificado).toBe(true);
    });

    it('el viajeId de M6 en mayúsculas se compara sin distinguir mayúsculas', async () => {
      const id = await perfil();
      const viajeId = 'aabbccdd-eeff-4a1b-8c2d-0123456789ab';
      await calificar(id, viajeId);
      serv.responderCon({ tipo: 'ok', cuerpo: pagina([viaje(1, id, { id: viajeId.toUpperCase() })], 1) });

      const resultado = await listar({ sub: id, roles: ['CLIENTE'] }, id);

      expect(resultado.items[0]).toMatchObject({ viajeId: viajeId.toUpperCase(), calificado: true });
    });

    it('un viaje de otro cliente que M6 mandó de más se descarta y no entra a la consulta', async () => {
      const [id, otro] = [await perfil(), await perfil()];
      await calificar(id, viaje(2, otro).id);
      serv.responderCon({ tipo: 'ok', cuerpo: pagina([viaje(1, id), viaje(2, otro)], 2) });

      const resultado = await listar({ sub: id, roles: ['CLIENTE'] }, id);

      expect(resultado.items.map((item) => item.viajeId)).toEqual([viaje(1, id).id]);
    });

    it('una página vacía no consulta la tabla de calificaciones', async () => {
      const id = await perfil();
      serv.responderCon({ tipo: 'ok', cuerpo: pagina([], 0) });
      const { bd, sentencias } = contando();

      const resultado = await listar({ sub: id, roles: ['CLIENTE'] }, id, 0, 20, bd);

      expect(resultado.items).toEqual([]);
      expect(sentencias).toEqual([]);
    });

    it('si la base falla al consultar los calificados: el 503 de la base, y no el historial sin calificado', async () => {
      const id = await perfil();
      serv.responderCon({ tipo: 'ok', cuerpo: pagina([viaje(1, id)], 1) });
      const falla: BaseDeDatos = {
        tiempoBdMs: pool.tiempoBdMs,
        connect: () => pool.connect(),
        consultar: (sql, parametros) =>
          /FROM calificaciones/i.test(sql) && !/FROM clientes/i.test(sql)
            ? Promise.reject(new BaseNoDisponible())
            : pool.consultar(sql, parametros),
      };

      await expect(listar({ sub: id, roles: ['CLIENTE'] }, id, 0, 20, falla)).rejects.toBeInstanceOf(BaseNoDisponible);
    });
  });
});
