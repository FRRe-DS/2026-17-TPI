import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import type { ConfigPanelOidc } from '../config.js';
import { responderProblema } from '../problemas.js';
import { CapacidadAgotada, nuevoIdentificador } from './almacen.js';
import { crearCookiesAuth } from './cookies.js';
import type { crearAlmacenTransacciones } from './transacciones.js';

type OpcionesInicio = { config: ConfigPanelOidc; transacciones: ReturnType<typeof crearAlmacenTransacciones> };
const SCOPES = 'openid clientes:read clientes:write clientes.estado:read';

// Plugin separado para que el parser de formulario se aplique solo a las rutas de autenticación.
export async function registrarInicioAuth(app: FastifyInstance, { config, transacciones }: OpcionesInicio): Promise<void> {
  const cookies = crearCookiesAuth(config);
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 1024 }, (_request, body, listo) => {
    const parametros = new URLSearchParams(body as string);
    for (const nombre of parametros.keys()) {
      if (parametros.getAll(nombre).length !== 1) {
        listo(Object.assign(new Error('Formulario inválido'), { statusCode: 400 }));
        return;
      }
    }
    listo(null, Object.fromEntries(parametros));
  });

  app.post('/auth/iniciar', {
    bodyLimit: 1024,
    preValidation: async (request) => { if (request.body === undefined) request.body = {}; },
    schema: {
      // Por ahora el único destino de retorno es la raíz; las vistas decidirán perfil y permisos tras autenticar.
      body: { type: 'object', additionalProperties: false, properties: { retorno: { type: 'string', enum: ['/'] } } },
      querystring: { type: 'object', additionalProperties: false, properties: {} },
    },
  }, (_request, reply) => {
    reply.header('cache-control', 'no-store');
    const verifier = nuevoIdentificador();
    const nonce = nuevoIdentificador();
    let transaccion: { state: string; vinculo: string };
    try {
      transaccion = transacciones.crear({ tipo: 'ingreso', nonce, verifier, retorno: '/' });
    } catch (error) {
      if (!(error instanceof CapacidadAgotada)) throw error;
      reply.header('retry-after', '5');
      return responderProblema(reply, { type: '/panel/errores/identidad-no-disponible', title: 'Identidad no disponible',
        status: 503, detail: 'No se puede iniciar sesión en este momento. Volvé a intentar más tarde.' });
    }

    const destino = new URL(`${config.oidcEmisor}/protocol/openid-connect/auth`);
    destino.search = new URLSearchParams({ response_type: 'code', client_id: config.oidcCliente,
      redirect_uri: config.urlRetorno, scope: SCOPES, state: transaccion.state, nonce,
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') }).toString();
    cookies.establecerTransaccion(reply, transaccion.vinculo);
    return reply.code(303).header('location', destino.href).send();
  });
}
