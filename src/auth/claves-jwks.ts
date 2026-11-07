import { createRemoteJWKSet } from 'jose';

// Las claves públicas con las que se validan los tokens en modo `jwks` (RNF-12.11). `jose` las pide a `urlJwks` con el primer
// token que las necesita y las guarda en memoria, así que no se llama a Keycloak en cada solicitud.
export const crearClaves = (urlJwks: string) => createRemoteJWKSet(new URL(urlJwks));
