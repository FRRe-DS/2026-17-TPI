import { compose, descripcionDeFalla, PROYECTO, URL_M2, URL_M6 } from './ayudas/entorno.js';

// Levanta el entorno distribuido antes de la primera prueba y lo baja al terminar (spec 081, RNF-07.7). Con M2_DEJAR_LEVANTADO=1 lo
// deja levantado para mirarlo o repetir la corrida. Si Docker no está o el build falla, esto lanza un error que dice qué falló:
// la corrida termina en rojo, no saltada.
async function esperarSalud(nombre: string, url: string): Promise<void> {
  const limite = Date.now() + 60_000;
  let ultimo = 'sin respuesta';
  while (Date.now() < limite) {
    try {
      const respuesta = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
      if (respuesta.ok) return;
      ultimo = `respondió ${respuesta.status}`;
    } catch (error) {
      ultimo = descripcionDeFalla(`GET ${url}/health`, error);
    }
    await new Promise((resolver) => setTimeout(resolver, 1000));
  }
  throw new Error(`${nombre} no quedó sano en 60 s (${ultimo}). El proyecto de compose es «${PROYECTO}».`);
}

export default async function levantarEntorno(): Promise<() => Promise<void>> {
  try {
    await compose(['up', '-d', '--build', '--wait']);
    await esperarSalud('M2', URL_M2);
    await esperarSalud('M6', URL_M6);
  } catch (error) {
    // Lo que alcanzó a levantarse no queda colgado, salvo que la persona haya pedido dejarlo.
    if (process.env['M2_DEJAR_LEVANTADO'] !== '1') await compose(['down', '-v']).catch(() => undefined);
    throw error;
  }
  return async () => {
    if (process.env['M2_DEJAR_LEVANTADO'] === '1') return;
    await compose(['down', '-v']);
  };
}
