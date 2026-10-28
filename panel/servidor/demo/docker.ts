import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Disponibilidad } from './base.js';

// Apagar y encender la base desde la vista de demostración (spec 072, plan «Docker», ADR 072), para ver a M2 responder 503 sin
// base y recuperarse (RNF-13.4). Tres comandos fijos de `docker compose`, con `execFile` y sin shell: nada de lo que llega del
// navegador forma parte del comando, y el servicio sale de la configuración ya validada (RNF-12.10). Solo funciona con el panel
// en la máquina: en su contenedor no hay Docker, y la vista lo dice (RNF-13.6).

// Lo que ejecuta un comando. En producción, `execFile`; en las pruebas, uno de mentira. Una falla rechaza con un error que puede
// traer `code` (`ENOENT` o el código de salida), `stderr` y `killed` (se cumplió el `timeout`).
export type Ejecutar = (
  archivo: string,
  argumentos: readonly string[],
  opciones: { cwd: string; timeout: number; shell: false },
) => Promise<{ stdout: string; stderr: string }>;

const execFileConPromesa = promisify(execFile);

export const ejecutarSinShell: Ejecutar = (archivo, argumentos, opciones) =>
  execFileConPromesa(archivo, [...argumentos], { ...opciones, encoding: 'utf8', windowsHide: true });

// Cortes de cada comando: consultar es inmediato; detener espera a que PostgreSQL cierre bien; encender, a que esté sano.
const CORTE_ESTADO_MS = 5000;
const CORTE_APAGAR_MS = 30_000;
const CORTE_ENCENDER_MS = 60_000;
// Cuánto se guarda la disponibilidad: la vista la pide al abrirse y no cambia de un momento a otro.
const VIGENCIA_DISPONIBILIDAD_MS = 10_000;

const LEVANTAR_EN_LA_MAQUINA = 'Levantá el panel en la máquina con npm run panel (con el perfil panel de compose arriba).';

// El directorio que tiene `docker-compose.yml`, subiendo desde `desde`. El archivo corre desde `panel/servidor/demo/` en las
// pruebas y desde `panel/dist/servidor/demo/` compilado: a distinta profundidad, así que se busca en vez de contar carpetas.
export function buscarRaiz(desde: string): string | undefined {
  for (let carpeta = desde; ; carpeta = dirname(carpeta)) {
    if (existsSync(join(carpeta, 'docker-compose.yml'))) return carpeta;
    if (dirname(carpeta) === carpeta) return undefined;
  }
}

const RAIZ_DEL_REPOSITORIO = buscarRaiz(dirname(fileURLToPath(import.meta.url)));

// Docker no se puede usar desde este panel: apagar y encender no ejecutan nada. La ruta lo responde con 409 (T8).
export class DockerNoDisponible extends Error {
  override readonly name = 'DockerNoDisponible';
  constructor(readonly disponibilidad: Disponibilidad) {
    super(disponibilidad.motivo);
  }
}

// El comando se ejecutó y falló. El mensaje es el primer renglón del error, sin rutas ni variables.
export class ComandoDockerFallido extends Error {
  override readonly name = 'ComandoDockerFallido';
}

type FallaDeComando = { code?: unknown; stderr?: unknown; killed?: unknown };

// El primer renglón de lo que dijo Docker, sin nada que tenga una barra (rutas, URLs, el socket) ni `$VARIABLE`: pueden mostrar
// cómo está armada la máquina de quien lo corre (plan, Docker).
function primerRenglon(texto: string): string {
  const renglon = texto.split('\n').find((linea) => linea.trim() !== '') ?? '';
  return renglon
    .replace(/\S*\/\S*/g, '…')
    .replace(/\$\{?[A-Za-z_]\w*\}?/g, '…')
    .replace(/\s+/g, ' ')
    .trim();
}

function describirFalla(error: unknown, corteMs: number): string {
  const { code, stderr, killed } = (typeof error === 'object' && error !== null ? error : {}) as FallaDeComando;
  if (killed === true) return `docker compose no respondió en ${corteMs / 1000} s`;
  const renglon = typeof stderr === 'string' ? primerRenglon(stderr) : '';
  if (renglon !== '') return renglon;
  return typeof code === 'number' ? `docker compose terminó con el código ${code}` : 'docker compose no se pudo ejecutar';
}

