import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ConfigPanel } from './config.js';
import { responderProblema, type Problema } from './problemas.js';
import { causaDe } from './proxy.js';

// El reenvío al canal de control del M6 simulado (plan, Rutas propias): el navegador cambia el modo y carga el ejemplo pidiéndole
// al panel, que se lo pide al canal en PANEL_URL_M6_CONTROL (RNF-13.5, RF-2.1.10). Son tres rutas fijas, no un reenvío general:
// el destino se arma con un texto propio y, como mucho, un UUID ya validado, así que el pedido no puede ir a otra parte.

// Cuánto se espera al canal, contando el cuerpo de la respuesta. Es una máquina propia: si no contesta en 3 segundos, no va a
// contestar. Sin reintento: la persona repite desde la pantalla.
export const ESPERA_CONTROL_MS = 3000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CANAL_NO_RESPONDE: Problema = {
  type: '/panel/errores/m6-control-no-responde',
  title: 'Canal de control del M6 simulado no disponible',
  status: 502,
  detail: 'El canal de control del M6 simulado no respondió a tiempo o rechazó la conexión. ¿Está levantado el servicio m6?',
};

const CLIENTE_ID_INVALIDO: Problema = {
  type: '/panel/errores/cliente-id-invalido',
  title: 'clienteId inválido',
  status: 400,
  detail: 'El clienteId tiene que ser un UUID.',
};

type Destino = { metodo: 'GET' | 'PUT' | 'POST'; ruta: string; conCuerpo?: boolean };

// Un pedido al canal de control. Solo lleva lo necesario: ni el token, ni la identidad, ni `Origin` ni cookies del navegador pasan
// al canal. Sin `Origin`, que el canal rechaza en lo que cambia algo (T8): el que llama es este servidor, no una página.
export type PedidoControl = {
  metodo: 'GET' | 'PUT' | 'POST';
  // La ruta del canal (`/control/…`), no la del panel.
  ruta: string;
  requestId: string;
  cuerpo?: Uint8Array<ArrayBuffer>;
  tipoContenido?: string;
};

export type RespuestaControl = { estado: number; tipoContenido: string | null; contenido: Buffer };

// El canal no contestó a tiempo o rechazó la conexión. `causa` es el error de `fetch`, para que quien llama lo registre sin la URL.
export class ControlM6NoResponde extends Error {
  override readonly name = 'ControlM6NoResponde';
  constructor(readonly causa: unknown) {
    super('El canal de control del M6 simulado no respondió');
  }
}

// El pedido al canal de control, separado de las rutas del panel para usarlo también desde la vista de demostración (spec 072,
// plan «Estructura»). Una sola vez, sin reintento: la persona repite desde la pantalla. `esperaMs` cuenta el cuerpo de la respuesta.
export async function pedirControlM6(
  { urlM6Control }: Pick<ConfigPanel, 'urlM6Control'>,
  { metodo, ruta, requestId, cuerpo, tipoContenido }: PedidoControl,
  esperaMs = ESPERA_CONTROL_MS,
): Promise<RespuestaControl> {
  const encabezados: Record<string, string> = { 'x-request-id': requestId };
  if (cuerpo !== undefined && tipoContenido !== undefined) encabezados['content-type'] = tipoContenido;
  try {
    const respuesta = await fetch(urlM6Control + ruta, {
      method: metodo,
      headers: encabezados,
      body: cuerpo,
      redirect: 'manual',
      signal: AbortSignal.timeout(esperaMs),
    });
    const contenido = Buffer.from(await respuesta.arrayBuffer());
    return { estado: respuesta.status, tipoContenido: respuesta.headers.get('content-type'), contenido };
  } catch (error) {
    throw new ControlM6NoResponde(error);
  }
}

export type OpcionesControlM6 = { config: ConfigPanel; esperaMs: number };

// Se registra como plugin: así el lector de cuerpos crudos vale solo para estas rutas.
export async function registrarControlM6(app: FastifyInstance, { config, esperaMs }: OpcionesControlM6): Promise<void> {
  // El cuerpo de `PUT /panel/m6/modo` va al canal tal como llegó: es quien lo valida. El límite de 1 MiB es el de la app.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, cuerpo, listo) => listo(null, cuerpo));

  async function reenviar(request: FastifyRequest, reply: FastifyReply, { metodo, ruta, conCuerpo = false }: Destino): Promise<FastifyReply> {
    const tipo = request.headers['content-type'];
    // fetch tipa el cuerpo como BufferSource, y un Buffer de Node no lo es para TypeScript: se copia.
    const cuerpo = conCuerpo && Buffer.isBuffer(request.body) ? Uint8Array.from(request.body) : undefined;

    let respuesta: RespuestaControl;
    try {
      respuesta = await pedirControlM6(config, {
        metodo,
        ruta,
        requestId: request.id,
        cuerpo,
        tipoContenido: conCuerpo && typeof tipo === 'string' ? tipo : undefined,
      }, esperaMs);
    } catch (error) {
      if (!(error instanceof ControlM6NoResponde)) throw error;
      request.log.warn({ causa: causaDe(error.causa) }, 'Canal de control del M6 simulado no responde');
      return responderProblema(reply, CANAL_NO_RESPONDE);
    }

    reply.code(respuesta.estado);
    if (respuesta.tipoContenido !== null) reply.header('content-type', respuesta.tipoContenido);
    return respuesta.contenido.length > 0 ? reply.send(respuesta.contenido) : reply.send();
  }

  app.get('/panel/m6/estado', (request, reply) => reenviar(request, reply, { metodo: 'GET', ruta: '/control/estado' }));

  app.put('/panel/m6/modo', (request, reply) => reenviar(request, reply, { metodo: 'PUT', ruta: '/control/modo', conCuerpo: true }));

  app.post('/panel/m6/clientes/:clienteId/ejemplo', (request, reply) => {
    const { clienteId } = request.params as { clienteId: string };
    if (!UUID.test(clienteId)) return responderProblema(reply, CLIENTE_ID_INVALIDO);
    return reenviar(request, reply, { metodo: 'POST', ruta: `/control/clientes/${clienteId}/ejemplo` });
  });
}
