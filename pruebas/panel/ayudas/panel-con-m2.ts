import { construirApp as construirM2 } from '../../../src/app.js';
import { migrar } from '../../../src/bd/migraciones.js';
import { crearPool, type PoolBd } from '../../../src/bd/pool.js';
import type { Config } from '../../../src/config.js';
import { cargarContrato } from '../../../src/contrato/cargar.js';
import { manejadores } from '../../../src/operaciones/index.js';
import { crearApiM2, type ApiM2, type Identidad } from '../../../panel/cliente/src/api/m2.js';
import { crearApiPanel, type ApiPanel } from '../../../panel/cliente/src/api/panel.js';
import type { UltimoPedido } from '../../../panel/cliente/src/logica/ultimo-pedido.js';
import { crearViajesSimulados, type FuenteDeViajes } from '../../../panel/cliente/src/fuentes/viajes-simulados.js';
import { construirAppControl } from '../../../panel/m6-simulado/app-control.js';
import { crearBaseDemo } from '../../../panel/servidor/demo/base.js';
import { ComandoDockerFallido } from '../../../panel/servidor/demo/docker.js';
import { construirAppM6 } from '../../../panel/m6-simulado/app-m6.js';
import { crearEstadoM6 } from '../../../panel/m6-simulado/estado.js';
import { crearPuertoApi } from '../../../panel/m6-simulado/puerto-api.js';
import { CONFIG } from '../../ayudas/app.js';
import { puertoLibre } from '../../ayudas/arranque.js';
import { crearBaseDePrueba } from '../../ayudas/bd.js';
import { descartarLogs } from '../../ayudas/logs.js';
import { crearProxy, type ProxyDeBase } from '../../ayudas/proxy.js';
import { escuchar } from '../../ayudas/socket.js';
import { CONFIG_PANEL, crearAppPanel } from './app.js';
import { CONFIG_M6 } from './m6.js';

// M2 espera poco a M6 y el lento tarda más: con un reintento, M2 se rinde en menos de un segundo y responde 503.
export const ESPERA_DE_M2_MS = 300;
export const RETARDO_LENTO_MS = 1500;
export const REINTENTAR_DESPUES_S = 7;

// El panel de verdad para las pruebas de cada pantalla: PostgreSQL real, M2 con el contrato y los manejadores del servicio, y el
// servidor del panel escuchando en un puerto. `api` es el `crearApiM2` del navegador, que pide al panel como lo haría Chrome (con
// `Origin` en lo que no es consulta); `pool` sirve para ver o preparar la base.
// Docker de mentira para la sección «Base de datos» (spec 072, T16): la base de M2 está detrás de un proxy TCP; «apagar» lo cierra
// (M2 pierde la base y su salud da 503) y «encender» lo reabre, sin tocar el contenedor que comparten todas las pruebas.
export type DockerDeMentira = {
  // Lo que pidió el panel, en orden: 'apagar' o 'encender'.
  llamadas: string[];
  // El próximo «encender» no reabre el proxy: M2 no vuelve a tener base («no volvió»).
  noVolver: () => void;
  // El próximo comando falla con este mensaje, como cuando Docker lo rechaza.
  fallar: (mensaje: string) => void;
  // La base de M2 otra vez a mano, sin llamadas anotadas y sin fallas pendientes. Va después de cada prueba.
  reponer: () => Promise<void>;
};