function disponibilidadSegun(error: unknown): Disponibilidad {
  const { code, stderr } = (typeof error === 'object' && error !== null ? error : {}) as FallaDeComando;
  if (code === 'ENOENT') {
    return { disponible: false, motivo: 'Docker no está instalado en esta máquina', comoActivar: `Instalá Docker. ${LEVANTAR_EN_LA_MAQUINA}` };
  }
  if (typeof stderr === 'string' && /permission denied/i.test(stderr)) {
    return {
      disponible: false,
      motivo: 'el usuario no puede usar Docker sin sudo (grupo docker)',
      comoActivar: `Sumá tu usuario al grupo docker (sudo usermod -aG docker <tu-usuario>) y volvé a iniciar sesión. ${LEVANTAR_EN_LA_MAQUINA}`,
    };
  }
  return { disponible: false, motivo: describirFalla(error, CORTE_ESTADO_MS), comoActivar: LEVANTAR_EN_LA_MAQUINA };
}

export type OpcionesDocker = {
  // PANEL_DOCKER: `false` en el contenedor del panel.
  docker: boolean;
  // PANEL_SERVICIO_BD, ya validado.
  servicio: string;
  ejecutar?: Ejecutar;
  // Dónde se corre `docker compose`. Por defecto, la raíz del repositorio; `undefined`, que no se encontró.
  raiz?: string | undefined;
  ahora?: () => number;
};

export function crearControlDocker(opciones: OpcionesDocker) {
  const { docker, servicio, ejecutar = ejecutarSinShell, ahora = Date.now } = opciones;
  const raiz = 'raiz' in opciones ? opciones.raiz : RAIZ_DEL_REPOSITORIO;
  // Se guarda la promesa y no el resultado: dos consultas juntas ejecutan `ps` una sola vez.
  let guardada: { hasta: number; disponibilidad: Promise<Disponibilidad> } | undefined;

  const compose = (accion: readonly string[], cwd: string, timeout: number) =>
    ejecutar('docker', ['compose', ...accion, servicio], { cwd, timeout, shell: false });

  async function calcular(): Promise<Disponibilidad> {
    if (!docker) {
      return { disponible: false, motivo: 'el panel corre en un contenedor y no tiene acceso a Docker', comoActivar: LEVANTAR_EN_LA_MAQUINA };
    }
    if (raiz === undefined) return { disponible: false, motivo: 'no se encontró docker-compose.yml', comoActivar: LEVANTAR_EN_LA_MAQUINA };
    try {
      // Termina bien con el servicio detenido (sin salida): lo que importa es que Docker responde y el servicio existe.
      await compose(['ps', '--format', 'json'], raiz, CORTE_ESTADO_MS);
      return { disponible: true };
    } catch (error) {
      return disponibilidadSegun(error);
    }
  }

  function disponibilidad(): Promise<Disponibilidad> {
    if (guardada === undefined || ahora() >= guardada.hasta) {
      guardada = { hasta: ahora() + VIGENCIA_DISPONIBILIDAD_MS, disponibilidad: calcular() };
    }
    return guardada.disponibilidad;
  }

  // `stop` sobre una base apagada y `start` sobre una encendida terminan bien en compose: no son un error (plan, Docker).
  async function ejecutarAccion(accion: 'stop' | 'start', corteMs: number): Promise<void> {
    const estado = await disponibilidad();
    if (!estado.disponible || raiz === undefined) throw new DockerNoDisponible(estado);
    try {
      await compose([accion], raiz, corteMs);
    } catch (error) {
      throw new ComandoDockerFallido(describirFalla(error, corteMs));
    }
  }

  return {
    disponibilidad,
    apagar: () => ejecutarAccion('stop', CORTE_APAGAR_MS),
    encender: () => ejecutarAccion('start', CORTE_ENCENDER_MS),
  };
}

export type ControlDocker = ReturnType<typeof crearControlDocker>;
