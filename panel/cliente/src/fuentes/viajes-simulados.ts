// La fuente de los viajes (RNF-02.2): hoy es el M6 simulado del propio panel, al que se llega por `/panel/m6/…`. Esta es la
// segunda mitad de los puntos de conexión; el ejemplo, los escenarios y el modo se suman cuando las pantallas los piden
// (T21 y T32). Cuando exista M6 se cambia esta fuente y las pantallas quedan.
export const ETIQUETA_VIAJES = 'simulado, pendiente de M6';

export const fuenteDeViajes = { etiqueta: ETIQUETA_VIAJES } as const;