export type PanelConM2 = {
  pool: PoolBd;
  // El M6 simulado de punta a punta (API y canal de control), con la fuente de viajes que usa el navegador.
  viajes: FuenteDeViajes;
  // Cambia el modo del M6 simulado (el de todos: quien lo cambia lo deja en normal).
  ponerModo: (modo: 'normal' | 'lento' | 'caido') => Promise<void>;
  // El M6 simulado visto por dentro, para comprobar qué guardó.
  estadoM6: ReturnType<typeof crearEstadoM6>;
  // Un cliente de M2 que pide con la identidad que devuelve `identidad` en cada pedido.
  // `alTerminar` recibe lo mismo que la franja del pie.
  api: (identidad: () => Identidad | undefined, alTerminar?: (pedido: UltimoPedido) => void) => ApiM2;
  // Lo que el navegador le pide al panel y no a M2: el detalle técnico y el canal de control.
  apiPanel: ApiPanel;
  // Donde escucha el panel (`http://127.0.0.1:{puerto}`): lo que abre Chrome en la prueba en navegador.
  origen: string;
  // El `fetch` de la página del panel: los caminos relativos van al panel y lo que no es consulta lleva `Origin`.
  fetchDelPanel: typeof fetch;
  // Donde escuchan M2 y el canal de control del M6 simulado, y la base de M2: lo que el servidor del panel usa sin pasar por el
  // reenvío (spec 072: pruebas simultáneas y acceso a la base).
  urlM2: string;
  urlM6Control: string;
  urlBd: string;
  // Detiene M2 y lo vuelve a levantar en el mismo puerto, con la misma base: «M2 no responde» y la recuperación (RNF-15.4).
  detenerM2: () => Promise<void>;
  arrancarM2: () => Promise<void>;
  // Con `dockerDeMentira`, el Docker que ve el panel; sin la opción, el panel no tiene Docker (como en su contenedor).
  docker: DockerDeMentira;
  cerrar: () => Promise<void>;
};

function crearDockerDeMentira(proxy: ProxyDeBase | undefined) {
  const llamadas: string[] = [];
  let volver = true;
  let falla: string | undefined;
  const disponible = { disponible: true };

  const comando = async (nombre: 'apagar' | 'encender', hacer: () => Promise<void>) => {
    llamadas.push(nombre);
    if (falla !== undefined) {
      const mensaje = falla;
      falla = undefined;
      throw new ComandoDockerFallido(mensaje);
    }
    await hacer();
  };

  const docker: DockerDeMentira = {
    llamadas,
    noVolver: () => void (volver = false),
    fallar: (mensaje) => void (falla = mensaje),
    async reponer() {
      llamadas.length = 0;
      volver = true;
      falla = undefined;
      await proxy?.reabrir();
    },
  };
  const control = {
    disponibilidad: async () => disponible,
    apagar: () => comando('apagar', async () => proxy?.cerrar()),
    encender: () =>
      comando('encender', async () => {
        if (volver) await proxy?.reabrir();
      }),
  };
  return { docker, control };
}

