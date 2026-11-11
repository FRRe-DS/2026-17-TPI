import type { components } from '../generado/contrato.js';

export type ViajeResumen = components['schemas']['ViajeResumen'];
export type PaginaViajes = components['schemas']['PaginaViajes'];

// Lo que M2 usa de un viaje de M6 (`TripSummary`): el resto de sus campos no se lee ni se devuelve (spec 007, Decisiones).
// M6 no declara campos obligatorios: `clientId` y `driverId` pueden faltar o venir nulos.
export type ViajeM6 = {
  id: string;
  state: string;
  clientId?: string | null;
  driverId?: string | null;
};

// La página que devuelve M6: sus viajes y el total del cliente. Su forma la comprueba `m6.ts` antes de llegar acá.
export type PaginaM6 = {
  items: ViajeM6[];
  total: number;
};

// El `page` de M2 empieza en 0 y el de M6 en 1; el tamaño es el mismo (spec 007, Casos límite).
export const aPaginaDeM6 = (page: number): number => page + 1;

// El contrato no le pone máximo a `page`. Una página cuyo desplazamiento (`page * size`) no es un entero seguro no puede tener
// viajes, y su número no se puede mandar a M6 como un entero: `1e21` saldría como `1e+21` (RF-2.4.3; plan 007, Decisiones).
export const paginaInalcanzable = (page: number, size: number): boolean => page * size > Number.MAX_SAFE_INTEGER;

// El rango en que se acepta el `Retry-After` de M6, en segundos: el mismo de `M2_REINTENTAR_DESPUES_S`.
const ESPERA_MINIMA_S = 1;
const ESPERA_MAXIMA_S = 3600;
const SOLO_DIGITOS = /^[0-9]+$/;

// Los segundos del `Retry-After` con que M2 responde el 503 ante un 429 de M6 (RF-2.4.15): los que informa M6, si `texto` (su
// `Retry-After` tal como llegó) son solo dígitos y el número va de 1 a 3600; si no, `porDefecto`, el valor configurado. Los
// ceros a la izquierda valen (`030` es 30). No valen el encabezado ausente o vacío, el `0`, un número mayor, un signo,
// decimales, una unidad, una fecha HTTP ni el encabezado repetido, que llega como `30, 30`.
export function segundosDeEspera(texto: string | undefined, porDefecto: number): number {
  if (texto === undefined || !SOLO_DIGITOS.test(texto)) return porDefecto;
  const segundos = Number(texto);
  return segundos >= ESPERA_MINIMA_S && segundos <= ESPERA_MAXIMA_S ? segundos : porDefecto;
}

// El estado va tal como lo informa M6 (RF-2.4.1). Sin `driverId` (por ejemplo, un viaje cancelado antes de asignar conductor),
// el viaje va sin `conductorId`.
export function aViajeResumen(viaje: ViajeM6): ViajeResumen {
  return {
    viajeId: viaje.id,
    estado: viaje.state,
    ...(viaje.driverId ? { conductorId: viaje.driverId } : {}),
  };
}

// Un viaje de otro cliente, o sin `clientId`, no sale en la respuesta (RF-2.4.9). Un UUID no distingue mayúsculas, así que se
// comparan en minúsculas. El total es el de M6 aunque se descarte alguno: el filtro de M6 es el que cuenta. Quien llama
// registra el descarte con la diferencia entre `cuerpoM6.items` y `items`, sin identificadores.
export function aPaginaViajes(cuerpoM6: PaginaM6, clienteId: string, page: number, size: number): PaginaViajes {
  const propio = clienteId.toLowerCase();
  return {
    page,
    size,
    totalElementos: cuerpoM6.total,
    totalPaginas: Math.ceil(cuerpoM6.total / size),
    items: cuerpoM6.items.filter((viaje) => viaje.clientId?.toLowerCase() === propio).map(aViajeResumen),
  };
}

// Agrega `calificado` a cada viaje de la página (RF-2.5.14): si el cliente ya calificó al conductor de ese viaje, dato de M2.
// `calificados` son los viajes calificados que devuelve la base, con los ids en minúsculas; los de M6 se comparan en
// minúsculas, porque un UUID no distingue mayúsculas. Es pura: no cambia la página que recibe.
export function conCalificado(pagina: PaginaViajes, calificados: ReadonlySet<string>): PaginaViajes {
  return {
    ...pagina,
    items: pagina.items.map((viaje) => ({ ...viaje, calificado: calificados.has(viaje.viajeId.toLowerCase()) })),
  };
}
