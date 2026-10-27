import type { Rol } from '../rutas.js';

// De dónde sale la sesión (RNF-02.2): las pantallas piden la sesión a esta interfaz y no saben de dónde viene. Hoy la implementa
// `sesion-simulada.ts`; cuando exista M1 se cambia esa implementación y el panel deja de firmar los tokens.
// La sesión es el rol y el identificador (`sub`) de quien entró. Nunca un token (RNF-19.3): el servidor del panel lo firma por pedido.
export type Sesion = { rol: Rol; sub: string };

export interface FuenteDeSesion {
  // «simulado, pendiente de M1»: lo que las pantallas muestran junto a lo que depende de esta fuente (RNF-12.7).
  readonly etiqueta: string;
  // Reemplaza la sesión actual. Con un rol o un identificador inválido falla sin cambiarla.
  iniciar(rol: Rol, sub: string): void;
  // Olvida el rol y el cliente actuales (RNF-12.9).
  cerrar(): void;
  actual(): Sesion | undefined;
}
