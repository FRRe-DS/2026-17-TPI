// El pedido de viajes a M6 y la lectura de su respuesta (plan 007, Lectura de la respuesta de M6). Sigue el contrato que
// publicó el Grupo 12: `GET /trips` con `clientId`, `page` desde 1 y `pageSize`, que responde `TripSummaryPage`.
import { tokenDeServicio } from '../auth/tokens.js';
import type { Config, ConfigTokens } from '../config.js';
import { ErrorDeIntegracion, ModuloNoDisponible } from '../errores.js';
import { crearClienteModulo } from '../modulos/cliente.js';
import { aPaginaDeM6, paginaInalcanzable, type PaginaM6, type ViajeM6 } from './modelo.js';

export type M6 = {
  // `page` es el de M2, desde 0. Devuelve la página de M6 ya comprobada; lanza `ModuloNoDisponible` (503) o
  // `ErrorDeIntegracion` (500).
  listarViajes(clienteId: string, page: number, size: number, idCorrelacion: string): Promise<PaginaM6>;
};

// Con la configuración de los tokens firma el token de servicio de cada intento (RF-2.4.11).
type ConfigM6 = ConfigTokens &
  Pick<Config, 'urlM6' | 'tiempoModulosMs' | 'reintentosModulos' | 'encabezadoCorrelacion' | 'audienciaM6' | 'reintentarDespuesS'>;

const NOMBRE = 'M6';

const esObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === 'object' && valor !== null && !Array.isArray(valor);

// Un texto, o nada: M6 no declara campos obligatorios en `TripSummary`, y un viaje sin conductor puede traerlo nulo.
const textoOpcional = (valor: unknown) => valor === undefined || valor === null || typeof valor === 'string';

// `viajeId` y `conductorId` son `format: uuid` en el contrato de M2: un id que no lo es haría que M2 respondiera fuera de su
// propio contrato (RNF-03).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esUuid = (valor: unknown) => typeof valor === 'string' && UUID.test(valor);

// Un viaje tiene que traer `id` (un UUID) y `state` en texto; `clientId`, si viene, en texto, y `driverId`, si viene, un UUID
// (vacío cuenta como sin conductor, como en `aViajeResumen`). Un viaje sin `clientId` no se puede dar por propio:
// `aPaginaViajes` lo descarta (RF-2.4.9).
const esViaje = (valor: unknown): valor is ViajeM6 =>
  esObjeto(valor) &&
  esUuid(valor.id) &&
  typeof valor.state === 'string' &&
  textoOpcional(valor.clientId) &&
  (valor.driverId === undefined || valor.driverId === null || valor.driverId === '' || esUuid(valor.driverId));

// La forma que M2 necesita de la respuesta (RF-2.4.10): `items`, una lista de viajes que no supera `size`, y `total`, un entero
// mayor o igual que cero. `page` y `pageSize` de M6 no se leen: la página que se devuelve es la que se pidió.
const esPagina = (cuerpo: unknown, size: number): cuerpo is PaginaM6 =>
  esObjeto(cuerpo) &&
  Array.isArray(cuerpo.items) &&
  cuerpo.items.length <= size &&
  cuerpo.items.every(esViaje) &&
  Number.isSafeInteger(cuerpo.total) &&
  (cuerpo.total as number) >= 0;

export function crearM6(config: ConfigM6): M6 {
  const cliente = crearClienteModulo({
    nombre: NOMBRE,
    urlBase: config.urlM6,
    tiempoMs: config.tiempoModulosMs,
    reintentos: config.reintentosModulos,
    encabezadoCorrelacion: config.encabezadoCorrelacion,
    credencial: () => tokenDeServicio(config),
    reintentarDespuesS: config.reintentarDespuesS,
  });

  return {
    async listarViajes(clienteId, page, size, idCorrelacion) {
      // Una página inalcanzable no tiene viajes: se le pide a M6 la primera, solo por el total (RF-2.4.3).
      const inalcanzable = paginaInalcanzable(page, size);
      const pageM6 = inalcanzable ? 1 : aPaginaDeM6(page);
      const query = new URLSearchParams({ clientId: clienteId, page: String(pageM6), pageSize: String(size) });
      // Puede lanzar ModuloNoDisponible, tras el reintento (RF-2.4.6, RNF-13).
      const { estado, cuerpo } = await cliente.obtener(`/trips?${query}`, idCorrelacion);

      // Las causas llevan el código y nunca el cuerpo, que puede traer datos de viajes (RNF-19).
      if (estado >= 400) throw new ErrorDeIntegracion({ cause: new Error(`${NOMBRE} respondió ${estado}`) });
      if (!esPagina(cuerpo, size)) {
        throw new ModuloNoDisponible(NOMBRE, {
          cause: new Error(`${NOMBRE} respondió ${estado} con un cuerpo que no tiene la forma esperada`),
          reintentarDespuesS: config.reintentarDespuesS,
        });
      }
      return inalcanzable ? { items: [], total: cuerpo.total } : cuerpo;
    },
  };
}
