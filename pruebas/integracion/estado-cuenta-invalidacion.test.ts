import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../../src/bd/migraciones.js';
import { crearPool, type PoolBd } from '../../src/bd/pool.js';
import { crearBloqueo, crearCliente, levantarBloqueo, obtenerEstadoCuenta } from '../../src/clientes/operaciones.js';
import { cargarContrato } from '../../src/contrato/cargar.js';
import { crearApp } from '../ayudas/app.js';
import { type BaseDePrueba, crearBaseDePrueba } from '../ayudas/bd.js';
import { levantarRedisFalso, type RedisFalso } from '../ayudas/redis-falso.js';
import { armarToken } from '../ayudas/tokens.js';

// La copia del estado de cuenta se descarta cuando la base confirma un alta o un levantamiento de bloqueo, antes de responder,
// y no cambia si la base no lo confirma (spec 107: RF-2.6.9, RF-2.6.9.1, RF-2.6.9.2). PostgreSQL real; Redis, el falso por TCP,
// que anota cada comando.

const TIEMPO_BD_MS = 2000;
const contrato = cargarContrato();
const OPERADOR = 'operador-de-la-prueba';
type Rol = 'CLIENTE' | 'OPERADOR';

describe('invalidación de la copia del estado de cuenta', () => {
  let base: BaseDePrueba;
  let pool: PoolBd;
  let redis: RedisFalso;

  beforeAll(async () => {
    base = await crearBaseDePrueba();
    await migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });
    pool = crearPool({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });
    redis = await levantarRedisFalso();
  });

  afterAll(async () => {
    await redis?.cerrar();
    await pool?.end();
    await base?.borrar();
  });

  async function crear() {
    const app = crearApp(
      { crearCliente, obtenerEstadoCuenta, crearBloqueo, levantarBloqueo },
      { contrato, pool, config: { urlRedis: redis.url, tiempoRedisMs: 500 } },
    );
    await app.ready();
    await new Promise<void>((listo) => {
      const espera = setInterval(() => app.redis.conectado && (clearInterval(espera), listo()), 10);
    });
    const autorizacion = (sub: string, roles: Rol[]) => ({ authorization: `Bearer ${armarToken({ claims: { sub, roles } })}` });
    const clienteId = randomUUID();
    await app.inject({ method: 'POST', url: '/api/v1/clientes', headers: { ...autorizacion(clienteId, ['CLIENTE']), 'idempotency-key': randomUUID() }, payload: { nombre: 'Ana', apellido: 'Gómez', telefono: '+5493624000000' } });
    return {
      clienteId,
      estado: async (id = clienteId) => {
        const respuesta = await app.inject({ method: 'GET', url: `/api/v1/clientes/${id}/estado-cuenta`, headers: autorizacion(OPERADOR, ['OPERADOR']) });
        return { codigo: respuesta.statusCode, cuerpo: respuesta.json() as { estado?: string } };
      },
      alta: (payload: object, clave = randomUUID(), id = clienteId) =>
        app.inject({ method: 'POST', url: `/api/v1/clientes/${id}/bloqueos`, headers: { ...autorizacion(OPERADOR, ['OPERADOR']), 'idempotency-key': clave }, payload }),
      levantar: (bloqueoId: string, id = clienteId) =>
        app.inject({ method: 'PATCH', url: `/api/v1/clientes/${id}/bloqueos/${bloqueoId}`, headers: autorizacion(OPERADOR, ['OPERADOR']), payload: { motivo: 'Pagó' } }),
    };
  }

  const incrDe = (clienteId: string) => redis.comandos.filter(([nombre, clave]) => nombre?.toUpperCase() === 'INCR' && clave === `m2:estado-cuenta:v:${clienteId}`).length;
  const lecturasDeBase = (clienteId: string) => redis.comandos.filter(([nombre, clave]) => nombre?.toUpperCase() === 'SET' && clave?.startsWith(`m2:estado-cuenta:c:${clienteId}:`)).length;

  it('tras el 201 de crearBloqueo la siguiente consulta lee la base y ve BLOQUEADO (RF-2.6.9)', async () => {
    const app = await crear();
    expect((await app.estado()).cuerpo.estado).toBe('ACTIVO');
    expect((await app.estado()).cuerpo.estado).toBe('ACTIVO');
    expect(lecturasDeBase(app.clienteId)).toBe(1);

    const alta = await app.alta({ motivo: 'Deuda' });
    expect(alta.statusCode).toBe(201);
    // Ya se invalidó cuando llegó la respuesta.
    expect(incrDe(app.clienteId)).toBe(1);

    expect((await app.estado()).cuerpo.estado).toBe('BLOQUEADO');
    expect(lecturasDeBase(app.clienteId)).toBe(2);
  });

  it('tras el 200 de levantarBloqueo la siguiente consulta lee la base y ve ACTIVO (RF-2.6.9.1)', async () => {
    const app = await crear();
    const { bloqueoId } = (await app.alta({ motivo: 'Deuda' })).json() as { bloqueoId: string };
    expect((await app.estado()).cuerpo.estado).toBe('BLOQUEADO');
    expect((await app.estado()).cuerpo.estado).toBe('BLOQUEADO');

    const levantado = await app.levantar(bloqueoId);
    expect(levantado.statusCode).toBe(200);
    expect(incrDe(app.clienteId)).toBe(2);

    expect((await app.estado()).cuerpo.estado).toBe('ACTIVO');
  });

  it('la versión nunca recibe vencimiento', async () => {
    const app = await crear();
    await app.alta({ motivo: 'Deuda' });
    expect(redis.comandos.some(([nombre, clave]) => nombre?.toUpperCase() === 'PEXPIRE' && clave === `m2:estado-cuenta:v:${app.clienteId}`)).toBe(false);
  });

  describe('lo que la base no confirma no toca la copia (RF-2.6.9.2)', () => {
    it.each([
      ['un hasta ya pasado (422)', { motivo: 'x', hasta: '2000-01-01T00:00:00Z' }, 422],
    ])('crearBloqueo con %s', async (_caso, payload, codigo) => {
      const app = await crear();
      await app.estado();
      const respuesta = await app.alta(payload);
      expect(respuesta.statusCode).toBe(codigo);
      expect(incrDe(app.clienteId)).toBe(0);
      expect(lecturasDeBase(app.clienteId)).toBe(1);
      await app.estado();
      expect(lecturasDeBase(app.clienteId)).toBe(1);
    });

    it('crearBloqueo de un cliente sin perfil (404)', async () => {
      const app = await crear();
      const inexistente = randomUUID();
      expect((await app.alta({ motivo: 'x' }, randomUUID(), inexistente)).statusCode).toBe(404);
      expect(incrDe(inexistente)).toBe(0);
    });

    it('crearBloqueo con una Idempotency-Key usada con otro cuerpo (422)', async () => {
      const app = await crear();
      const clave = randomUUID();
      await app.alta({ motivo: 'primero' }, clave);
      await app.estado();
      const antes = incrDe(app.clienteId);
      expect((await app.alta({ motivo: 'otro' }, clave)).statusCode).toBe(422);
      expect(incrDe(app.clienteId)).toBe(antes);
      await app.estado();
      expect(lecturasDeBase(app.clienteId)).toBe(1);
    });

    it('levantarBloqueo ya levantado (409) o inexistente (404)', async () => {
      const app = await crear();
      const { bloqueoId } = (await app.alta({ motivo: 'Deuda' })).json() as { bloqueoId: string };
      expect((await app.levantar(bloqueoId)).statusCode).toBe(200);
      await app.estado();
      const antes = incrDe(app.clienteId);
      expect((await app.levantar(bloqueoId)).statusCode).toBe(409);
      expect((await app.levantar(randomUUID())).statusCode).toBe(404);
      expect(incrDe(app.clienteId)).toBe(antes);
      await app.estado();
      expect(lecturasDeBase(app.clienteId)).toBe(1);
    });
  });

  it('repetir un alta con la misma clave devuelve el 201 guardado y la cuenta sigue BLOQUEADA', async () => {
    const app = await crear();
    const clave = randomUUID();
    await app.alta({ motivo: 'Deuda' }, clave);
    await app.estado();
    expect((await app.alta({ motivo: 'Deuda' }, clave)).statusCode).toBe(201);
    expect((await app.estado()).cuerpo.estado).toBe('BLOQUEADO');
  });
});
