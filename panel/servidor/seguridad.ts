import type { FastifyInstance } from 'fastify';
import type { ConfigPanelOidc } from './config.js';
import { responderProblema, type Problema } from './problemas.js';

// El panel firma tokens y solo es para quien lo abre en su máquina (RNF-12.8). Dos defensas, ninguna con CORS:
// - `Host`: solo los nombres de la propia máquina con el puerto del panel. Frena que una página de otro sitio llegue al panel
//   por un nombre que ella controla y que resuelve a 127.0.0.1 (DNS rebinding).
// - `Origin`: una acción que no es una consulta tiene que venir de una página del propio panel. El navegador manda `Origin` en
//   todo pedido que cambia algo; que falte o sea ajeno quiere decir que no lo hizo la pantalla del panel.
const METODOS_DE_CONSULTA = new Set(['GET', 'HEAD', 'OPTIONS']);

export const hostsPermitidos = (puerto: number): string[] => [`localhost:${puerto}`, `127.0.0.1:${puerto}`, `[::1]:${puerto}`];

const HOST_AJENO: Problema = {
  type: '/panel/errores/host-no-permitido',
  title: 'Host no permitido',
  status: 403,
  detail: 'El panel solo responde en localhost, 127.0.0.1 o [::1], con su puerto.',
};

const ORIGEN_AJENO: Problema = {
  type: '/panel/errores/origen-no-permitido',
  title: 'Origen no permitido',
  status: 403,
  detail: 'Una acción que no es una consulta tiene que hacerse desde el propio panel.',
};

// Función pura: devuelve el problema a responder, o undefined si el pedido puede seguir.
export function revisarAcceso(
  pedido: { metodo: string; host: string | undefined; origin: string | undefined },
  puerto: number,
): Problema | undefined {
  const host = pedido.host?.toLowerCase();
  if (host === undefined || !hostsPermitidos(puerto).includes(host)) return HOST_AJENO;
  if (METODOS_DE_CONSULTA.has(pedido.metodo.toUpperCase())) return undefined;
  return pedido.origin?.toLowerCase() === `http://${host}` ? undefined : ORIGEN_AJENO;
}

// En modo real se exige el origen configurado, que también puede ser HTTPS o un host distinto de loopback.
// Los encabezados reenviados y Referer no sustituyen Host/Origin. Los retornos GET de Keycloak no necesitan Origin.
export function revisarAccesoOidc(
  pedido: { metodo: string; host: string | undefined; origin: string | undefined },
  origenPublico: string,
): Problema | undefined {
  const publico = new URL(origenPublico);
  if (pedido.host?.toLowerCase() !== publico.host.toLowerCase()) {
    return { ...HOST_AJENO, detail: 'El servidor solo responde en el origen público configurado.' };
  }
  if (METODOS_DE_CONSULTA.has(pedido.metodo.toUpperCase())) return undefined;
  return pedido.origin === publico.origin ? undefined : ORIGEN_AJENO;
}

// Un `onRequest` para todas las rutas, también las que no existen: se registra primero, antes que ninguna ruta, y rechaza
// antes de leer el cuerpo ni de ejecutar nada.
export function registrarSeguridad(app: FastifyInstance, origen: number | Pick<ConfigPanelOidc, 'origenPublico'>): void {
  app.addHook('onRequest', async (request, reply) => {
    const pedido = { metodo: request.method, host: request.headers.host, origin: request.headers.origin };
    const problema = typeof origen === 'number'
      ? revisarAcceso(pedido, origen)
      : revisarAccesoOidc(pedido, origen.origenPublico);
    if (problema !== undefined) return responderProblema(reply, problema);
    return undefined;
  });
}
