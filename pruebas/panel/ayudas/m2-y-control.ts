import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect } from 'vitest';

// M2 y el canal de control del M6 simulado de mentira, en un mismo servidor: se ve qué modo pidió el panel y en qué orden, y se
// puede hacer fallar cada paso.
export const VIAJE = '77777777-7777-4777-8777-777777777777';
export type Fallas = { crearCliente?: number; estado?: number; ejemplo?: number; modo?: number };

export function m2YControl(modoInicial: string, fallas: Fallas = {}) {
  let modo = modoInicial;
  const pedidos: string[] = [];
  const modos: string[] = [];
  let calificaciones = 0;
  const servidor = createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on('data', (parte: Buffer) => partes.push(parte));
    req.on('end', () => {
      const ruta = `${req.method} ${req.url}`;
      pedidos.push(ruta);
      const json = (estado: number, cuerpo: unknown) => {
        res.writeHead(estado, { 'content-type': 'application/json' });
        res.end(JSON.stringify(cuerpo));
      };
      if (ruta === 'GET /health') return json(200, { estado: 'ok' });
      if (ruta === 'POST /api/v1/clientes') return json(fallas.crearCliente ?? 201, { clienteId: 'x' });
      if (ruta === 'GET /control/estado') return json(fallas.estado ?? 200, { modo, retardoLentoMs: 5000 });
      if (ruta === 'PUT /control/modo') {
        if (fallas.modo !== undefined) return json(fallas.modo, {});
        modo = JSON.parse(Buffer.concat(partes).toString('utf8')).modo;
        modos.push(modo);
        return json(200, { modo });
      }
      if (/^POST \/control\/clientes\/[^/]+\/ejemplo$/.test(ruta)) {
        return json(fallas.ejemplo ?? 200, { escenarios: [{ nombre: 'enCurso', viajeId: 'otro' }, { nombre: 'completado', viajeId: VIAJE }] });
      }
      if (/^POST \/api\/v1\/clientes\/[^/]+\/calificaciones$/.test(ruta)) {
        calificaciones++;
        expect(JSON.parse(Buffer.concat(partes).toString('utf8'))).toEqual({ viajeId: VIAJE, puntaje: 5 });
        return json(calificaciones === 1 ? 201 : 409, {});
      }
      return json(404, {});
    });
  });
  return {
    pedidos,
    modos,
    get modo() {
      return modo;
    },
    async levantar() {
      await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
      return `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    },
    cerrar: () =>
      new Promise<void>((listo) => {
        servidor.closeAllConnections();
        servidor.close(() => listo());
      }),
  };
}

