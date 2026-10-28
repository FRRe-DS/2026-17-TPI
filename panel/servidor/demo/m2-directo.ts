import type { ConfigPanel, ConfigTokens } from '../config.js';
import { causaDe } from '../proxy.js';
import { firmarToken, type RolDelPanel } from '../tokens.js';

// Los pedidos a M2 que el servidor del panel hace por su cuenta, sin pasar por el reenvío (spec 072, plan «Concurrencia»). Los
// necesitan las pruebas simultáneas: salen del servidor y no del navegador, que no abre más de seis conexiones por servidor y los
// pondría en fila. No se registran en el detalle técnico: 50 pedidos lo vaciarían en un instante. Para encontrarlos, cada uno lleva
// un `X-Request-Id` con el prefijo de la corrida, que M2 repite en sus logs (RNF-14).

// Cuánto se espera a M2 por pedido, contando el cuerpo de la respuesta. Igual que el reenvío; sin reintento (plan, Integraciones).
export const ESPERA_M2_DIRECTO_MS = 10_000;

export type PedidoDirecto = {
  metodo: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  // El camino con su query string, como se pediría a M2: `/api/v1/clientes/…`.
  ruta: string;
  identidad: { rol: RolDelPanel; sub: string };
  requestId: string;
  claveIdempotencia?: string;
  // Se manda como JSON.
  cuerpo?: unknown;
};

// `estado: 0` es «sin respuesta» (no contestó a tiempo o rechazó la conexión) y trae `motivo`: el código de Node o el nombre del
// error, nunca la dirección (RNF-19.4). El cuerpo queda como texto para poder comparar dos respuestas tal cual llegaron.
export type RespuestaDirecta = { estado: number; texto: string; tipoContenido: string | null; motivo?: string };

// El `X-Request-Id` del pedido número `indice` de una corrida.
export const idDePedido = (corrida: string, indice: number) => `panel-demo-${corrida}-${indice}`;

export async function m2Directo(
  config: Pick<ConfigPanel, 'urlM2'> & ConfigTokens,
  pedido: PedidoDirecto,
  esperaMs = ESPERA_M2_DIRECTO_MS,
): Promise<RespuestaDirecta> {
  // Una identidad que no sirve lanza `TokenInvalido` antes de salir: es un error de quien llama, no una falla de M2.
  const token = await firmarToken({ sub: pedido.identidad.sub, roles: [pedido.identidad.rol] }, config);
  const encabezados: Record<string, string> = { authorization: `Bearer ${token}`, 'x-request-id': pedido.requestId };
  if (pedido.claveIdempotencia !== undefined) encabezados['idempotency-key'] = pedido.claveIdempotencia;
  if (pedido.cuerpo !== undefined) encabezados['content-type'] = 'application/json';

  try {
    const respuesta = await fetch(config.urlM2 + pedido.ruta, {
      method: pedido.metodo,
      headers: encabezados,
      body: pedido.cuerpo === undefined ? undefined : JSON.stringify(pedido.cuerpo),
      // Una redirección no se sigue: M2 no debería mandar ninguna, y el panel no pide a otro destino.
      redirect: 'manual',
      signal: AbortSignal.timeout(esperaMs),
    });
    return { estado: respuesta.status, texto: await respuesta.text(), tipoContenido: respuesta.headers.get('content-type') };
  } catch (error) {
    const { tipo, codigo } = causaDe(error);
    return { estado: 0, texto: '', tipoContenido: null, motivo: codigo ?? tipo };
  }
}
