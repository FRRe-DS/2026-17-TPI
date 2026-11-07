import { compose, esperarSano, URL_M2, URL_REALM } from './ayudas/entorno.js';

// Levanta el entorno con Keycloak real antes de la primera prueba y lo baja al terminar (spec 080, RNF-07.13). Empieza con
// `down -v`: los escenarios crean perfiles y bloqueos, y el realm se importa solo con la base de Keycloak vacía. Con
// M2_DEJAR_LEVANTADO=1 lo deja levantado al terminar, para mirarlo. Si Docker no está o algo no arranca, esto lanza un error que
// dice qué falló: la corrida termina en rojo, no saltada.
export default async function levantarEntorno(): Promise<() => Promise<void>> {
  try {
    await compose(['down', '-v']);
    await compose(['up', '-d', '--build', '--wait']);
    await esperarSano('M2', `${URL_M2}/health`);
    await esperarSano('Keycloak', `${URL_REALM}/.well-known/openid-configuration`);
  } catch (error) {
    if (process.env['M2_DEJAR_LEVANTADO'] !== '1') await compose(['down', '-v']).catch(() => undefined);
    throw error;
  }
  return async () => {
    if (process.env['M2_DEJAR_LEVANTADO'] === '1') return;
    await compose(['down', '-v']);
  };
}
