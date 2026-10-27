// El enrutador por `#` del panel (plan, Decisiones): funciones puras, sin React ni DOM. El navegador nunca manda el `#` al
// servidor, así que las rutas no necesitan que el servidor las conozca. Son doce pantallas; lo que no es una de ellas es
// «no encontrada», y sin sesión todo menos `#/ingresar` manda a `#/ingresar` (RNF-12.9).

export const PANTALLAS = [
  'ingresar',
  'perfil',
  'direcciones',
  'preferencias',
  'historial',
  'calificar',
  'calificaciones',
  'estado-cuenta',
  'operador',
  'otro-modulo',
  'detalle-tecnico',
  'm6-simulado',
] as const;
export type Pantalla = (typeof PANTALLAS)[number];

// `raiz` es el hash vacío; `no-encontrada` es todo lo que no se pudo interpretar. Ninguna es una de las doce.
export type Ruta = { pantalla: Pantalla; id?: string } | { pantalla: 'raiz' | 'no-encontrada' };

export const TITULOS: Record<Pantalla | 'no-encontrada', string> = {
  ingresar: 'Ingresar',
  perfil: 'Mi perfil',
  direcciones: 'Direcciones frecuentes',
  preferencias: 'Preferencias',
  historial: 'Historial de viajes',
  calificar: 'Calificar al conductor',
  calificaciones: 'Mis calificaciones',
  'estado-cuenta': 'Estado de cuenta',
  operador: 'Operador: bloqueos',
  'otro-modulo': 'Consulta de otro módulo',
  'detalle-tecnico': 'Detalle técnico',
  'm6-simulado': 'M6 simulado',
  'no-encontrada': 'Pantalla no encontrada',
};

// Qué pantallas llevan un id detrás: la dirección a editar, el viaje a calificar y la calificación a ver. Los tres son UUID.
const ID_DE_RUTA: Record<Pantalla, 'ninguno' | 'opcional' | 'obligatorio'> = {
  ingresar: 'ninguno',
  perfil: 'ninguno',
  direcciones: 'opcional',
  preferencias: 'ninguno',
  historial: 'ninguno',
  calificar: 'obligatorio',
  calificaciones: 'opcional',
  'estado-cuenta': 'ninguno',
  operador: 'ninguno',
  'otro-modulo': 'ninguno',
  'detalle-tecnico': 'ninguno',
  'm6-simulado': 'ninguno',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_ENCONTRADA: Ruta = { pantalla: 'no-encontrada' };

const esPantalla = (nombre: string | undefined): nombre is Pantalla => (PANTALLAS as readonly (string | undefined)[]).includes(nombre);

// El `location.hash` tal cual: `#/perfil`, `#/calificar/{viajeId}`. Estricto: minúsculas, sin consulta ni barras de más (una
// barra final se tolera).
export function interpretar(hash: string): Ruta {
  if (hash === '' || hash === '#' || hash === '#/') return { pantalla: 'raiz' };
  if (!hash.startsWith('#/')) return NO_ENCONTRADA;
  const [nombre, id, ...resto] = hash.slice(2).replace(/\/$/, '').split('/');
  if (resto.length > 0 || !esPantalla(nombre)) return NO_ENCONTRADA;
  const regla = ID_DE_RUTA[nombre];
  if (id === undefined) return regla === 'obligatorio' ? NO_ENCONTRADA : { pantalla: nombre };
  return regla === 'ninguno' || !UUID.test(id) ? NO_ENCONTRADA : { pantalla: nombre, id };
}

// El hash de una pantalla, el que `interpretar` entiende.
export const enlace = (pantalla: Pantalla, id?: string): string => (id === undefined ? `#/${pantalla}` : `#/${pantalla}/${id}`);

export const ROLES = ['CLIENTE', 'OPERADOR', 'SERVICIO', 'CONDUCTOR'] as const;
export type Rol = (typeof ROLES)[number];

// Adonde lleva la raíz a cada rol. El CONDUCTOR no tiene pantallas propias en M2: va al perfil, donde ve el 403 de M2.
const INICIO: Record<Rol, Pantalla> = { CLIENTE: 'perfil', OPERADOR: 'operador', SERVICIO: 'otro-modulo', CONDUCTOR: 'perfil' };
export const inicioDe = (rol: Rol): Pantalla => INICIO[rol];

export type Resolucion = { ruta: Ruta; redirigirA?: string };

// Lo que muestra el panel para un hash y una sesión. Con `redirigirA`, quien llama cambia el hash a ese valor.
export function resolver(hash: string, sesion: { rol: Rol } | undefined): Resolucion {
  const ruta = interpretar(hash);
  if (sesion === undefined) {
    return ruta.pantalla === 'ingresar' ? { ruta } : { ruta: { pantalla: 'ingresar' }, redirigirA: enlace('ingresar') };
  }
  if (ruta.pantalla === 'raiz') {
    const inicio = inicioDe(sesion.rol);
    return { ruta: { pantalla: inicio }, redirigirA: enlace(inicio) };
  }
  return { ruta };
}
