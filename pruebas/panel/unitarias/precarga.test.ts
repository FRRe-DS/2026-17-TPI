import { it, expect } from 'vitest';
import { cargarConfigM6 } from '../../../panel/servidor/config.js';
import { crearEstadoM6 } from '../../../panel/m6-simulado/estado.js';
import { precargarM6 } from '../../../panel/m6-simulado/precarga.js';
const uno = 'c1e00000-0000-4000-8000-000000000001'; const dos = 'c1e00000-0000-4000-8000-000000000002';
const env = { M2_CLAVE_TOKENS: 'clave-de-prueba-de-32-caracteres!', M2_EMISOR_TOKENS: 'm1-identidad', M2_AUDIENCIA_TOKENS: 'm2-clientes' };
it('valida lista completa, normaliza UUID y elimina duplicados sin divulgar valores', () => {
  expect(cargarConfigM6({ ...env, M6_CLIENTES_PRECARGA: `${uno.toUpperCase()},${uno},${dos}` }).config?.clientesPrecarga).toEqual([uno, dos]);
  expect(cargarConfigM6({ ...env, M6_CLIENTES_PRECARGA: '' }).config?.clientesPrecarga).toEqual([]);
  expect(JSON.stringify(cargarConfigM6({ ...env, M6_CLIENTES_PRECARGA: `${uno},secreto-invalido` }).errores)).not.toContain('secreto-invalido');
  expect(cargarConfigM6({ ...env, M6_CLIENTES_PRECARGA: `${uno},` }).errores).toBeDefined();
});
it('precarga determinista antes del primer pedido, sin duplicación ni viajes cruzados', () => {
  const estado = crearEstadoM6(); precargarM6(estado, [uno, dos]);
  const antes = estado.listar({ clientId: uno }); precargarM6(estado, [uno, dos]);
  expect(estado.listar({ clientId: uno })).toEqual(antes);
  expect(antes.map(v => v.state).sort()).toEqual(['COMPLETED', 'IN_PROGRESS']);
  expect(estado.listar({ clientId: dos }).some(v => v.clientId === uno)).toBe(false);
});
