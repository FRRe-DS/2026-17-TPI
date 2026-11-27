import { describe, it, expect, vi } from 'vitest';
import { crearAlmacenSesiones, type DatosSesion } from '../../../panel/servidor/auth/sesiones.js';
import { crearRenovacion } from '../../../panel/servidor/auth/renovacion.js';
import { SesionRechazada } from '../../../panel/servidor/auth/oidc.js';
import { IdentidadNoDisponible } from '../../../panel/servidor/auth/validacion.js';
const datos = (vence = 110_000): DatosSesion => ({ sub: 'usuario', roles: ['CLIENTE'], scopes: [], credenciales: {
  accessToken: 'acceso', refreshToken: 'refresh', accessTokenVenceEn: vence, refreshTokenVenceEn: 900_000,
} });
describe('renovación compartida', () => {
  it('comparte una renovación, actualiza versión y no recrea una sesión cerrada', async () => {
    const sesiones = crearAlmacenSesiones(() => 100_000); const id = sesiones.crear(datos());
    let resolver!: (d: DatosSesion) => void;
    const renovar = vi.fn(() => new Promise<DatosSesion>(r => { resolver = r; }));
    const actual = crearRenovacion(sesiones, { renovar }, () => 100_000);
    try {
      const primero = actual.obtener(id); const segundo = actual.obtener(id);
      expect(renovar).toHaveBeenCalledTimes(1); resolver(datos(400_000));
      expect((await primero).version).toBe(1); expect((await segundo).version).toBe(1);
      const otroId = sesiones.crear(datos()); const pendiente = actual.obtener(otroId);
      sesiones.invalidar(otroId); resolver(datos(400_000));
      await expect(pendiente).rejects.toBeInstanceOf(SesionRechazada); expect(sesiones.obtener(otroId)).toBeUndefined();
    } finally { sesiones.cerrar(); }
  });
  it('usa acceso aún vigente ante caída transitoria, pero rechaza vencido o invalid_grant', async () => {
    let ahora = 100_000; const sesiones = crearAlmacenSesiones(() => ahora);
    const renovar = vi.fn(async (): Promise<DatosSesion> => { throw new IdentidadNoDisponible(); });
    const actual = crearRenovacion(sesiones, { renovar }, () => ahora);
    try {
      const id = sesiones.crear(datos()); expect((await actual.obtener(id)).sub).toBe('usuario');
      ahora = 120_000; await expect(actual.obtener(id)).rejects.toBeInstanceOf(IdentidadNoDisponible);
      renovar.mockRejectedValueOnce(new SesionRechazada());
      await expect(actual.obtener(id)).rejects.toBeInstanceOf(SesionRechazada); expect(sesiones.obtener(id)).toBeUndefined();
    } finally { sesiones.cerrar(); }
  });
});
