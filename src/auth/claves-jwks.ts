import { createRemoteJWKSet } from 'jose';

// Cada cuánto, como mucho, se vuelven a pedir las claves por un `kid` que no se tiene, contado desde la última obtención
// (RNF-12.16). Sin este tope, muchos tokens con `kid` inventados serían muchos pedidos a Keycloak.
const ESPERA_ENTRE_PEDIDOS_MS = 30_000;

// Las claves públicas con las que se validan los tokens en modo `jwks` (RNF-12.11). `jose` las pide a `urlJwks` con el primer
// token que las necesita y las guarda en memoria, así que no se llama a Keycloak en cada solicitud. Un `kid` que no está da
// `JWKSNoMatchingKey` (401, RNF-12.19), y se vuelve a pedir solo pasado el tope.
export const crearClaves = (urlJwks: string) =>
  createRemoteJWKSet(new URL(urlJwks), { cooldownDuration: ESPERA_ENTRE_PEDIDOS_MS });
