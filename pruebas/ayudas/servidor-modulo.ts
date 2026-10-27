import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';

export type Comportamiento =
  // `encabezados` se suma a los de la respuesta y puede reemplazar el Content-Type (lo usa el panel, spec 071).
  | { tipo: 'ok'; estado?: number; cuerpo?: unknown; encabezados?: Record<string, string> }
  | { tipo: 'demora-cuerpo'; retardoMs: number; estado?: number; cuerpo?: unknown }
  | { tipo: '4xx'; estado: number; cuerpo?: unknown }
  | { tipo: '5xx'; estado: number; cuerpo?: unknown }
  | { tipo: 'no-json'; contenido?: string; estado?: number }
  | { tipo: 'corta' }
  // No responde nunca: la conexión queda abierta hasta que el cliente se canse o se cierre el servidor.
  | { tipo: 'cuelga' };

export function crearServidorModulo() {
  // Uno por llamada, en orden; cuando se acaban, sigue valiendo el último.
  let comportamientos: Comportamiento[] = [{ tipo: 'ok' }];
  let llamadas = 0;
  // La hora de cada llamada, para medir la pausa entre intentos.
  const momentos: number[] = [];
  const encabezadosRecibidos = new Map<string, string>();
  // La ruta con query string de la última llamada, para ver qué se pidió.
  let rutaRecibida = '';
  // El Authorization de cada llamada, en orden (undefined si no vino), para ver qué llevó cada intento.
  const autorizaciones: (string | undefined)[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  // El método y el cuerpo de la última llamada, tal como llegaron.
  let metodoRecibido = '';
  let cuerpoRecibido = Buffer.alloc(0);

  const servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
    llamadas++;
    momentos.push(Date.now());
    rutaRecibida = req.url ?? '';
    autorizaciones.push(req.headers.authorization);
    encabezadosRecibidos.clear();
    for (const [clave, valor] of Object.entries(req.headers)) {
      if (typeof valor === 'string') encabezadosRecibidos.set(clave.toLowerCase(), valor);
    }

    metodoRecibido = req.method ?? '';
    res.on('error', () => {});

    // Responde cuando terminó de llegar el cuerpo, así quien prueba lo encuentra completo en `cuerpoRecibido`.
    const partes: Buffer[] = [];
    req.on('data', (parte: Buffer) => partes.push(parte));
    req.on('end', () => {
      cuerpoRecibido = Buffer.concat(partes);
      responder(req, res);
    });
  });

  function responder(req: IncomingMessage, res: ServerResponse): void {
    const c = comportamientos[Math.min(llamadas, comportamientos.length) - 1]!;
    if (c.tipo === 'ok') {
      const cuerpo = JSON.stringify(c.cuerpo ?? { ok: true });
      res.writeHead(c.estado ?? 200, { 'Content-Type': 'application/json', ...c.encabezados });
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
  }

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
    get autorizaciones(): (string | undefined)[] {
      return autorizaciones;
    },
    get metodoRecibido(): string {
      return metodoRecibido;
    },
    get cuerpoRecibido(): Buffer {
      return cuerpoRecibido;
    },
    // Un comportamiento para todas las llamadas, o una lista: uno por llamada y el último para las que siguen.
    responderCon(c: Comportamiento | Comportamiento[]): void {
      comportamientos = Array.isArray(c) ? c : [c];
      llamadas = 0;
      momentos.length = 0;
      autorizaciones.length = 0;
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
