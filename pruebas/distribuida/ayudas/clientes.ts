import { randomUUID } from 'node:crypto';
import { describirRespuesta } from './errores.js';
import { pedirM2, tokenDeM2 } from './pedir.js';

const DATOS = { nombre: 'Anastasia', apellido: 'Gomezcano', telefono: '+5493624987654', fechaNacimiento: '1990-05-17' };

// Un cliente nuevo en M2. El `sub` del token es su id (como en todo M2) y el token es el que firma el propio M2.
export async function crearClienteEnM2(): Promise<{ clienteId: string; token: string }> {
  const clienteId = randomUUID();
  const token = await tokenDeM2(clienteId, ['CLIENTE']);
  const alta = await pedirM2(token, 'POST', '/api/v1/clientes', { cuerpo: DATOS, encabezados: { 'idempotency-key': randomUUID() } });
  if (alta.estado !== 201) throw new Error(`Crear el cliente en M2 falló: ${describirRespuesta(alta)}`);
  return { clienteId, token };
}
