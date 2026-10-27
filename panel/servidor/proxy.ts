import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ConfigPanel } from './config.js';
import { type RegistroDePedidos } from './pedidos.js';
import { responderProblema, type Problema } from './problemas.js';
import { firmarToken, TokenInvalido } from './tokens.js';

// El reenvío a M2 (plan, Reenvío). El navegador no habla con M2: le pide al panel, y el panel arma el pedido con un token que
// firma él (RNF-12.6), lo manda a PANEL_URL_M2 y devuelve la respuesta tal cual (RNF-03.6). Es una lista cerrada de rutas y
// encabezados, para que el panel no sirva de puerta a otra cosa con un token firmado (RNF-12.8).

// Cuánto se espera a M2, contando el cuerpo de la respuesta (RNF-15.4).
export const ESPERA_M2_MS = 10_000;

// Las rutas de M2 que usa el panel: las de clientes (con lo que cuelga y su query string) y la salud.
const RUTA_DE_M2 = /^\/(?:api\/v1\/clientes(?:[/?]|$)|health$)/;
// Los caracteres que una ruta con query puede traer sin codificar (RFC 3986), menos `@`, `\` y `#`. Deja afuera espacios,
// saltos de línea y todo lo que no es ASCII.
const CARACTERES_PERMITIDOS = /^[A-Za-z0-9\-._~!$&'()*+,;=:/?%]+$/;
// Un punto, una barra o una barra invertida codificados en el camino: `new URL` los decodifica y resuelve como `.` y `..`.
const CODIFICADOS_PELIGROSOS = /%(?:2e|2f|5c)/i;
// Un segmento que es solo `.`: no sale de la lista, pero tampoco lo usa nadie, y así la regla no deja ningún segmento de punto.
const SEGMENTO_PUNTO = /\/\.(?:\/|$)/;

// Si la ruta (camino y query, como llega en `request.url`) se puede reenviar. Sin `..`, `//` ni `@` en ningún lado, y sin
// segmentos `.` ni puntos o barras codificados en el camino: así la URL de destino no puede salir de la lista al armarse.
export function rutaPermitida(ruta: string): boolean {
  if (!CARACTERES_PERMITIDOS.test(ruta) || !RUTA_DE_M2.test(ruta)) return false;
  if (ruta.includes('..') || ruta.includes('//')) return false;
  const camino = ruta.split('?', 1)[0] ?? '';
  return !CODIFICADOS_PELIGROSOS.test(camino) && !SEGMENTO_PUNTO.test(camino);
}

// Lo que se copia del pedido del navegador. `authorization` no: lo pone el panel.
const ENCABEZADOS_DEL_PEDIDO = ['accept', 'content-type', 'idempotency-key'] as const;
// Lo que se copia de la respuesta de M2. `x-request-id` lo pone el panel en toda respuesta, y es el mismo que mandó a M2.
const ENCABEZADOS_DE_LA_RESPUESTA = ['content-type', 'location', 'retry-after', 'allow'] as const;

// `idempotency-key` → `Idempotency-Key`, como se escribe en un `curl`.
const nombreCanonico = (nombre: string) =>
  nombre
    .split('-')
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
    .join('-');

const METODOS_DE_CLIENTES = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const SIN_CUERPO = new Set(['GET', 'HEAD']);

const RUTA_NO_PERMITIDA: Problema = {
  type: '/panel/errores/ruta-no-permitida',
  title: 'Ruta no permitida',
  status: 400,
  detail: 'El panel solo reenvía rutas de /api/v1/clientes y /health, sin "..", "//", "@" ni separadores codificados.',
};

const M2_NO_RESPONDE: Problema = {
  type: '/panel/errores/m2-no-responde',
  title: 'M2 no responde',
  status: 504,
  detail: `M2 no respondió en ${ESPERA_M2_MS / 1000} segundos o rechazó la conexión.`,
};

const identidadInvalida = (motivo: string): Problema => ({
  type: '/panel/errores/identidad-invalida',
  title: 'Identidad de prueba inválida',
  status: 400,
  detail: motivo,
});

// La identidad de prueba que pide el navegador (X-Panel-Rol y X-Panel-Sub), ya firmada. Sin ninguno de los dos, el pedido va
// sin token y M2 responde lo que responda (por ejemplo, 401): también eso se quiere poder ver.
async function tokenDelPedido(request: FastifyRequest, config: ConfigPanel): Promise<string | undefined> {
  const rol = request.headers['x-panel-rol'];
  const sub = request.headers['x-panel-sub'];
  if (rol === undefined && sub === undefined) return undefined;
  return firmarToken({ sub: sub as string, roles: [rol as string] }, config);
}

// El nombre y el código de lo que hizo fallar a fetch, para el log: sin la URL ni encabezados.
export function causaDe(error: unknown): { tipo: string; codigo?: string } {
  const { name, cause } = error instanceof Error ? error : { name: typeof error, cause: undefined };
  const codigo = (cause as { code?: unknown } | undefined)?.code;
  return typeof codigo === 'string' ? { tipo: name, codigo } : { tipo: name };
}

export type OpcionesReenvio = { config: ConfigPanel; esperaMs: number; pedidos: RegistroDePedidos };

// Se registra como plugin: así el lector de cuerpos crudos vale solo para estas rutas.
export async function registrarReenvio(app: FastifyInstance, { config, esperaMs, pedidos }: OpcionesReenvio): Promise<void> {
  const tokens = new WeakMap<FastifyRequest, string | undefined>();

  // El cuerpo va a M2 tal como llegó, sin parsear: M2 es quien lo valida. El límite de 1 MiB es el de la app.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, cuerpo, listo) => listo(null, cuerpo));

  // Después del hook de seguridad (que es del padre) y antes de leer el cuerpo: lo que no se reenvía no se lee.
  app.addHook('onRequest', async (request, reply) => {
    if (!rutaPermitida(request.url)) return responderProblema(reply, RUTA_NO_PERMITIDA);
    try {
      tokens.set(request, await tokenDelPedido(request, config));
    } catch (error) {
      if (error instanceof TokenInvalido) return responderProblema(reply, identidadInvalida(error.message));
      throw error;
    }
    return undefined;
  });

  async function reenviar(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const encabezados: Record<string, string> = {};
    for (const nombre of ENCABEZADOS_DEL_PEDIDO) {
      const valor = request.headers[nombre];
      if (typeof valor === 'string') encabezados[nombre] = valor;
    }
    encabezados['x-request-id'] = request.id;
    // Lo que se registra para el detalle técnico: lo mismo que sale, sin el token (que se agrega después).
    const registrados = Object.fromEntries(Object.entries(encabezados).map(([nombre, valor]) => [nombreCanonico(nombre), valor]));
    const token = tokens.get(request);
    if (token !== undefined) encabezados['authorization'] = `Bearer ${token}`;
    // fetch tipa el cuerpo como BufferSource, y un Buffer de Node no lo es para TypeScript: se copia (es 1 MiB como mucho).
    const cuerpo = !SIN_CUERPO.has(request.method) && Buffer.isBuffer(request.body) ? Uint8Array.from(request.body) : undefined;

    const inicio = performance.now();
    const registrar = (estado: number) =>
      pedidos.registrar({
        requestId: request.id,
        hora: new Date().toISOString(),
        metodo: request.method,
        ruta: request.url,
        encabezados: registrados,
        conToken: token !== undefined,
        ...(cuerpo !== undefined && cuerpo.length > 0 ? { cuerpo: Buffer.from(cuerpo).toString('utf8') } : {}),
        estado,
        duracionMs: Math.round(performance.now() - inicio),
      });

    let respuesta: Response;
    let contenido: Buffer;
    try {
      respuesta = await fetch(config.urlM2 + request.url, {
        method: request.method,
        headers: encabezados,
        body: cuerpo,
        // Una redirección no se sigue: vuelve al navegador como está, y el panel nunca pide a otro destino.
        redirect: 'manual',
        signal: AbortSignal.timeout(esperaMs),
      });
      contenido = Buffer.from(await respuesta.arrayBuffer());
    } catch (error) {
      request.log.warn({ causa: causaDe(error) }, 'M2 no responde');
      registrar(M2_NO_RESPONDE.status);
      return responderProblema(reply, M2_NO_RESPONDE);
    }
    registrar(respuesta.status);

    reply.code(respuesta.status);
    for (const nombre of ENCABEZADOS_DE_LA_RESPUESTA) {
      const valor = respuesta.headers.get(nombre);
      if (valor !== null) reply.header(nombre, valor);
    }
    return contenido.length > 0 ? reply.send(contenido) : reply.send();
  }

  app.route({ method: METODOS_DE_CLIENTES, url: '/api/v1/clientes', handler: reenviar });
  app.route({ method: METODOS_DE_CLIENTES, url: '/api/v1/clientes/*', handler: reenviar });
  app.get('/health', reenviar);
}
