import type { FastifyBaseLogger } from 'fastify';
import type { Identidad } from '../auth/tokens.js';
import type { BaseDeDatos } from '../bd/pool.js';
import type { Consultar } from '../bd/transaccion.js';
import { viajesCalificados } from '../calificaciones/repositorio.js';
import { exigirPerfil } from '../clientes/repositorio.js';
import { exigirPropietario, normalizarUuid } from '../clientes/servicio.js';
import type { M6 } from './m6.js';
import { aPaginaViajes, conCalificado, type PaginaViajes } from './modelo.js';

// El historial de viajes de un cliente (plan 007, Consulta). No sabe de HTTP: lo llamará `operaciones.ts`. El orden es el
// del plan: la propiedad (sin tocar la base ni M6), el perfil (sin llamar a M6) y M6. No guarda nada: el historial se arma
// en cada consulta con la respuesta de M6 (RNF-05). La spec 008 agrega `calificado` a cada viaje (RF-2.5.14), que sale de la
// base de M2.

// Solo lo que el servicio usa del log de la solicitud, que trae el id de correlación.
export type LogHistorial = Pick<FastifyBaseLogger, 'warn'>;

export type PedidoHistorial = { page: number; size: number };

// `consultar` del pool, para el repositorio: es un método y necesita su `this`.
const delPool =
  (pool: BaseDeDatos): Consultar =>
  (sql, parametros) =>
    pool.consultar(sql, parametros);

// Una página del historial de `clienteId` (RF-2.4), si quien llama puede verla: 403 si un CLIENTE pide el de otro
// (RF-2.4.5), 404 si no existe el perfil (RF-2.4.4), y los errores de `m6.listarViajes` si M6 falla (RF-2.4.6, RF-2.4.7). A
// M6 va el clienteId como lo guarda M2. Si M6 devolvió viajes de otro cliente, se descartan y se registra cuántos, sin
// identificadores de viajes, clientes ni conductores (RF-2.4.9, RNF-19). Después de armar la página, una sola consulta dice cuáles
// de sus viajes calificó el cliente (RF-2.5.14); sin viajes no se consulta, y si la base falla sale su 503 y no un historial sin
// `calificado`. M6 no se vuelve a llamar.
export async function listarHistorialViajes(
  pool: BaseDeDatos,
  m6: M6,
  log: LogHistorial,
  identidad: Identidad,
  rolesOperacion: readonly string[],
  clienteId: string,
  { page, size }: PedidoHistorial,
  idCorrelacion: string,
): Promise<PaginaViajes> {
  exigirPropietario(identidad, clienteId, rolesOperacion);
  const cliente = normalizarUuid(clienteId);
  await exigirPerfil(delPool(pool), cliente);

  const cuerpoM6 = await m6.listarViajes(cliente, page, size, idCorrelacion);
  const pagina = aPaginaViajes(cuerpoM6, cliente, page, size);
  const descartados = cuerpoM6.items.length - pagina.items.length;
  if (descartados > 0) log.warn({ descartados }, 'M6 devolvió viajes de otro cliente');
  if (pagina.items.length === 0) return pagina;
  const calificados = await viajesCalificados(
    delPool(pool),
    cliente,
    pagina.items.map((viaje) => viaje.viajeId.toLowerCase()),
  );
  return conCalificado(pagina, calificados);
}
