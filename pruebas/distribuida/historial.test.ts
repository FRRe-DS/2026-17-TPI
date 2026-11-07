import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { crearClienteEnM2 } from './ayudas/clientes.js';
import { validarContraContrato } from './ayudas/contrato.js';
import { describirRespuesta } from './ayudas/errores.js';
import { pedirM2, pedirM6, tokenDeM2 } from './ayudas/pedir.js';
import { crearViaje } from './ayudas/viajes.js';

// El historial de viajes de M2 contra el M6 real (RF-2.4, RNF-07.8). M2 consulta a M6 `GET /trips?clientId=…` con su token de
// servicio y arma la página: aquí se ve de punta a punta, con la numeración de páginas que cambia (M2 desde 0, M6 desde 1).
type Item = { viajeId: string; estado: string; calificado?: boolean };
type Pagina = { items: Item[]; page: number; size: number; totalElementos: number; totalPaginas: number };

describe('el historial de viajes de M2 con el M6 real (RF-2.4, RNF-07.8)', () => {
  let clienteId: string;
  let token: string;
  let viajes: string[];
  let calificado: string;
  let ajeno: string;

  beforeAll(async () => {
    ({ clienteId, token } = await crearClienteEnM2());
    const propios = [await crearViaje(clienteId, 'COMPLETED'), await crearViaje(clienteId, 'COMPLETED'), await crearViaje(clienteId, 'COMPLETED')];
    viajes = propios.map((v) => v.viajeId);
    calificado = viajes[1] as string;
    ajeno = (await crearViaje(randomUUID(), 'COMPLETED')).viajeId;
    const calificacion = await pedirM2(token, 'POST', `/api/v1/clientes/${clienteId}/calificaciones`, {
      cuerpo: { viajeId: calificado, puntaje: 4 },
      encabezados: { 'idempotency-key': randomUUID() },
      consultaM6: true,
    });
    expect(calificacion.estado, describirRespuesta(calificacion)).toBe(201);
  });

  const historial = (consulta: string) =>
    pedirM2(token, 'GET', `/api/v1/clientes/${clienteId}/viajes${consulta}`, { consultaM6: true });

  it('da 200 con exactamente los tres viajes del cliente y ninguno del otro', async () => {
    const respuesta = await historial('');
    expect(respuesta.estado, describirRespuesta(respuesta)).toBe(200);
    const pagina = respuesta.cuerpo as Pagina;
    expect(pagina.items.map((i) => i.viajeId).sort()).toEqual([...viajes].sort());
    expect(pagina.items.map((i) => i.viajeId)).not.toContain(ajeno);
    expect(pagina.totalElementos).toBe(3);
  });

  it('marca calificado: true solo en el viaje calificado', async () => {
    const pagina = (await historial('')).cuerpo as Pagina;
    for (const item of pagina.items) expect(item.calificado, item.viajeId).toBe(item.viajeId === calificado);
  });

  it('page=0&size=2 trae dos y page=1&size=2 trae uno', async () => {
    const primera = (await historial('?page=0&size=2')).cuerpo as Pagina;
    const segunda = (await historial('?page=1&size=2')).cuerpo as Pagina;
    expect(primera.items).toHaveLength(2);
    expect(primera).toMatchObject({ page: 0, size: 2, totalElementos: 3, totalPaginas: 2 });
    expect(segunda.items).toHaveLength(1);
    expect(segunda.page).toBe(1);
    // Sin repetir: entre las dos páginas están los tres.
    expect([...primera.items, ...segunda.items].map((i) => i.viajeId).sort()).toEqual([...viajes].sort());
  });

  // El pedido que llega a M6 se ve con pedirM6: la misma consulta, con la página de M6 (desde 1), da los mismos viajes.
  it('lo que M2 muestra en cada página es lo que M6 devuelve para esa página, contada desde 1', async () => {
    const servicio = await tokenDeM2('m2-clientes', ['SERVICIO']);
    for (const paginaM2 of [0, 1]) {
      const m2 = (await historial(`?page=${paginaM2}&size=2`)).cuerpo as Pagina;
      const m6 = await pedirM6('GET', `/trips?clientId=${clienteId}&page=${paginaM2 + 1}&pageSize=2`, { token: servicio });
      expect(m6.estado, describirRespuesta(m6)).toBe(200);
      const idsM6 = (m6.cuerpo as { items: { id: string }[] }).items.map((i) => i.id);
      expect(m2.items.map((i) => i.viajeId), `página ${paginaM2} de M2`).toEqual(idsM6);
    }
  });

  it('un cliente sin viajes recibe una página vacía con 200', async () => {
    const otro = await crearClienteEnM2();
    const respuesta = await pedirM2(otro.token, 'GET', `/api/v1/clientes/${otro.clienteId}/viajes`, { consultaM6: true });
    expect(respuesta.estado, describirRespuesta(respuesta)).toBe(200);
    expect(respuesta.cuerpo).toMatchObject({ items: [], page: 0, totalElementos: 0 });
  });

  it('los cuerpos validan contra contrato/openapi.yml', async () => {
    for (const consulta of ['', '?page=0&size=2', '?page=1&size=2']) {
      const respuesta = await historial(consulta);
      expect(validarContraContrato('PaginaViajes', respuesta.cuerpo), consulta).toEqual([]);
    }
  });
});
