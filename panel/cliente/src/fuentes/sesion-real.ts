import { ROLES, type Rol } from '../rutas.js';
export type SesionReal = { sub: string; roles: Rol[]; scopes: string[] };
export type EstadoSesionReal = { estado: 'cargando' | 'activa' | 'sin-sesion' | 'no-disponible'; sesion?: SesionReal };
export function crearSesionReal(pedir: typeof fetch = fetch) {
  let actual: EstadoSesionReal = { estado: 'cargando' };
  const oyentes = new Set<() => void>(); let pendiente: Promise<void> | undefined;
  const publicar = (estado: EstadoSesionReal) => { actual = estado; for (const avisar of oyentes) avisar(); };
  return {
    actual: () => actual,
    suscribir(avisar: () => void) { oyentes.add(avisar); return () => { oyentes.delete(avisar); }; },
    vencer() { publicar({ ...actual, estado: 'sin-sesion' }); },
    actualizar(): Promise<void> {
      if (!pendiente) pendiente = (async () => {
        try {
          const respuesta = await pedir('/auth/sesion', { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(15_000) });
          if (respuesta.status === 401) { publicar({ ...actual, estado: 'sin-sesion' }); return; }
          if (!respuesta.ok) throw new Error('Identidad no disponible');
          const datos = await respuesta.json() as Record<string, unknown>;
          if (typeof datos.sub !== 'string' || !datos.sub || !Array.isArray(datos.roles) || !Array.isArray(datos.scopes)
            || !datos.scopes.every(scope => typeof scope === 'string')) throw new Error('Respuesta inválida');
          publicar({ estado: 'activa', sesion: { sub: datos.sub, roles: datos.roles.filter((rol): rol is Rol => ROLES.includes(rol as Rol)), scopes: datos.scopes } });
        } catch { publicar({ ...actual, estado: 'no-disponible' }); }
      })().finally(() => { pendiente = undefined; });
      return pendiente;
    },
  };
}
