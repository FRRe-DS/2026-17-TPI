import type { FastifyBaseLogger } from 'fastify';
import { hostname } from 'node:os';
import type { Writable } from 'node:stream';
import { construirApp } from './app.js';
import { migrar } from './bd/migraciones.js';
import { crearPool, type PoolBd } from './bd/pool.js';
import { cargarConfig, type Entorno } from './config.js';
import { cargarContrato } from './contrato/cargar.js';
import { listarOperaciones, type Manejadores } from './contrato/operaciones.js';
import { registrarSolicitudCortada, secretosDeConfig, serializarError } from './logs.js';
import { manejadores as manejadoresDelServicio } from './operaciones/index.js';

// En todas las interfaces: dentro del contenedor, las solicitudes llegan por la red de docker y no por localhost.
const HOST = '0.0.0.0';

// El texto de cada línea de un arranque que falla, y el de la línea de uno que corta la parada.
const NO_ARRANCA = 'El servicio no pudo arrancar';
const INTERRUMPIDO = 'Arranque interrumpido por la parada';

// Los textos de las líneas de la parada.
const DETENIENDO = 'Deteniendo el servicio';
const DETENIDO = 'Servicio detenido';
const NO_SE_DETUVO = 'El servicio no se detuvo en orden';

// Los niveles de info y de error de pino, el logger de Fastify.
const NIVEL_INFO = 30;
const NIVEL_ERROR = 50;

// Lo que la parada espera a las solicitudes en curso antes de cortarlas: deja tiempo para salir antes de los 10 s
// (RNF-04.5).
const CORTE_MS = 8000;

// Qué hace el proceso con el código de salida: en el servicio, `process.exit`; las pruebas lo espían.
export type Salir = (codigo: number) => void;

export type OpcionesArranque = {
  // Adonde van los logs; sin él, a la salida estándar (RNF-14.5). Solo para las pruebas.
  flujoLog?: Writable;
  // El contrato que se lee; sin ella, contrato/openapi.yml. Solo para las pruebas, que usan contratos rotos.
  rutaContrato?: string;
  // Los manejadores de las operaciones; sin ellos, los del servicio. Solo para las pruebas, que con el contrato de prueba
  // necesitan operaciones que tarden lo que ellas quieran.
  manejadores?: Manejadores;
  // La señal con la que servidor.ts avisa una señal de parada que llega antes de que el servicio escuche (Lógica 12).
  parada?: AbortSignal;
};

export type OpcionesParada = {
  // Lo que se espera a las solicitudes en curso antes de cortarlas; sin él, CORTE_MS. Las pruebas lo acortan.
  corteMs?: number;
};

// El servicio andando: la app, que ya escucha, el pool de la base y `detener`, que cierra los dos y termina con `salir(0)`.
// Llamar a `detener` otra vez devuelve la misma parada.
export type Servicio = {
  app: ReturnType<typeof construirApp>;
  pool: PoolBd;
  detener: (opciones?: OpcionesParada) => Promise<void>;
};

// Una línea con el formato de las del logger de la app (pino): nivel, hora en milisegundos, proceso, máquina, los campos y
// el texto; sin nivel ni texto, es una de «El servicio no pudo arrancar». Es para lo que se registra antes de que exista la
// app, que es la que tiene el logger.
function registrarSinApp(
  campos: object,
  flujo: Writable = process.stdout,
  { nivel = NIVEL_ERROR, msg = NO_ARRANCA }: { nivel?: number; msg?: string } = {},
): void {
  const linea = { level: nivel, time: Date.now(), pid: process.pid, hostname: hostname(), ...campos, msg };
  flujo.write(`${JSON.stringify(linea)}\n`);
}

