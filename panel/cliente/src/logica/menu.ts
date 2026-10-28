import { TITULOS, type Pantalla, type Rol, type Ruta } from '../rutas.js';

// El menú lateral según el rol (T17). Cada rol ve sus pantallas y las herramientas de quien evalúa; «Calificar» no está en
// ningún menú porque se llega desde un viaje del historial.
export type ElementoDeMenu = { pantalla: Pantalla; etiqueta: string };
export type GrupoDeMenu = { titulo: string; elementos: ElementoDeMenu[] };

const elemento = (pantalla: Pantalla, etiqueta = TITULOS[pantalla]): ElementoDeMenu => ({ pantalla, etiqueta });

const HERRAMIENTAS: GrupoDeMenu = { titulo: 'Herramientas', elementos: [elemento('detalle-tecnico'), elemento('m6-simulado'), elemento('demostracion')] };

const PROPIO: Record<Rol, GrupoDeMenu> = {
  CLIENTE: {
    titulo: 'Mi cuenta',
    elementos: [
      elemento('perfil'),
      elemento('direcciones'),
      elemento('preferencias'),
      elemento('historial'),
      elemento('calificaciones'),
      elemento('estado-cuenta'),
    ],
  },
  OPERADOR: { titulo: 'Operación', elementos: [elemento('operador', 'Bloqueos de clientes')] },
  SERVICIO: { titulo: 'Otro módulo', elementos: [elemento('otro-modulo', 'Consultar estado de cuenta')] },
  // El CONDUCTOR no tiene pantallas en M2: entra al perfil para ver el 403.
  CONDUCTOR: { titulo: 'Conductor', elementos: [elemento('perfil', 'Perfil de un cliente')] },
};

export function menuDe(rol: Rol | undefined): GrupoDeMenu[] {
  if (rol === undefined) return [{ titulo: 'Panel', elementos: [elemento('ingresar')] }];
  return [PROPIO[rol], HERRAMIENTAS];
}

// El elemento del menú que se marca como actual: la pantalla misma, salvo «Calificar», que pertenece al historial.
export function marcadaEn(ruta: Ruta): Pantalla | undefined {
  if (ruta.pantalla === 'raiz' || ruta.pantalla === 'no-encontrada') return undefined;
  return ruta.pantalla === 'calificar' ? 'historial' : ruta.pantalla;
}