// `directorioCliente`: la carpeta del cliente compilado, para que el panel también sirva las pantallas (prueba en navegador).
// `dockerDeMentira`: el panel tiene Docker y la base de M2 se puede apagar y encender (T16).
export async function levantarPanelConM2(opciones: { directorioCliente?: string; dockerDeMentira?: boolean } = {}): Promise<PanelConM2> {
  const base = await crearBaseDePrueba();
  await migrar({ urlBd: base.urlBd, tiempoBdMs: 2000 });
  const pool = crearPool({ urlBd: base.urlBd, tiempoBdMs: 2000 });
  // Con Docker de mentira, M2 llega a la base por el proxy; `pool` (el de la prueba) y el panel, directo.
  const proxy = opciones.dockerDeMentira === true ? await crearProxy(base.urlBd) : undefined;
  const poolM2 = proxy === undefined ? pool : crearPool({ urlBd: proxy.urlBd, tiempoBdMs: 2000 });
  const mentira = crearDockerDeMentira(proxy);
  const baseDemo = proxy === undefined ? undefined : crearBaseDemo(base.urlBd);

  const estadoM6 = crearEstadoM6();
  const puertoApiM6 = await puertoLibre();
  const puertoControlM6 = await puertoLibre();
  const configM6 = { ...CONFIG_M6, puerto: puertoApiM6, puertoControl: puertoControlM6, retardoLentoMs: RETARDO_LENTO_MS };
  const apiM6 = crearPuertoApi({
    puerto: puertoApiM6,
    escucha: '127.0.0.1',
    construir: () => construirAppM6({ config: configM6, estado: estadoM6, flujoLog: descartarLogs }),
  });
  await apiM6.abrir();
  const controlM6 = construirAppControl({ config: configM6, estado: estadoM6, api: apiM6, flujoLog: descartarLogs });
  await controlM6.listen({ port: puertoControlM6, host: '127.0.0.1' });

  const configM2: Config = {
    ...CONFIG,
    urlBd: base.urlBd,
    claveTokens: CONFIG_PANEL.claveTokens,
    emisorTokens: CONFIG_PANEL.emisorTokens,
    audienciaTokens: CONFIG_PANEL.audienciaTokens,
    campoRoles: CONFIG_PANEL.campoRoles,
    // M2 se presenta ante M6 como lo verifica el simulado (la audiencia de M6).
    audienciaM6: CONFIG_M6.audienciaM6,
    urlM6: `http://127.0.0.1:${puertoApiM6}/api/v1`,
    tiempoModulosMs: ESPERA_DE_M2_MS,
    reintentosModulos: 1,
    reintentarDespuesS: REINTENTAR_DESPUES_S,
  };
  const contrato = cargarContrato();
  const construir = () => construirM2({ config: configM2, pool: poolM2, contrato, manejadores, flujoLog: descartarLogs });
  let m2: ReturnType<typeof construirM2> | undefined = construir();
  const puertoM2 = await escuchar(m2);

  // El panel solo acepta su propio Host, con el puerto configurado: escucha en el mismo que tiene en la configuración.
  const puerto = await puertoLibre();
  const panel = crearAppPanel({
    // La vista de demostración (spec 072) cuenta en la base de M2; Docker queda apagado: ninguna prueba toca los contenedores.
    config: { puerto, urlM2: `http://127.0.0.1:${puertoM2}`, urlM6Control: `http://127.0.0.1:${puertoControlM6}`, urlBd: base.urlBd, docker: false },
    directorioCliente: opciones.directorioCliente,
    demo: baseDemo === undefined ? undefined : { base: baseDemo, docker: mentira.control },
  });
  await panel.listen({ port: puerto, host: '127.0.0.1' });
  const origen = `http://127.0.0.1:${puerto}`;

  // El `fetch` del navegador en la página del panel: los caminos relativos van al panel, y lo que no es consulta lleva `Origin`.
  const porElPanel: typeof fetch = (entrada, init = {}) => {
    const encabezados = new Headers(init.headers);
    if ((init.method ?? 'GET').toUpperCase() !== 'GET') encabezados.set('origin', origen);
    return fetch(new URL(String(entrada), origen), { ...init, headers: encabezados });
  };

  const viajes = crearViajesSimulados(crearApiPanel({ fetch: porElPanel }));
  const ponerModo = async (modo: 'normal' | 'lento' | 'caido') => {
    const respuesta = await porElPanel('/panel/m6/modo', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modo }) });
    if (!respuesta.ok) throw new Error(`no se pudo poner el modo ${modo}: ${respuesta.status}`);
  };

  return {
    pool,
    viajes,
    ponerModo,
    estadoM6,
    apiPanel: crearApiPanel({ fetch: porElPanel }),
    origen,
    fetchDelPanel: porElPanel,
    urlM2: `http://127.0.0.1:${puertoM2}`,
    urlM6Control: `http://127.0.0.1:${puertoControlM6}`,
    urlBd: base.urlBd,
    api: (identidad, alTerminar) => crearApiM2({ identidad, fetch: porElPanel, alTerminar }),
    async detenerM2() {
      await m2?.close();
      m2 = undefined;
    },
    async arrancarM2() {
      if (m2 !== undefined) return;
      m2 = construir();
      await m2.listen({ port: puertoM2, host: '127.0.0.1' });
    },
    docker: mentira.docker,
    async cerrar() {
      await panel.close();
      await m2?.close();
      await controlM6.close();
      await apiM6.cerrar();
      await baseDemo?.cerrar();
      if (poolM2 !== pool) await poolM2.end();
      await proxy?.terminar();
      await pool.end();
      await base.borrar();
    },
  };
}