// Arranca el servicio en orden (plan, Lógica 12): lee la configuración y el contrato, arma la app y compila sus esquemas,
// aplica las migraciones y recién entonces escucha, así que no atiende nada con migraciones pendientes (RNF-05.2). Si algo
// falla, registra el motivo sin la clave de los tokens ni la contraseña de la base y llama a `salir(1)` (RNF-05.3, RNF-06.2,
// RNF-19.1): un contrato roto o una base caída no dejan un servicio a medias. Si llega la parada antes de escuchar, deja de
// arrancar y llama a `salir(0)` sin esperar a la base: es una parada pedida, y no hay solicitudes que esperar (RNF-04.5).
// Devuelve el servicio andando, o nada si no arrancó.
export async function arrancar(
  env: Entorno,
  salir: Salir,
  { flujoLog, rutaContrato, manejadores = manejadoresDelServicio, parada }: OpcionesArranque = {},
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
    // Con la parada, migrar deja de esperar a la base y falla: el catch ve la parada y sale con 0.
    await migrar({ urlBd: config.urlBd, tiempoBdMs: config.tiempoBdMs, log: (mensaje) => app.log.info(mensaje), parada });
    // La que llega justo cuando terminan las migraciones tampoco llega a escuchar.
    parada?.throwIfAborted();
    // Fastify escribe una línea por dirección: con 0.0.0.0, una por interfaz de red.
    await app.listen({
      host: HOST,
      port: config.puerto,
      listenTextResolver: (direccion) => `Servicio escuchando en ${direccion}`,
    });
    let detencion: Promise<void> | undefined;
    const detener = ({ corteMs = CORTE_MS }: OpcionesParada = {}) =>
      (detencion ??= detenerEnOrden(app, pool, salir, corteMs));
    // Si la parada llegó con listen en curso, el servicio ya escucha: la atiende detener(), como si hubiera llegado un
    // instante después.
    if (parada?.aborted) void detener();
    return { app, pool, detener };
  } catch (error) {
    if (parada?.aborted) {
      if (log) log.info(INTERRUMPIDO);
      else registrarSinApp({}, flujoLog, { nivel: NIVEL_INFO, msg: INTERRUMPIDO });
      salir(0);
      return undefined;
    }
    if (log) log.error({ err: error }, NO_ARRANCA);
    else registrarSinApp({ err: serializarError(error, secretosDeConfig(config)) }, flujoLog);
    salir(1);
    return undefined;
  }
}

// Detiene el servicio en orden (plan, Lógica 13). Desde acá, lo que llega por una conexión abierta recibe 503 (app.ts);
// app.close() deja de aceptar conexiones y espera a las solicitudes en curso, y después se cierra el pool. Si eso no termina
// en `corteMs`, corta las solicitudes que quedan, deja una línea por cada una y sale sin esperar al pool: una consulta en
// curso lo retiene hasta el tiempo de base, que puede pasar de los 10 s. Sale con 0 también si algo falla al cerrar: es una
// parada pedida (RNF-04.5).
async function detenerEnOrden(app: Servicio['app'], pool: PoolBd, salir: Salir, corteMs: number): Promise<void> {
  app.deteniendose = true;
  app.log.info(DETENIENDO);
  let cortadas = 0;
  try {
    if (!(await terminaAntesDe(app.close().then(() => pool.end()), corteMs))) cortadas = cortarSolicitudes(app);
  } catch (error) {
    app.log.error({ err: error }, NO_SE_DETUVO);
  }
  app.log.info({ cortadas }, DETENIDO);
  salir(0);
}

// Si `promesa` se cumple antes de `ms`; si falla antes, falla. Lo que haga después del plazo no tiene a quién llegar:
// `Promise.race` la sigue atendiendo, y un rechazo tardío no llega a ser un rechazo sin atender.
async function terminaAntesDe(promesa: Promise<unknown>, ms: number): Promise<boolean> {
  const vencido = Promise.withResolvers<boolean>();
  const corte = setTimeout(() => vencido.resolve(false), ms);
  try {
    return await Promise.race([promesa.then(() => true), vencido.promise]);
  } finally {
    clearTimeout(corte);
  }
}

// Corta las solicitudes que no terminaron: deja una línea por cada una y cierra todas las conexiones. Devuelve cuántas
// cortó.
function cortarSolicitudes(app: Servicio['app']): number {
  const cortadas = [...app.enCurso];
  for (const reply of cortadas) registrarSolicitudCortada(reply.request, reply);
  app.server.closeAllConnections();
  return cortadas.length;
}
