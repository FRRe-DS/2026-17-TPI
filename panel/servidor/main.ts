import { arrancarPanel, type PanelAndando } from './arranque.js';
import { atenderParada } from './proceso.js';

// El punto de entrada del panel: `node panel/dist/servidor/main.js`, el CMD de la imagen `panel`. Arranca con las variables del
// entorno, que en el contenedor define docker compose. Para correr el panel en la máquina con los valores de `ejemplo.env`, ver
// `npm run panel` (T13).
// En un objeto porque la parada puede llegar antes de que `arrancarPanel` termine y tiene que ver el panel cuando exista.
const servicio: { panel: PanelAndando | undefined } = { panel: undefined };
atenderParada(() => servicio.panel?.detener, (codigo) => process.exit(codigo));
servicio.panel = await arrancarPanel(process.env, (codigo) => process.exit(codigo));
