import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';

export type Comportamiento =
  | { tipo: 'ok'; estado?: number; cuerpo?: unknown }
  | { tipo: 'demora-cuerpo'; retardoMs: number; estado?: number; cuerpo?: unknown }
  | { tipo: '4xx'; estado: number; cuerpo?: unknown }
  | { tipo: '5xx'; estado: number; cuerpo?: unknown }
  | { tipo: 'no-json'; contenido?: string; estado?: number }
  | { tipo: 'corta' };

export function crearServidorModulo() {
  // Uno por llamada, en orden; cuando se acaban, sigue valiendo el último.
  let comportamientos: Comportamiento[] = [{ tipo: 'ok' }];
  let llamadas = 0;
  // La hora de cada llamada, para medir la pausa entre intentos.
  const momentos: number[] = [];
  const encabezadosRecibidos = new Map<string, string>();
  // La ruta con query string de la última llamada, para ver qué se pidió.
  let rutaRecibida = '';
  const timers: ReturnType<typeof setTimeout>[] = [];

  const servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
    llamadas++;
    momentos.push(Date.now());
    rutaRecibida = req.url ?? '';
    encabezadosRecibidos.clear();
    for (const [clave, valor] of Object.entries(req.headers)) {
      if (typeof valor === 'string') encabezadosRecibidos.set(clave.toLowerCase(), valor);
    }

    res.on('error', () => {});

    const c = comportamientos[Math.min(llamadas, comportamientos.length) - 1]!;
    if (c.tipo === 'ok') {
      const cuerpo = JSON.stringify(c.cuerpo ?? { ok: true });
      res.writeHead(c.estado ?? 200, { 'Content-Type': 'application/json' });
      res.end(cuerpo);
    } else if (c.tipo === 'demora-cuerpo') {
      // Envía los encabezados de inmediato, demora el cuerpo
      res.writeHead(c.estado ?? 200, { 'Content-Type': 'application/json' });
      res.flushHeaders();
      const t = setTimeout(() => {
        res.end(JSON.stringify(c.cuerpo ?? { ok: true }));
      }, c.retardoMs);
      timers.push(t);
    } else if (c.tipo === '4xx') {
      const cuerpo = JSON.stringify(c.cuerpo ?? { type: 'about:blank', status: c.estado });
      res.writeHead(c.estado, { 'Content-Type': 'application/problem+json' });
      res.end(cuerpo);
    } else if (c.tipo === '5xx') {
      const cuerpo = JSON.stringify(c.cuerpo ?? { error: 'error interno' });
      res.writeHead(c.estado, { 'Content-Type': 'application/json' });
      res.end(cuerpo);
    } else if (c.tipo === 'no-json') {
      res.writeHead(c.estado ?? 200, { 'Content-Type': 'text/plain' });
      res.end(c.contenido ?? 'no es json');
    } else if (c.tipo === 'corta') {
      req.socket.destroy();
    }
  });

  let puerto = 0;

  return {
    async levantar(): Promise<number> {
      await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
      puerto = (servidor.address() as AddressInfo).port;
      return puerto;
    },
    get url(): string {
      return `http://127.0.0.1:${puerto}`;
    },
    get llamadas(): number {
      return llamadas;
    },
    get momentos(): number[] {
      return momentos;
    },
    get encabezadosRecibidos(): Map<string, string> {
      return encabezadosRecibidos;
    },
    get rutaRecibida(): string {
      return rutaRecibida;
    },
    // Un comportamiento para todas las llamadas, o una lista: uno por llamada y el último para las que siguen.
    responderCon(c: Comportamiento | Comportamiento[]): void {
      comportamientos = Array.isArray(c) ? c : [c];
      llamadas = 0;
      momentos.length = 0;
    },
    async cerrar(): Promise<void> {
      for (const t of timers) clearTimeout(t);
      timers.length = 0;
      await new Promise<void>((resolve, reject) => {
        servidor.closeAllConnections?.();
        servidor.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
