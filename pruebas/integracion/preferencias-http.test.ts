import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../../src/bd/migraciones.js';
import { crearPool, type PoolBd } from '../../src/bd/pool.js';
import { cargarContrato } from '../../src/contrato/cargar.js';
import { obtenerPreferencias, guardarPreferencias } from '../../src/preferencias/operaciones.js';
import type { Preferencias } from '../../src/preferencias/modelo.js';
import { crearApp } from '../ayudas/app.js';
import { type BaseDePrueba, crearBaseDePrueba } from '../ayudas/bd.js';
import { capturarLogs } from '../ayudas/logs.js';
import { armarToken } from '../ayudas/tokens.js';

const contrato = cargarContrato();
const VACIO: Preferencias = { tiposVehiculo: [], canales: [], accesibilidad: [] };
const COMPLETO: Preferencias = { tiposVehiculo: ['AUTO', 'MOTO'], canales: ['EMAIL', 'SMS', 'PUSH'], accesibilidad: ['SILLA_DE_RUEDAS', 'ASISTENCIA_VISUAL', 'ASISTENCIA_AUDITIVA', 'ANIMAL_DE_ASISTENCIA'], observacionesAccesibilidad: 'CENTINELA-OBSERVACION-FICTICIA' };
type Rol = 'CLIENTE' | 'OPERADOR' | 'SERVICIO' | 'CONDUCTOR';

describe('preferencias HTTP con PostgreSQL real (006/T5)', () => {
  let base: BaseDePrueba;
  let pool: PoolBd;
  beforeAll(async () => {
    base = await crearBaseDePrueba();
    await migrar({ urlBd: base.urlBd, tiempoBdMs: 2000 });
    pool = crearPool({ urlBd: base.urlBd, tiempoBdMs: 2000 });
  });
  afterAll(async () => { await pool?.end(); await base?.borrar(); });
  const perfil = async () => {
    const id = randomUUID();
    await pool.consultar(`INSERT INTO clientes (cliente_id, nombre, apellido, telefono) VALUES ($1, 'Ana', 'Ejemplo', '+5493624000000')`, [id]);
    return id;
  };
  function crear() {
    const logs = capturarLogs();
    const instancia = crearApp({ obtenerPreferencias, guardarPreferencias }, { contrato, pool, flujoLog: logs.flujo });
    const tokens: string[] = [];
    const pedido = (method: 'GET' | 'PUT', id: string, payload?: Preferencias, roles: Rol[] = ['CLIENTE'], sub = id) => {
      const token = armarToken({ claims: { sub, roles } }); tokens.push(token);
      return instancia.inject({ method, url: `/api/v1/clientes/${id}/preferencias`, headers: { authorization: `Bearer ${token}` }, ...(payload === undefined ? {} : { payload }) });
    };
    return { pedido, logs, tokens };
  }
  it('GET devuelve predeterminados sin crear fila; PUT sin clave reemplaza y se puede repetir', async () => {
    const id = await perfil(); const { pedido } = crear();
    const inicial = await pedido('GET', id);
    expect([inicial.statusCode, inicial.json()]).toEqual([200, VACIO]);
    expect((await pool.consultar('SELECT 1 FROM preferencias_cliente WHERE cliente_id = $1', [id])).rowCount).toBe(0);
    for (const payload of [COMPLETO, COMPLETO, VACIO]) {
      const guardado = await pedido('PUT', id, payload);
      expect([guardado.statusCode, guardado.json()]).toEqual([200, payload]);
      const leido = await pedido('GET', id);
      expect([leido.statusCode, leido.json()]).toEqual([200, payload]);
    }
    expect((await pool.consultar('SELECT count(*)::integer AS total FROM preferencias_cliente WHERE cliente_id = $1', [id])).rows).toEqual([{ total: 1 }]);
  });
  it.each(['', 'x'.repeat(255), 'Texto ficticio con ñ, comillas " y emoji 🦮'])('conserva observaciones válidas %j', async (observacionesAccesibilidad) => {
    const id = await perfil(); const { pedido } = crear(); const payload = { ...VACIO, observacionesAccesibilidad };
    expect((await pedido('PUT', id, payload)).json()).toEqual(payload);
    expect((await pedido('GET', id)).json()).toEqual(payload);
  });
  it('GET y PUT sin perfil dan 404 problem+json sin insertar', async () => {
    const id = randomUUID(); const { pedido } = crear();
    for (const method of ['GET', 'PUT'] as const) {
      const respuesta = await pedido(method, id, method === 'PUT' ? VACIO : undefined);
      expect(respuesta.statusCode).toBe(404);
      expect(respuesta.headers['content-type']).toMatch(/^application\/problem\+json/);
    }
    expect((await pool.consultar('SELECT 1 FROM preferencias_cliente WHERE cliente_id = $1', [id])).rowCount).toBe(0);
  });
  it('CLIENTE+OPERADOR y OPERADOR leen otro perfil; el token mixto no lo escribe', async () => {
    const id = await perfil(); const { pedido } = crear();
    for (const roles of [['OPERADOR'], ['CLIENTE', 'OPERADOR']] as Rol[][]) {
      expect((await pedido('GET', id, undefined, roles, randomUUID())).statusCode).toBe(200);
      expect((await pedido('PUT', id, COMPLETO, roles, randomUUID())).statusCode).toBe(403);
    }
    expect((await pedido('GET', id)).json()).toEqual(VACIO);
  });
  it('dos PUT simultáneos responden cada objeto completo y dejan uno de ellos', async () => {
    const id = await perfil(); const { pedido } = crear();
    const respuestas = await Promise.all([pedido('PUT', id, COMPLETO), pedido('PUT', id, VACIO)]);
    expect(respuestas.map((r) => [r.statusCode, r.json()])).toEqual([[200, COMPLETO], [200, VACIO]]);
    expect([COMPLETO, VACIO]).toContainEqual((await pedido('GET', id)).json());
  });
  it('U+0000 da 400 sin cambiar el conjunto previo; logs sin preferencias ni tokens', async () => {
    const id = await perfil(); const { pedido, logs, tokens } = crear();
    expect((await pedido('PUT', id, COMPLETO)).statusCode).toBe(200);
    expect((await pedido('PUT', id, { ...VACIO, observacionesAccesibilidad: 'CENTINELA-NULO\u0000FICTICIO' })).statusCode).toBe(400);
    expect((await pedido('GET', id)).json()).toEqual(COMPLETO);
    for (const valor of [...COMPLETO.tiposVehiculo, ...COMPLETO.canales, ...COMPLETO.accesibilidad, COMPLETO.observacionesAccesibilidad!, 'CENTINELA-NULO', 'Bearer', ...tokens]) expect(logs.texto()).not.toContain(valor);
  });
});
