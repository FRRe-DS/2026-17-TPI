import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { altasSimultaneas, calificacionesSimultaneas, PreparacionFallida } from '../../../panel/servidor/demo/concurrencia.js';
import { CONFIG_PANEL } from '../ayudas/app.js';
import { m2YControl } from '../ayudas/m2-y-control.js';

// Las pruebas simultáneas contra un M2 de mentira (spec 072, T5): se ve qué llega y cuándo. Este M2 no contesta nada hasta que
// llegaron los N pedidos: si salieran de a uno, el primero esperaría solo y la prueba lo notaría (RNF-08.2).
type Llegada = { encabezados: IncomingMessage['headers']; res: ServerResponse };

function m2QueEspera(n: number, responder: (llegada: Llegada, indice: number) => void, esperaMaximaMs = 3000) {
  const llegadas: Llegada[] = [];
  let llegadosAlPrimerResponder: number | undefined;
  const responderTodos = () => {
    llegadosAlPrimerResponder ??= llegadas.length;
    llegadas.forEach(responder);
  };
  let temporizador: NodeJS.Timeout | undefined;
  const servidor = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      llegadas.push({ encabezados: req.headers, res });
      temporizador ??= setTimeout(responderTodos, esperaMaximaMs);
      if (llegadas.length === n) {
        clearTimeout(temporizador);
        responderTodos();
      }
    });
  });
  return {
    llegadas,
    get llegadosAlPrimerResponder() {
      return llegadosAlPrimerResponder;
    },
    async levantar() {
      await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
      return `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    },
    cerrar: () =>
      new Promise<void>((listo) => {
        clearTimeout(temporizador);
        servidor.closeAllConnections();
        servidor.close(() => listo());
      }),
  };
}

const unaFila = { contarClientes: async () => ({ filas: 1 }), contarCalificaciones: async () => ({ filas: 1 }) };
const responder201 = ({ res }: Llegada) => {
  res.writeHead(201, { 'content-type': 'application/json' });
  res.end('{"clienteId":"x"}');
};

const abiertos: { cerrar: () => Promise<void> }[] = [];
afterEach(async () => {
  for (const servidor of abiertos.splice(0)) await servidor.cerrar();
});

async function levantar(n: number, responder = responder201) {
  const m2 = m2QueEspera(n, responder);
  abiertos.push(m2);
  const urlM2 = await m2.levantar();
  return { m2, dependencias: { config: { ...CONFIG_PANEL, urlM2 }, base: unaFila } };
}

describe('altasSimultaneas: los N pedidos salen a la vez (RNF-08.2)', () => {
  it.each([10, 50])('con N = %i, M2 ve llegar todos antes de responder el primero', async (n) => {
    const { m2, dependencias } = await levantar(n);

    const resultado = await altasSimultaneas(dependencias, { n, modo: 'misma-clave' });

    expect(m2.llegadosAlPrimerResponder).toBe(n);
    expect(resultado.porCodigo).toEqual({ 201: n });
  });

  it('con la misma clave, todos llevan la misma Idempotency-Key y el mismo sub; cada uno su X-Request-Id con el prefijo', async () => {
    const { m2, dependencias } = await levantar(5);

    const resultado = await altasSimultaneas(dependencias, { n: 5, modo: 'misma-clave' });

    const claves = new Set(m2.llegadas.map(({ encabezados }) => encabezados['idempotency-key']));
    const ids = m2.llegadas.map(({ encabezados }) => String(encabezados['x-request-id']));
    const tokens = new Set(m2.llegadas.map(({ encabezados }) => JSON.parse(atob(String(encabezados.authorization).split('.')[1] ?? '')).sub));
    expect(claves.size).toBe(1);
    expect(tokens).toEqual(new Set([resultado.clienteId]));
    expect(new Set(ids).size).toBe(5);
    expect(ids.every((id) => id.startsWith(resultado.prefijoRequestId))).toBe(true);
  });

  it('con claves distintas, cada pedido lleva la suya', async () => {
    const { m2, dependencias } = await levantar(5);

    await altasSimultaneas(dependencias, { n: 5, modo: 'claves-distintas' });

    expect(new Set(m2.llegadas.map(({ encabezados }) => encabezados['idempotency-key'])).size).toBe(5);
  });
});

describe('altasSimultaneas: el veredicto', () => {
  it('con la misma clave, cuerpos distintos no cumplen aunque los códigos sí', async () => {
    const { dependencias } = await levantar(3, ({ res }, indice) => {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ clienteId: 'x', vez: indice }));
    });

    const resultado = await altasSimultaneas(dependencias, { n: 3, modo: 'misma-clave' });

    expect(resultado).toMatchObject({ porCodigo: { 201: 3 }, cuerposIguales: false, filas: 1, cumple: false });
  });

  it('un pedido sin respuesta cuenta como código 0 y no cumple', async () => {
    const { dependencias } = await levantar(3, ({ res }, indice) => {
      if (indice === 0) return; // este no contesta nunca
      responder201({ res } as Llegada);
    });

    const resultado = await altasSimultaneas({ ...dependencias, esperaMs: 500 }, { n: 3, modo: 'misma-clave' });

    expect(resultado.porCodigo).toEqual({ 0: 1, 201: 2 });
    expect(resultado.cumple).toBe(false);
  });

  it('dos filas en la base no cumplen aunque los códigos sí', async () => {
    const { dependencias } = await levantar(2);

    const resultado = await altasSimultaneas(
      { ...dependencias, base: { ...unaFila, contarClientes: async () => ({ filas: 2 }) } },
      { n: 2, modo: 'misma-clave' },
    );

    expect(resultado).toMatchObject({ filas: 2, cumple: false });
  });
});

async function levantarConControl(modoInicial: string, fallas?: Fallas) {
  const falso = m2YControl(modoInicial, fallas);
  abiertos.push(falso);
  const url = await falso.levantar();
  return { falso, dependencias: { config: { ...CONFIG_PANEL, urlM2: url, urlM6Control: url }, base: unaFila } };
}

describe('calificacionesSimultaneas: preparación y modo del M6 simulado (RNF-08.4)', () => {
  it('crea el cliente, carga su ejemplo y califica N veces el viaje completado', async () => {
    const { falso, dependencias } = await levantarConControl('normal');

    const resultado = await calificacionesSimultaneas(dependencias, { n: 4 });

    expect(falso.pedidos.filter((pedido) => pedido.endsWith('/calificaciones'))).toHaveLength(4);
    expect(falso.pedidos).toContain(`POST /control/clientes/${resultado.clienteId}/ejemplo`);
    expect(falso.pedidos.indexOf('POST /api/v1/clientes')).toBeLessThan(falso.pedidos.findIndex((p) => p.endsWith('/ejemplo')));
    expect(resultado).toMatchObject({ porCodigo: { 201: 1, 409: 3 }, filas: 1, cumple: true });
  });

  it('en modo normal no cambia el modo', async () => {
    const { falso, dependencias } = await levantarConControl('normal');

    await calificacionesSimultaneas(dependencias, { n: 2 });

    expect(falso.modos).toEqual([]);
  });

  it.each(['caido', 'lento'])('en modo %s lo pone en normal para la prueba y lo repone al terminar', async (modo) => {
    const { falso, dependencias } = await levantarConControl(modo);

    await calificacionesSimultaneas(dependencias, { n: 2 });

    expect(falso.modos).toEqual(['normal', modo]);
    expect(falso.modo).toBe(modo);
  });

  it('si falla la carga del ejemplo, repone el modo y lanza PreparacionFallida sin calificar nada', async () => {
    const { falso, dependencias } = await levantarConControl('caido', { ejemplo: 500 });

    await expect(calificacionesSimultaneas(dependencias, { n: 3 })).rejects.toThrow(PreparacionFallida);

    expect(falso.modo).toBe('caido');
    expect(falso.pedidos.some((pedido) => pedido.endsWith('/calificaciones'))).toBe(false);
  });

  it('si no se puede crear el cliente, no toca el M6 simulado', async () => {
    const { falso, dependencias } = await levantarConControl('caido', { crearCliente: 503 });

    const error = await calificacionesSimultaneas(dependencias, { n: 3 }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PreparacionFallida);
    expect((error as Error).message).toContain('503');
    expect(falso.pedidos.some((pedido) => pedido.includes('/control/'))).toBe(false);
  });

  it('si no se puede leer el modo, no lo cambia', async () => {
    const { falso, dependencias } = await levantarConControl('caido', { estado: 500 });

    await expect(calificacionesSimultaneas(dependencias, { n: 3 })).rejects.toThrow(PreparacionFallida);

    expect(falso.modos).toEqual([]);
  });

  it('si el canal de control no responde, lo dice sin la dirección', async () => {
    const { dependencias } = await levantarConControl('normal');

    const error = await calificacionesSimultaneas(
      { ...dependencias, config: { ...dependencias.config, urlM6Control: 'http://127.0.0.1:9' } },
      { n: 3 },
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PreparacionFallida);
    expect((error as Error).message).toContain('canal de control');
    expect((error as Error).message).not.toContain('127.0.0.1');
  });
});
