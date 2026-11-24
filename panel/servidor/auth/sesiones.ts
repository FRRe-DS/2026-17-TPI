import { crearAlmacen, type Reloj } from './almacen.js';
import type { Pedido } from '../pedidos.js';

const MAXIMO_ABSOLUTO_MS = 8 * 60 * 60_000;
const INACTIVIDAD_MS = 30 * 60_000;

export type CredencialesSesion = {
  accessToken: string;
  refreshToken: string;
  accessTokenVenceEn: number;
  refreshTokenVenceEn: number;
};

// Solo credenciales ya validadas por OIDC. Los vencimientos se expresan como instantes Unix en milisegundos.
export type DatosSesion = {
  sub: string;
  roles: string[];
  scopes: string[];
  nombre?: string;
  credenciales: CredencialesSesion;
};

export type Sesion = DatosSesion & {
  pedidos?: Pedido[];
  creadaEn: number;
  ultimaActividadEn: number;
  venceEn: number;
  version: number;
};

export function crearAlmacenSesiones(ahora: Reloj = Date.now) {
  const almacen = crearAlmacen<Sesion>((sesion, instante) => instante >= Math.min(
    sesion.venceEn, sesion.ultimaActividadEn + INACTIVIDAD_MS, sesion.credenciales.refreshTokenVenceEn,
  ), ahora);

  return {
    crear(datos: DatosSesion): string {
      const instante = ahora();
      if (!Number.isFinite(datos.credenciales.accessTokenVenceEn)
        || !Number.isFinite(datos.credenciales.refreshTokenVenceEn)
        || datos.credenciales.refreshTokenVenceEn <= instante) {
        throw new Error('Vencimiento de credenciales inválido');
      }
      return almacen.crear({ ...datos, creadaEn: instante, ultimaActividadEn: instante,
        venceEn: instante + MAXIMO_ABSOLUTO_MS, version: 0 });
    },
    // Leer (por ejemplo /auth/sesion) nunca cuenta como actividad de la API autenticada.
    obtener: almacen.obtener,
    registrarPedido(id: string, pedido: Pedido): void {
      const sesion = almacen.obtener(id);
      if (sesion) almacen.actualizar(id, { ...sesion, pedidos: [pedido, ...(sesion.pedidos ?? [])].slice(0, 50) });
    },
    actualizarCredenciales(id: string, version: number, datos: DatosSesion): boolean {
      const sesion = almacen.obtener(id);
      if (!sesion || sesion.version !== version || sesion.sub !== datos.sub) return false;
      return almacen.actualizar(id, { ...sesion, ...datos, version: version + 1 });
    },
    registrarActividad(id: string | undefined): boolean {
      const sesion = almacen.obtener(id);
      if (sesion === undefined) return false;
      return almacen.actualizar(id, { ...sesion, ultimaActividadEn: ahora() });
    },
    invalidar: almacen.eliminar,
    cantidad: almacen.cantidad,
    limpiar: almacen.limpiar,
    cerrar: almacen.cerrar,
  };
}
