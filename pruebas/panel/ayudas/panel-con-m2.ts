import { construirApp as construirM2 } from '../../../src/app.js';
import { migrar } from '../../../src/bd/migraciones.js';
import { crearPool, type PoolBd } from '../../../src/bd/pool.js';
import type { Config } from '../../../src/config.js';
import { cargarContrato } from '../../../src/contrato/cargar.js';
import { manejadores } from '../../../src/operaciones/index.js';
import { crearApiM2, type ApiM2, type Identidad } from '../../../panel/cliente/src/api/m2.js';
import { CONFIG } from '../../ayudas/app.js';
import { puertoLibre } from '../../ayudas/arranque.js';
import { crearBaseDePrueba } from '../../ayudas/bd.js';
import { descartarLogs } from '../../ayudas/logs.js';
import { escuchar } from '../../ayudas/socket.js';
import { CONFIG_PANEL, crearAppPanel } from './app.js';

// El panel de verdad para las pruebas de cada pantalla: PostgreSQL real, M2 con el contrato y los manejadores del servicio, y el
// servidor del panel escuchando en un puerto. `api` es el `crearApiM2` del navegador, que pide al panel como lo haría Chrome (con
// `Origin` en lo que no es consulta); `pool` sirve para ver o preparar la base.
export type PanelConM2 = {
  pool: PoolBd;
  // Un cliente de M2 que pide con la identidad que devuelve `identidad` en cada pedido.
  api: (identidad: () => Identidad | undefined) => ApiM2;
  cerrar: () => Promise<void>;
};

export async function levantarPanelConM2(): Promise<PanelConM2> {
  const base = await crearBaseDePrueba();
  await migrar({ urlBd: base.urlBd, tiempoBdMs: 2000 });
  const pool = crearPool({ urlBd: base.urlBd, tiempoBdMs: 2000 });

  const configM2: Config = {
    ...CONFIG,
    urlBd: base.urlBd,
    claveTokens: CONFIG_PANEL.claveTokens,
    emisorTokens: CONFIG_PANEL.emisorTokens,
    audienciaTokens: CONFIG_PANEL.audienciaTokens,
    campoRoles: CONFIG_PANEL.campoRoles,
  };
  const m2 = construirM2({ config: configM2, pool, contrato: cargarContrato(), manejadores, flujoLog: descartarLogs });
  const puertoM2 = await escuchar(m2);

  // El panel solo acepta su propio Host, con el puerto configurado: escucha en el mismo que tiene en la configuración.
  const puerto = await puertoLibre();
  const panel = crearAppPanel({ config: { puerto, urlM2: `http://127.0.0.1:${puertoM2}` } });
  await panel.listen({ port: puerto, host: '127.0.0.1' });
  const origen = `http://127.0.0.1:${puerto}`;

  // El `fetch` del navegador en la página del panel: los caminos relativos van al panel, y lo que no es consulta lleva `Origin`.
  const porElPanel: typeof fetch = (entrada, init = {}) => {
    const encabezados = new Headers(init.headers);
    if ((init.method ?? 'GET').toUpperCase() !== 'GET') encabezados.set('origin', origen);
    return fetch(new URL(String(entrada), origen), { ...init, headers: encabezados });
  };

  return {
    pool,
    api: (identidad) => crearApiM2({ identidad, fetch: porElPanel }),
    async cerrar() {
      await panel.close();
      await m2.close();
      await pool.end();
      await base.borrar();
    },
  };
}
