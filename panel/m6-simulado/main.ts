import { atenderParada } from '../servidor/proceso.js';
import { arrancarM6, type M6Andando } from './arranque.js';

// El punto de entrada del M6 simulado: `node panel/dist/m6-simulado/main.js`, el CMD de la imagen `m6-simulado`. Arranca con las
// variables del entorno, que define docker compose.
// En un objeto porque la parada puede llegar antes de que `arrancarM6` termine y tiene que ver el servicio cuando exista.
const servicio: { m6: M6Andando | undefined } = { m6: undefined };
atenderParada(() => servicio.m6?.detener, (codigo) => process.exit(codigo));
servicio.m6 = await arrancarM6(process.env, (codigo) => process.exit(codigo));
