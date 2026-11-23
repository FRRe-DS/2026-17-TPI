import type { FastifyInstance, FastifyReply } from 'fastify';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { ConfigPanelOidc } from './config.js';

// Los archivos del cliente que compila Vite (plan, Estructura): el `index.html`, lo que carga de `/assets/` y las rutas de las
// pantallas, que devuelven el mismo `index.html`. Es una lista cerrada, como el reenvío: nada de servir una carpeta entera.

// Las pantallas del cliente (`panel/cliente/src/rutas.ts`, que se compila aparte). Una prueba comprueba que son las mismas.
export const RUTAS_DEL_CLIENTE = [
  'ingresar',
  'perfil',
  'direcciones',
  'preferencias',
  'historial',
  'calificar',
  'calificaciones',
  'estado-cuenta',
  'operador',
  'otro-modulo',
  'detalle-tecnico',
  'm6-simulado',
  'demostracion',
] as const;

// Todo sale del propio origen (RNF-19.3): ni scripts ni estilos en línea, ni de terceros, ni `eval`; el panel no se puede
// embeber en otra página ni cambiar su base. OIDC agrega solo el origen público de Keycloak al destino de formularios.
export const POLITICA_DE_SEGURIDAD = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'";

type ConfigPolitica = Pick<ConfigPanelOidc, 'modoAuth' | 'oidcEmisor'> | { modoAuth: 'desarrollo' };

function politicaDeSeguridad(config?: ConfigPolitica): string {
  if (config?.modoAuth !== 'oidc') return POLITICA_DE_SEGURIDAD;
  // Defensa adicional al lector de configuración: nunca interpolar credenciales, comodines ni un emisor arbitrario en CSP.
  let emisor: URL;
  try { emisor = new URL(config.oidcEmisor); } catch { throw new Error('Emisor OIDC inválido para CSP'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(emisor.hostname);
  if (config.oidcEmisor.trim() !== config.oidcEmisor || config.oidcEmisor.includes('*') || emisor.username || emisor.password
    || emisor.search || emisor.hash || (emisor.protocol !== 'https:' && !(emisor.protocol === 'http:' && local))) {
    throw new Error('Emisor OIDC inválido para CSP');
  }
  return `${POLITICA_DE_SEGURIDAD} ${emisor.origin}`;
}

// Los tres encabezados salen en toda respuesta del panel, no solo en los archivos: también en la de un 404 o un error.
export function registrarEncabezadosDeSeguridad(app: FastifyInstance, config?: ConfigPolitica): void {
  const politica = politicaDeSeguridad(config);
  app.addHook('onSend', async (request, reply) => {
    // no-referrer convertiría en null el Origin de formularios nativos. same-origin permite el POST propio
    // sin enviar Referer a otros sitios; las redirecciones/callbacks de autenticación conservan no-referrer.
    const autenticacion = request.url.split('?', 1)[0].startsWith('/auth/');
    const referencia = config?.modoAuth === 'oidc' && !autenticacion ? 'same-origin' : 'no-referrer';
    reply
      .header('content-security-policy', politica)
      .header('x-content-type-options', 'nosniff')
      .header('referrer-policy', referencia);
  });
}

const TIPOS: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};
// Un archivo suelto de `/assets/`: sin barras, sin `..` ni punto al principio. Vite los deja todos en una sola carpeta.
const NOMBRE_DE_ARCHIVO = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function leer(ruta: string): Promise<Buffer | undefined> {
  try {
    return await readFile(ruta);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'EISDIR') return undefined;
    throw error;
  }
}

// El 404 del panel (problem+json), el mismo de una ruta que no existe.
function noEncontrado(reply: FastifyReply): FastifyReply {
  reply.callNotFound();
  return reply;
}

export function registrarEstaticos(app: FastifyInstance, directorio: string): void {
  // El index.html cambia con cada compilación y se pide siempre; los archivos de /assets/ llevan el hash en el nombre.
  async function servirIndex(reply: FastifyReply): Promise<FastifyReply> {
    const contenido = await leer(join(directorio, 'index.html'));
    if (contenido === undefined) return noEncontrado(reply);
    return reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-cache').send(contenido);
  }

  app.get('/', (_request, reply) => servirIndex(reply));
  for (const pantalla of RUTAS_DEL_CLIENTE) {
    app.get(`/${pantalla}`, (_request, reply) => servirIndex(reply));
    app.get(`/${pantalla}/:id`, (request, reply) =>
      UUID.test((request.params as { id: string }).id) ? servirIndex(reply) : noEncontrado(reply),
    );
  }

  app.get('/assets/*', async (request, reply) => {
    const nombre = (request.params as { '*': string })['*'];
    const tipo = TIPOS[extname(nombre).toLowerCase()];
    if (!NOMBRE_DE_ARCHIVO.test(nombre) || tipo === undefined) return noEncontrado(reply);
    const contenido = await leer(join(directorio, 'assets', nombre));
    if (contenido === undefined) return noEncontrado(reply);
    return reply.header('content-type', tipo).header('cache-control', 'public, max-age=31536000, immutable').send(contenido);
  });
}
