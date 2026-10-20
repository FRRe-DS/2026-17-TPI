// El manejador de errores de la app y lo que Fastify y Node responden por su cuenta antes de entrar a una ruta, todo en
// problem+json (plan, Lógica 9). Esas respuestas no pasan por los hooks onSend ni onResponse: el encabezado de correlación y
// la línea de log se ponen acá.
import type { ConnectionError, FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { STATUS_CODES } from 'node:http';
import type { Socket } from 'node:net';
import { aProblema, SolicitudIlegible } from './errores.js';
import { registrarErrorInterno, registrarSolicitud, registrarSolicitudIlegible, secretosDeAutorizacion } from './logs.js';

// Si el cliente corta la conexión, o manda un chunked mal formado, mientras se lee el cuerpo, Node corta la solicitud con
// ECONNRESET («aborted») y Fastify se lo pasa al manejador de errores. Es una solicitud que no se pudo leer, no un error del
// servicio. Se reconoce por la solicitud, que se cortó antes de terminar, y no solo por el código: un ECONNRESET de la base o
// de otro módulo llega con la solicitud ya leída y sigue siendo un error interno (plan, Lógica 6).
function cortoElCliente(error: unknown, request: FastifyRequest): boolean {
  return (error as { code?: unknown } | null)?.code === 'ECONNRESET' && request.raw.readableAborted;
}

// El manejador de errores de la app: responde `error` con aProblema. Solo un error no previsto (500) se registra: los demás
// son respuestas que el servicio da a propósito (RNF-03.3). El corte del cliente es un 400 que casi nunca llega a salir,
// porque la conexión ya se cerró; si sigue abierta, el 400 lo responde clientErrorHandler.
export function responderProblema(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  const problema = cortoElCliente(error, request) ? new SolicitudIlegible() : error;
  const { codigo, cuerpo, encabezados } = aProblema(problema, request.url);
  if (codigo === 500) registrarErrorInterno(request.log, error, secretosDeAutorizacion(request.headers.authorization));
  return reply.code(codigo).headers(encabezados).send(cuerpo);
}

// frameworkErrors: lo que Fastify encuentra al buscar la ruta. La URL mal codificada (FST_ERR_BAD_URL) y el parámetro de
// ruta de más de 100 caracteres (FST_ERR_MAX_PARAM_LENGTH, que sin esto da 414, un código que el contrato no documenta) dan
// 400 (RNF-03.2); el error de una restricción asíncrona, que el servicio no usa, sería un 500. La solicitud ya tiene su id,
// el de genReqId, pero ningún hook. La duración se mide desde acá: el reloj de Fastify arranca recién dentro de una ruta.
export function crearFrameworkErrors(encabezadoCorrelacion: string) {
  return (error: FastifyError, request: FastifyRequest, reply: FastifyReply): void => {
    const inicio = performance.now();
    reply.header(encabezadoCorrelacion, request.id);
    responderProblema(error, request, reply);
    registrarSolicitud(request, reply, performance.now() - inicio);
  };
}

// Los errores de la conexión con un código propio, 431 y 408. Cualquier otro es una solicitud que no se pudo leer (400), aunque
// no venga del analizador de HTTP: para aProblema, uno que no conoce es un 500.
const CON_CODIGO_PROPIO = new Set(['HPE_HEADER_OVERFLOW', 'ERR_HTTP_REQUEST_TIMEOUT']);

// clientErrorHandler: Node lo llama cuando no puede leer una solicitud como HTTP, sin crear la solicitud ni su respuesta
// (RNF-03.2). La respuesta se escribe entera en el socket: sin instance, porque la ruta no se llegó a leer; con un id de
// correlación nuevo, porque los encabezados tampoco; y con Connection: close, porque lo que siga en la conexión ya no se
// puede leer y el socket se cierra. Ante ECONNRESET, o con el socket ya destruido, no hay a quién responder. Fastify lo
// llama con `this` en la app.
export function crearClientErrorHandler(encabezadoCorrelacion: string) {
  return function (this: FastifyInstance, error: ConnectionError, socket: Socket): void {
    if (error.code === 'ECONNRESET' || socket.destroyed) return;
    if (socket.writable) {
      const inicio = performance.now();
      const id = randomUUID();
      const { codigo, cuerpo, encabezados } = aProblema(CON_CODIGO_PROPIO.has(error.code) ? error : new SolicitudIlegible());
      const texto = JSON.stringify(cuerpo);
      const lineas = Object.entries({
        ...encabezados,
        [encabezadoCorrelacion]: id,
        // En bytes: el title y el detail tienen acentos.
        'Content-Length': String(Buffer.byteLength(texto)),
        Connection: 'close',
      }).map(([nombre, valor]) => `${nombre}: ${valor}`);
      socket.write([`HTTP/1.1 ${codigo} ${STATUS_CODES[codigo]}`, ...lineas, '', texto].join('\r\n'));
      registrarSolicitudIlegible(this.log, id, codigo, performance.now() - inicio);
    }
    socket.destroy();
  };
}
