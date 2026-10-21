import type { FastifyBaseLogger } from 'fastify';
import { hostname } from 'node:os';
import type { Writable } from 'node:stream';
import { construirApp } from './app.js';
import { migrar } from './bd/migraciones.js';
import { crearPool, type PoolBd } from './bd/pool.js';
import { cargarConfig, type Entorno } from './config.js';
import { cargarContrato } from './contrato/cargar.js';
import { listarOperaciones } from './contrato/operaciones.js';
import { secretosDeConfig, serializarError } from './logs.js';
import { manejadores } from './operaciones/index.js';

// En todas las interfaces: dentro del contenedor, las solicitudes llegan por la red de docker y no por localhost.
const HOST = '0.0.0.0';

// El texto de cada línea de un arranque que falla.
const NO_ARRANCA = 'El servicio no pudo arrancar';

// El nivel de error de pino, el logger de Fastify.
const NIVEL_ERROR = 50;

// Qué hace el proceso con el código de salida: en el servicio, `process.exit`; las pruebas lo espían.
export type Salir = (codigo: number) => void;

export type OpcionesArranque = {
  // Adonde van los logs; sin él, a la salida estándar (RNF-14.5). Solo para las pruebas.
  flujoLog?: Writable;
  // El contrato que se lee; sin ella, contrato/openapi.yml. Solo para las pruebas, que usan contratos rotos.
  rutaContrato?: string;
};

// El servicio andando: la app, que ya escucha, y el pool de la base. Al detenerse hay que cerrar los dos.
export type Servicio = { app: ReturnType<typeof construirApp>; pool: PoolBd };

// Una línea de error con el formato de las del logger de la app (pino): nivel, hora en milisegundos, proceso, máquina, los
// campos y el texto. Es para lo que se registra antes de que exista la app, que es la que tiene el logger.
function registrarSinApp(campos: object, flujo: Writable = process.stdout): void {
  const linea = { level: NIVEL_ERROR, time: Date.now(), pid: process.pid, hostname: hostname(), ...campos, msg: NO_ARRANCA };
  flujo.write(`${JSON.stringify(linea)}\n`);
}

// Arranca el servicio en orden (plan, Lógica 12): lee la configuración y el contrato, arma la app y compila sus esquemas,
// aplica las migraciones y recién entonces escucha, así que no atiende nada con migraciones pendientes (RNF-05.2). Si algo
// falla, registra el motivo sin la clave de los tokens ni la contraseña de la base y llama a `salir(1)` (RNF-05.3, RNF-06.2,
// RNF-19.1): un contrato roto o una base caída no dejan un servicio a medias. Devuelve el servicio andando, o nada si no
// arrancó.
export async function arrancar(
  env: Entorno,
  salir: Salir,
  { flujoLog, rutaContrato }: OpcionesArranque = {},
): Promise<Servicio | undefined> {
  const { config, errores } = cargarConfig(env);
  if (errores) {
    // Una línea por variable, con su nombre y qué le pasa, nunca con su valor.
    for (const { variable, motivo } of errores) registrarSinApp({ variable, motivo }, flujoLog);
    salir(1);
    return undefined;
  }

  // El logger de la app, desde que existe: sus líneas salen sin los secretos de la configuración (Lógica 10).
  let log: FastifyBaseLogger | undefined;
  try {
    const contrato = cargarContrato(rutaContrato);
    // El pool no se conecta hasta la primera consulta, que llega con una solicitud: para entonces la app ya existe.
    const pool = crearPool(config, (error, mensaje) => log?.error({ err: error }, mensaje));
    const app = construirApp({ config, pool, contrato, manejadores, flujoLog });
    log = app.log;
    // Compila los esquemas del contrato: uno que no compila falla acá, antes de tocar la base.
    await app.ready();
    log.info(listarOperaciones(contrato, manejadores), 'Operaciones del contrato');
    await migrar({ urlBd: config.urlBd, tiempoBdMs: config.tiempoBdMs, log: (mensaje) => app.log.info(mensaje) });
    // Fastify escribe una línea por dirección: con 0.0.0.0, una por interfaz de red.
    await app.listen({
      host: HOST,
      port: config.puerto,
      listenTextResolver: (direccion) => `Servicio escuchando en ${direccion}`,
    });
    return { app, pool };
  } catch (error) {
    if (log) log.error({ err: error }, NO_ARRANCA);
    else registrarSinApp({ err: serializarError(error, secretosDeConfig(config)) }, flujoLog);
    salir(1);
    return undefined;
  }
}
