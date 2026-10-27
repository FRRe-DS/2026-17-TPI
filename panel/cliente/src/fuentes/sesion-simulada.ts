import { ROLES, type Rol } from '../rutas.js';
import type { FuenteDeSesion, Sesion } from './fuente-de-sesion.js';

export const ETIQUETA_SESION = 'simulado, pendiente de M1';
// Lo único guardado: `{ rol, sub }`, en el almacenamiento de sesión (se borra al cerrar la pestaña).
export const CLAVE_DE_SESION = 'panel.sesion';
// El `sub` de un token tiene de 1 a 128 caracteres (plan, Token por pedido).
const LARGO_MAXIMO_SUB = 128;

// Lo mínimo que se usa de `sessionStorage`: se pasa de afuera para probar sin navegador y cuando el navegador lo bloquea.
export type Almacenamiento = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const esRol = (valor: unknown): valor is Rol => (ROLES as readonly unknown[]).includes(valor);
const esSub = (valor: unknown): valor is string => typeof valor === 'string' && valor.length >= 1 && valor.length <= LARGO_MAXIMO_SUB;

// Lo guardado puede estar roto o haberlo escrito otra cosa: se toma `rol` y `sub` si son válidos, y nada más.
function interpretar(texto: string | null): Sesion | undefined {
  if (texto === null) return undefined;
  try {
    const guardado: unknown = JSON.parse(texto);
    if (typeof guardado !== 'object' || guardado === null) return undefined;
    const { rol, sub } = guardado as Record<string, unknown>;
    return esRol(rol) && esSub(sub) ? { rol, sub } : undefined;
  } catch {
    return undefined;
  }
}

// La sesión vive en memoria mientras la página está abierta; el almacenamiento sirve para recuperarla al recargar. Si el navegador
// lo bloquea (modo privado, datos de sitio desactivados), la sesión sigue andando y solo se pierde al recargar (RNF-12.9).
export function crearSesionSimulada(almacenamiento: Almacenamiento | undefined): FuenteDeSesion {
  const intentar = <T>(accion: (a: Almacenamiento) => T): T | undefined => {
    if (almacenamiento === undefined) return undefined;
    try {
      return accion(almacenamiento);
    } catch {
      return undefined;
    }
  };

  let sesion = interpretar(intentar((a) => a.getItem(CLAVE_DE_SESION)) ?? null);

  return {
    etiqueta: ETIQUETA_SESION,
    iniciar(rol, sub) {
      if (!esRol(rol)) throw new Error('El rol no es uno de los conocidos.');
      const limpio = typeof sub === 'string' ? sub.trim() : sub;
      if (!esSub(limpio)) throw new Error(`El identificador tiene que tener de 1 a ${LARGO_MAXIMO_SUB} caracteres.`);
      sesion = { rol, sub: limpio };
      intentar((a) => a.setItem(CLAVE_DE_SESION, JSON.stringify(sesion)));
    },
    cerrar() {
      sesion = undefined;
      intentar((a) => a.removeItem(CLAVE_DE_SESION));
    },
    actual: () => sesion,
  };
}

// Un almacenamiento del navegador (el de sesión, salvo que se pida el local), o nada si ni siquiera se puede nombrar (algunos
// navegadores lanzan al leerlo).
export function almacenamientoDelNavegador(cual: 'sessionStorage' | 'localStorage' = 'sessionStorage'): Almacenamiento | undefined {
  try {
    return globalThis[cual];
  } catch {
    return undefined;
  }
}
