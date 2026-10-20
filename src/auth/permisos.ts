import type { FastifyInstance } from 'fastify';
import type { ConfigTokens } from '../config.js';
import { SinPermiso } from '../errores.js';
import { esRolConocido, verificarToken, type Identidad } from './tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    // Quién llama, según su token (RNF-12.4). Es null en las operaciones públicas, que no miran el token.
    identidad: Identidad | null;
  }
}

// Deja pasar si algún rol conocido del token está entre los de la operación y, si no, lanza `SinPermiso` (403). Una operación
// que no lista roles admite cualquiera de los conocidos, y un token sin ninguno no pasa a ninguna (RNF-12.3). Los roles que el
// servicio no conoce no cuentan ni aunque la operación los liste, y los nombres se comparan tal cual, con sus mayúsculas.
export function autorizar(rolesDelToken: readonly string[], rolesDeLaOperacion: readonly string[]): void {
  const conocidos = rolesDelToken.filter(esRolConocido);
  const permitido =
    rolesDeLaOperacion.length === 0 ? conocidos.length > 0 : conocidos.some((rol) => rolesDeLaOperacion.includes(rol));
  if (!permitido) throw new SinPermiso();
}

// Exige el token y el rol que pide cada operación, según los permisos que su ruta guarda en la configuración
// (`registrarOperaciones`), y deja en `request.identidad` quién llama (RNF-12.1, RNF-12.3, RNF-12.4). Es un `onRequest`
// global: corre antes de leer el cuerpo, así que el 401 y el 403 van antes de cualquier error del cuerpo (RNF-03.5). Se
// registra después del hook del 404, en el orden del plan (Lógica 8); el 405 no pide token porque las comodín se declaran
// públicas (`prepararRutas405`). Toda ruta que se registre después tiene que declarar sus permisos, y una registrada antes
// que no los declara pide token (Lógica 4).
export function registrarPermisos(app: FastifyInstance, config: ConfigTokens): void {
  // null y no un objeto: Fastify no admite un valor por referencia, que compartirían todas las solicitudes. Cada una recibe
  // el suyo en el hook.
  app.decorateRequest('identidad', null);
  // Fastify llama a los onRoute dentro de app.route, antes de sumar la ruta: una que no declara sus permisos no se registra,
  // y el error sale de construirApp. Un olvido no deja arrancar el servicio, en vez de dejar abierta la ruta (RNF-12.1).
  app.addHook('onRoute', (ruta) => {
    if (ruta.config?.permisos === undefined) {
      throw new Error(`La ruta ${[ruta.method].flat().join(', ')} ${ruta.url} no declara sus permisos`);
    }
  });
  app.addHook('onRequest', async (request) => {
    const { permisos } = request.routeOptions.config;
    // Segunda capa: una ruta registrada antes que registrarPermisos no pasó por el onRoute y puede no declarar sus permisos;
    // se la trata como protegida, con cualquier rol conocido, como una operación cuyo contrato no nombra roles (RNF-12.1,
    // RNF-12.3). El 404 tampoco los declara, pero no llega acá: el hook anterior ya le respondió.
    if (permisos?.publica) return;

    const identidad = await verificarToken(request.headers.authorization, config);
    autorizar(identidad.roles, permisos?.roles ?? []);
    request.identidad = identidad;
  });
}
