// El token con el que M2 se presenta ante M6 (spec 125). Dos implementaciones con la misma forma, elegidas al arrancar: con las
// variables de Keycloak, el token se pide por `client_credentials` (RF-2.4.11.1); sin ellas, M2 firma el HS256 de siempre
// (RF-2.4.11.2, RF-2.4.11 de la spec 007).
import type { Config, ConfigTokens } from '../config.js';
import { tokenDeServicio } from './tokens.js';

// `reutilizado` dice si el token salió de la memoria y no se pidió durante esta operación: solo a uno reutilizado le corresponde
// la renovación ante un `401` de M6 (RF-2.4.11.8).
export type TokenObtenido = { token: string; reutilizado: boolean };

export type TokenServicio = {
  modo: 'keycloak' | 'hs256';
  // El id de correlación es el de la operación que pide el token: va en la línea del pedido a Keycloak (RNF-14.15).
  obtener(idCorrelacion: string): Promise<TokenObtenido>;
  // Olvida el token guardado, si es este, para que el siguiente `obtener` pida otro (RF-2.4.11.8).
  descartar(token: string): void;
};

// Sin `tokenServicio` (las pruebas que arman la configuración a mano) es lo mismo que sin las variables de Keycloak.
type ConfigTokenServicio = ConfigTokens & Pick<Config, 'audienciaM6'> & Partial<Pick<Config, 'tokenServicio'>>;

// El HS256 de RF-2.4.11: uno nuevo en cada pedido, de 60 s, que nunca se guarda. No hay nada que descartar.
export function crearTokenServicioHs256(config: ConfigTokens & Pick<Config, 'audienciaM6'>): TokenServicio {
  return {
    modo: 'hs256',
    obtener: async () => ({ token: await tokenDeServicio(config), reutilizado: false }),
    descartar: () => undefined,
  };
}

export function crearTokenServicio(config: ConfigTokenServicio): TokenServicio {
  return crearTokenServicioHs256(config);
}
