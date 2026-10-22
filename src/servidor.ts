import { arrancar } from './arranque.js';

// Las señales de parada: SIGTERM es la de `docker stop` y `docker compose stop`; SIGINT, la de Ctrl+C en una terminal.
const SENALES_DE_PARADA = ['SIGTERM', 'SIGINT'] as const;

// El punto de entrada del servicio: `node dist/servidor.js`, el CMD de la imagen. Arranca con las variables del entorno y, si
// no puede, termina con 1 (RNF-05.3, RNF-06.2). Sale con `process.exit` para terminar aunque algo haya quedado abierto; lo
// que ya se registró no se pierde, porque pino vacía su búfer al salir.
const servicio = await arrancar(process.env, (codigo) => process.exit(codigo));

// Ya andando, una señal de parada lo detiene en orden y sale con 0 (RNF-04.5). Otra señal no cambia nada: la parada es una
// sola, y el corte la termina igual. Mientras arranca, una señal hace lo de siempre en Node: termina el proceso.
if (servicio) for (const senal of SENALES_DE_PARADA) process.on(senal, () => void servicio.detener());
