import { fileURLToPath } from 'node:url';
import { arrancarPanel, type PanelAndando } from './arranque.js';
import { cargarEntornoEjemplo } from './entorno-ejemplo.js';
import { atenderParada } from './proceso.js';

// `npm run panel`: el panel como proceso en la máquina, sin Docker. Es `main.ts` con los valores de `ejemplo.env` para lo que el
// entorno no define (RNF-06.4), así que sirve para probar contra el `docker compose up` de M2 y el `m6` del perfil `panel`.
// Compilado queda en `panel/dist/servidor/`, y `ejemplo.env` tres carpetas más arriba, en la raíz del repositorio.
const EJEMPLO = fileURLToPath(new URL('../../../ejemplo.env', import.meta.url));

// En un objeto porque la parada puede llegar antes de que `arrancarPanel` termine y tiene que ver el panel cuando exista.
const servicio: { panel: PanelAndando | undefined } = { panel: undefined };
atenderParada(() => servicio.panel?.detener, (codigo) => process.exit(codigo));
servicio.panel = await arrancarPanel(cargarEntornoEjemplo(process.env, EJEMPLO), (codigo) => process.exit(codigo));
