import { describe, expect, it } from 'vitest';
import { cargarContrato } from '../../src/contrato/cargar.js';
import { obtenerPreferencias, guardarPreferencias } from '../../src/preferencias/operaciones.js';
import { crearApp } from '../ayudas/app.js';
import { capturarLogs } from '../ayudas/logs.js';
import { bearer } from '../ayudas/tokens.js';

const contrato = cargarContrato();
const SUB = '6f1c1d1e-3b0a-4f55-9a6b-0d7a8f4c2e11';
const OTRO = '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d';
const VACIO = { tiposVehiculo: [], canales: [], accesibilidad: [] };
const PROBLEMA = /^application\/problem\+json/;
const ruta = (id = SUB) => `/api/v1/clientes/${id}/preferencias`;
const app = () => crearApp({ obtenerPreferencias, guardarPreferencias }, { contrato });

describe('preferencias HTTP: rechazos antes de la base (006/T5)', () => {
  it.each(['GET', 'PUT'] as const)('%s sin token da 401', async (method) => {
    const respuesta = await app().inject({ method, url: ruta(), ...(method === 'PUT' ? { payload: VACIO } : {}) });
    expect(respuesta.statusCode).toBe(401);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA);
  });
  for (const method of ['GET', 'PUT'] as const) {
    const roles = method === 'GET' ? [['SERVICIO'], ['CONDUCTOR']] : [['SERVICIO'], ['CONDUCTOR'], ['OPERADOR']];
    it.each(roles.map((roles) => [roles]))(`${method} con %j da 403 por rol`, async (roles) => {
      const respuesta = await app().inject({ method, url: ruta(), headers: bearer({ claims: { sub: SUB, roles } }), ...(method === 'PUT' ? { payload: VACIO } : {}) });
      expect(respuesta.statusCode).toBe(403);
      expect(respuesta.headers['content-type']).toMatch(PROBLEMA);
    });
  }
  it.each(['GET', 'PUT'] as const)('%s CLIENTE ajeno da 403 antes de la base', async (method) => {
    const respuesta = await app().inject({ method, url: ruta(OTRO), headers: bearer({ claims: { sub: SUB, roles: ['CLIENTE'] } }), ...(method === 'PUT' ? { payload: VACIO } : {}) });
    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json().detail).not.toContain(OTRO);
  });
  it('PUT CLIENTE+OPERADOR ajeno da 403, OPERADOR no evade permisos con un cuerpo inválido', async () => {
    expect((await app().inject({ method: 'PUT', url: ruta(OTRO), headers: bearer({ claims: { sub: SUB, roles: ['CLIENTE', 'OPERADOR'] } }), payload: VACIO })).statusCode).toBe(403);
    expect((await app().inject({ method: 'PUT', url: ruta('invalido'), headers: bearer({ claims: { roles: ['OPERADOR'] } }), payload: {} })).statusCode).toBe(403);
  });

  const invalidos = [
    {}, { canales: [], accesibilidad: [] }, { tiposVehiculo: [], accesibilidad: [] }, { tiposVehiculo: [], canales: [] },
    { ...VACIO, tiposVehiculo: ['CAMION'] }, { ...VACIO, canales: ['FAX'] }, { ...VACIO, accesibilidad: ['OTRA'] },
    { ...VACIO, tiposVehiculo: ['AUTO', 'AUTO'] }, { ...VACIO, canales: ['SMS', 'SMS'] }, { ...VACIO, accesibilidad: ['SILLA_DE_RUEDAS', 'SILLA_DE_RUEDAS'] },
    { ...VACIO, tiposVehiculo: null }, { ...VACIO, canales: [null] }, { ...VACIO, accesibilidad: 'SILLA_DE_RUEDAS' },
    { ...VACIO, observacionesAccesibilidad: null }, { ...VACIO, observacionesAccesibilidad: 'x'.repeat(256) },
    { ...VACIO, extra: 'CENTINELA-CUERPO-INVALIDO' },
  ];
  it.each(invalidos.map((payload) => [payload]))('PUT inválido da 400: %j', async (payload) => {
    const logs = capturarLogs();
    const instancia = crearApp({ obtenerPreferencias, guardarPreferencias }, { contrato, flujoLog: logs.flujo });
    const respuesta = await instancia.inject({ method: 'PUT', url: ruta(), headers: bearer({ claims: { sub: SUB, roles: ['CLIENTE'] } }), payload });
    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.headers['content-type']).toMatch(PROBLEMA);
    expect(logs.texto()).not.toContain('CENTINELA-CUERPO-INVALIDO');
    expect(logs.texto()).not.toContain('x'.repeat(256));
  });
  it.each(['GET', 'PUT'] as const)('%s con id inválido da 400', async (method) => {
    const respuesta = await app().inject({ method, url: ruta('no-uuid'), headers: bearer({ claims: { sub: SUB, roles: ['CLIENTE'] } }), ...(method === 'PUT' ? { payload: VACIO } : {}) });
    expect(respuesta.statusCode).toBe(400);
  });
  it('un método no declarado da 405', async () => {
    expect((await app().inject({ method: 'PATCH', url: ruta(), payload: VACIO })).statusCode).toBe(405);
  });
});
