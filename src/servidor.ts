import { arrancar } from './arranque.js';

// El punto de entrada del servicio: `node dist/servidor.js`, el CMD de la imagen. Arranca con las variables del entorno y, si
// no puede, termina con 1 (RNF-05.3, RNF-06.2). Sale con `process.exit` para terminar aunque algo haya quedado abierto; lo
// que ya se registró no se pierde, porque pino vacía su búfer al salir.
await arrancar(process.env, (codigo) => process.exit(codigo));
