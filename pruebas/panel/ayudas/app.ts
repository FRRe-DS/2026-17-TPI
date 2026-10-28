import type { Writable } from 'node:stream';
import type { ConfigPanel } from '../../../panel/servidor/config.js';
import { construirApp } from '../../../panel/servidor/app.js';
import { descartarLogs } from '../../ayudas/logs.js';

export const PUERTO_PANEL = 8083;

// La configuración del panel en las pruebas: la de ejemplo.env, con una clave de prueba.
export const CONFIG_PANEL: ConfigPanel = {
  puerto: PUERTO_PANEL,
  escucha: '127.0.0.1',
  urlM2: 'http://localhost:8082',
  urlM2Publica: 'http://localhost:8082',
  urlM6Control: 'http://localhost:3007',
  urlBd: undefined,
  docker: true,
  servicioBd: 'bd',
  claveTokens: 'clave-de-prueba-de-32-caracteres!',
  emisorTokens: 'm1-identidad',
  audienciaTokens: 'm2-clientes',
  campoRoles: 'roles',
};

// Los encabezados de una persona que abre el panel desde la propia máquina. `inject` pone `localhost:80` de Host si no se lo
// indica, y el panel lo rechazaría.
export const DESDE_EL_PANEL = { host: `127.0.0.1:${PUERTO_PANEL}` };
export const DESDE_EL_PANEL_CON_ORIGEN = { ...DESDE_EL_PANEL, origin: `http://127.0.0.1:${PUERTO_PANEL}` };

export function crearAppPanel(
  opciones: { config?: Partial<ConfigPanel>; flujoLog?: Writable; esperaM2Ms?: number; esperaControlMs?: number; directorioCliente?: string | undefined } = {},
) {
  return construirApp({
    config: { ...CONFIG_PANEL, ...opciones.config },
    flujoLog: opciones.flujoLog ?? descartarLogs,
    esperaM2Ms: opciones.esperaM2Ms,
    esperaControlMs: opciones.esperaControlMs,
    directorioCliente: opciones.directorioCliente,
  });
}
