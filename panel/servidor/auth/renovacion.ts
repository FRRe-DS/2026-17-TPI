import type { crearAlmacenSesiones, Sesion } from './sesiones.js';
import { SesionRechazada, type ClienteOidc } from './oidc.js';
import { CredencialInvalida, IdentidadNoDisponible } from './validacion.js';

export function crearRenovacion(sesiones: ReturnType<typeof crearAlmacenSesiones>, oidc: Pick<ClienteOidc, 'renovar'>, ahora = Date.now) {
  const pendientes = new Map<string, Promise<Sesion>>();
  async function ejecutar(id: string, sesion: Sesion): Promise<Sesion> {
    try {
      const datos = await oidc.renovar(sesion.credenciales.refreshToken, sesion.sub);
      if (!sesiones.actualizarCredenciales(id, sesion.version, datos)) throw new SesionRechazada();
      const actual = sesiones.obtener(id);
      if (!actual) throw new SesionRechazada();
      return actual;
    } catch (error) {
      if (error instanceof SesionRechazada || error instanceof CredencialInvalida) {
        sesiones.invalidar(id); throw new SesionRechazada();
      }
      const actual = sesiones.obtener(id);
      if (!actual) throw new SesionRechazada();
      if (actual.credenciales.accessTokenVenceEn > ahora()) return actual;
      throw new IdentidadNoDisponible();
    }
  }
  return {
    async obtener(id: string): Promise<Sesion> {
      const sesion = sesiones.obtener(id);
      if (!sesion) throw new SesionRechazada();
      if (sesion.credenciales.accessTokenVenceEn - ahora() >= 30_000) return sesion;
      let pendiente = pendientes.get(id);
      if (!pendiente) {
        pendiente = ejecutar(id, sesion).finally(() => { pendientes.delete(id); });
        pendientes.set(id, pendiente);
      }
      return pendiente;
    },
  };
}
export type Renovacion = ReturnType<typeof crearRenovacion>;
