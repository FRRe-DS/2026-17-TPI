import { arrancar, type Servicio } from './arranque.js';

// Las señales de parada: SIGTERM es la de `docker stop` y `docker compose stop`; SIGINT, la de Ctrl+C en una terminal.
const SENALES_DE_PARADA = ['SIGTERM', 'SIGINT'] as const;

// El punto de entrada del servicio: `node dist/servidor.js`, el CMD de la imagen. Arranca con las variables del entorno y, si
// no puede, termina con 1 (RNF-05.3, RNF-06.2). Sale con `process.exit` para terminar aunque algo haya quedado abierto; lo
// que ya se registró no se pierde, porque pino vacía su búfer al salir.
//
// Atiende las señales desde antes de arrancar (RNF-04.5, plan Lógica 12 y 13). Mientras arranca, una señal aborta la
// `parada`: arrancar deja de arrancar y sale con 0, en vez del 143 (130 con SIGINT) que daría Node. Ya andando, lo detiene en
// orden y sale con 0. Otra señal no cambia nada: la parada es una sola, y el corte la termina igual. Por eso `on` y no
// `once`: con `once`, la segunda señal terminaría el proceso sin esperar.
const parada = new AbortController();
// Con `const servicio = await arrancar(…)`, una señal durante el arranque leería `servicio` antes de que exista y fallaría.
let servicio: Servicio | undefined = undefined;
for (const senal of SENALES_DE_PARADA) {
  process.on(senal, () => {
    if (servicio) void servicio.detener();
    else parada.abort();
  });
}
servicio = await arrancar(process.env, (codigo) => process.exit(codigo), { parada: parada.signal });
