import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pedirM2, pedirM6, tokenDeM2 } from './ayudas/pedir.js';

// La prueba mínima del entorno distribuido (RNF-07.7): M2 y el M6 real contestan, y M2 guarda y devuelve un perfil.
describe('el entorno distribuido: M2 y el M6 real del Grupo 12 (RNF-07.7)', () => {
  it('GET /health de M2 da 200', async () => {
    expect((await pedirM2(undefined, 'GET', '/health')).estado).toBe(200);
  });

  it('GET /health de M6 da 200', async () => {
    expect((await pedirM6('GET', '/health')).estado).toBe(200);
  });

  it('M2 guarda y devuelve un perfil', async () => {
    const id = randomUUID();
    const token = await tokenDeM2(id, ['CLIENTE']);
    const datos = { nombre: 'Anastasia', apellido: 'Gomezcano', telefono: '+5493624987654', fechaNacimiento: '1990-05-17' };
    const alta = await pedirM2(token, 'POST', '/api/v1/clientes', { cuerpo: datos, encabezados: { 'idempotency-key': randomUUID() } });
    expect(alta.estado, alta.texto).toBe(201);
    const lectura = await pedirM2(token, 'GET', `/api/v1/clientes/${id}`);
    expect(lectura.estado, lectura.texto).toBe(200);
    expect(lectura.cuerpo).toMatchObject({ nombre: 'Anastasia', apellido: 'Gomezcano' });
  });
});
