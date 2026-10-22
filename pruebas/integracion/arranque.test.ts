import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import net, { type AddressInfo } from 'node:net';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PG_MIGRATE_LOCK_ID } from 'node-pg-migrate';
import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { stringify } from 'yaml';
import { arrancar, type Servicio } from '../../src/arranque.js';
import type { Entorno } from '../../src/config.js';
import { cargarContrato } from '../../src/contrato/cargar.js';
import { listarOperaciones } from '../../src/contrato/operaciones.js';
import { manejadores } from '../../src/operaciones/index.js';
import { entorno, escucha, puertoLibre } from '../ayudas/arranque.js';
import { type BaseDePrueba, crearBaseDePrueba } from '../ayudas/bd.js';
import { capturarLogs, type LineaDeLog } from '../ayudas/logs.js';
import { crearProxy } from '../ayudas/proxy.js';
import { CONFIG_TOKENS } from '../ayudas/tokens.js';

// Los textos de las líneas del arranque.
const NO_ARRANCA = 'El servicio no pudo arrancar';
const OPERACIONES = 'Operaciones del contrato';
const ESCUCHANDO = 'Servicio escuchando en ';

// Los niveles de pino.
const INFO = 30;
const ERROR = 50;

// La contraseña de la base en las pruebas que no llegan a conectarse o que la base rechaza: no puede aparecer en el log.
const CONTRASENA = 'contrasena-de-la-base-de-prueba';
const URL_SIN_BASE = `postgres://m2:${CONTRASENA}@127.0.0.1:1/m2`;

// Las migraciones del repositorio, en el orden en que se aplican.
const DIR_MIGRACIONES = fileURLToPath(new URL('../../migraciones', import.meta.url));
const delRepositorio = readdirSync(DIR_MIGRACIONES)
  .filter((archivo) => archivo.endsWith('.sql'))
  .map((archivo) => archivo.slice(0, -'.sql'.length))
  .sort();

// Las variables opcionales de la configuración (RNF-06.1), que `entorno` no pone.
const VARIABLES_OPCIONALES = [
  'M2_CAMPO_ROLES',
  'M2_TIEMPO_BD_MS',
  'M2_TIEMPO_MODULOS_MS',
  'M2_REINTENTOS_MODULOS',
  'M2_ENCABEZADO_CORRELACION',
];

// Escribe un contrato, un objeto como YAML o un texto tal cual, en una carpeta que se borra cuando termina la prueba.
function contratoEnArchivo(contrato: object | string): string {
  const carpeta = mkdtempSync(join(tmpdir(), 'm2-contrato-'));
  onTestFinished(() => rmSync(carpeta, { recursive: true, force: true }));
  const ruta = join(carpeta, 'openapi.yml');
  writeFileSync(ruta, typeof contrato === 'string' ? contrato : stringify(contrato));
  return ruta;
}

// Un contrato con GET /health como verificarSalud, la única operación del servicio con manejador, con lo que se le sume a
// esa operación y otras rutas.
const contratoConSalud = (salud: object = {}, otrasRutas: object = {}) => ({
  openapi: '3.1.0',
  info: { title: 'Contrato armado en la prueba', version: '0.0.0' },
  paths: {
    '/health': { get: { operationId: 'verificarSalud', security: [], responses: { 200: { description: 'Anda' } }, ...salud } },
    ...otrasRutas,
  },
});

// Un esquema de la query string de GET /health con un formato que Ajv no conoce.
const conFormato = (formato: string) =>
  contratoConSalud({ parameters: [{ name: 'x', in: 'query', schema: { type: 'string', format: formato } }] });

// Una consulta con su propia conexión, que cierra al terminar.
async function filas(urlBd: string, sql: string): Promise<Record<string, unknown>[]> {
  const cliente = new Client({ connectionString: urlBd });
  await cliente.connect();
  try {
    return (await cliente.query(sql)).rows;
  } finally {
    await cliente.end();
  }
}

const tablas = async (urlBd: string) =>
  (await filas(urlBd, `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)).map((fila) => fila.tablename);

const anotadas = async (urlBd: string) =>
  (await filas(urlBd, 'SELECT name FROM migraciones_aplicadas ORDER BY id')).map((fila) => fila.name);

// Cuántas sesiones de la base esperan un bloqueo consultivo que tiene otra.
const esperanUnBloqueo = async (urlBd: string) =>
  (
    await filas(
      urlBd,
      `SELECT count(*)::int AS n FROM pg_locks
       WHERE locktype = 'advisory' AND NOT granted
         AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
    )
  )[0]?.n;

const errores = (lineas: LineaDeLog[]) => lineas.filter((linea) => linea.level === ERROR);

let base: BaseDePrueba;
const andando: Servicio[] = [];

beforeEach(async () => {
  base = await crearBaseDePrueba();
});

// Primero se cierran los servicios que arrancaron, después se borra la base: si no, la base les corta las conexiones.
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const { app, pool } of andando.splice(0)) {
    await app.close();
    await pool.end();
  }
  await base.borrar();
});

// Arranca con un `salir` de prueba y el log capturado. El servicio que arranca se cierra al terminar la prueba.
function arrancarParaProbar(env: Entorno, rutaContrato?: string) {
  const salir = vi.fn();
  const logs = capturarLogs();
  const arranque = arrancar(env, salir, { flujoLog: logs.flujo, rutaContrato }).then((servicio) => {
    if (servicio) andando.push(servicio);
    return servicio;
  });
  return { salir, logs, arranque };
}

describe('arrancar sin una configuración válida (RNF-06.2, RNF-19.1)', () => {
  // [caso, cambios al entorno que anda, variables que se nombran, en orden, y valores que no pueden aparecer en el log]
  const CASOS: [string, Entorno, string[], string[]][] = [
    ['falta la URL de la base', { M2_URL_BD: undefined }, ['M2_URL_BD'], []],
    [
      'faltan las cuatro obligatorias (una, vacía)',
      { M2_URL_BD: undefined, M2_CLAVE_TOKENS: undefined, M2_EMISOR_TOKENS: '', M2_AUDIENCIA_TOKENS: undefined },
      ['M2_URL_BD', 'M2_CLAVE_TOKENS', 'M2_EMISOR_TOKENS', 'M2_AUDIENCIA_TOKENS'],
      [],
    ],
    [
      'hay valores inválidos',
      {
        M2_URL_BD: 'mysql://m2:clave-de-mysql@bd/m2',
        M2_PUERTO: '99999',
        M2_CLAVE_TOKENS: 'una-clave-corta-y-secreta',
        M2_TIEMPO_BD_MS: '2147483648',
        M2_ENCABEZADO_CORRELACION: 'X Request Id',
      },
      ['M2_URL_BD', 'M2_PUERTO', 'M2_CLAVE_TOKENS', 'M2_TIEMPO_BD_MS', 'M2_ENCABEZADO_CORRELACION'],
      ['mysql://m2:clave-de-mysql@bd/m2', 'clave-de-mysql', 'una-clave-corta-y-secreta', 'X Request Id'],
    ],
  ];

  it.each(CASOS)('%s: salir(1) y una línea JSON de error por variable, con su nombre y sin su valor', async (
    _caso,
    cambios,
    variables,
    valores,
  ) => {
    const { salir, logs, arranque } = arrancarParaProbar(entorno(URL_SIN_BASE, await puertoLibre(), cambios));

    expect(await arranque).toBeUndefined();
    expect(salir.mock.calls).toEqual([[1]]);
    const lineas = logs.lineas();
    expect(lineas.map(({ variable }) => variable)).toEqual(variables);
    for (const linea of lineas) {
      expect(linea).toMatchObject({ level: ERROR, msg: NO_ARRANCA, motivo: expect.any(String) });
    }
    for (const valor of [...valores, CONFIG_TOKENS.claveTokens, CONTRASENA]) expect(logs.texto()).not.toContain(valor);
  });

  it('la línea tiene los campos de las del logger de la app: level, time, pid, hostname y msg (RNF-14.5)', async () => {
    const antes = Date.now();
    const { logs, arranque } = arrancarParaProbar(entorno(URL_SIN_BASE, 8082, { M2_URL_BD: undefined }));
    await arranque;

    const [linea] = logs.lineas();
    expect(Object.keys(linea)).toEqual(['level', 'time', 'pid', 'hostname', 'variable', 'motivo', 'msg']);
    expect(linea).toMatchObject({ level: ERROR, pid: process.pid, hostname: hostname(), msg: NO_ARRANCA });
    expect(linea.time).toBeGreaterThanOrEqual(antes);
    expect(linea.time).toBeLessThanOrEqual(Date.now());
  });
});

describe('arrancar con un contrato que no compila: falla antes de migrar (plan, Lógica 12)', () => {
  // [caso, el contrato, lo que dice el motivo]
  const CASOS: [string, () => string, string][] = [
    ['el YAML no se puede leer', () => contratoEnArchivo('openapi: 3.1.0\ninfo: [\n'), 'No se pudo leer el contrato'],
    [
      'una operación no se puede registrar (un $ref roto)',
      () => contratoEnArchivo(contratoConSalud({ parameters: [{ $ref: '#/components/parameters/NoExiste' }] })),
      'No se pudo registrar la operación verificarSalud (GET /health)',
    ],
    [
      'un esquema no compila (un formato desconocido)',
      () => contratoEnArchivo(conFormato('formato-que-no-existe')),
      'unknown format "formato-que-no-existe"',
    ],
  ];

  it.each(CASOS)('%s: salir(1) con el motivo, sin migrar y sin escuchar', async (_caso, contrato, motivo) => {
    const puerto = await puertoLibre();
    const { salir, logs, arranque } = arrancarParaProbar(entorno(base.urlBd, puerto), contrato());

    expect(await arranque).toBeUndefined();
    expect(salir.mock.calls).toEqual([[1]]);
    expect(errores(logs.lineas())).toEqual([
      expect.objectContaining({ msg: NO_ARRANCA, err: expect.objectContaining({ mensaje: expect.stringContaining(motivo) }) }),
    ]);
    expect(await tablas(base.urlBd)).toEqual([]);
    expect(await escucha(puerto)).toBe(false);
  });

  // [cuándo, la ruta del contrato]: el contrato no se puede leer antes de que exista la app, y el esquema no compila con
  // la app ya creada. En los dos, el motivo trae la clave de los tokens y la contraseña de la base.
  const CON_SECRETOS: [string, () => string][] = [
    [
      'antes de que exista la app (un contrato que no está)',
      () => join(tmpdir(), 'm2-no-existe', CONFIG_TOKENS.claveTokens, `${CONTRASENA}.yml`),
    ],
    [
      'con la app ya creada (un esquema que no compila)',
      () => contratoEnArchivo(conFormato(`${CONFIG_TOKENS.claveTokens}-${CONTRASENA}`)),
    ],
  ];

  it.each(CON_SECRETOS)('un motivo con la clave y la contraseña sale sin ellas, %s (RNF-19.1)', async (_caso, contrato) => {
    const { salir, logs, arranque } = arrancarParaProbar(entorno(URL_SIN_BASE, await puertoLibre()), contrato());
    await arranque;

    expect(salir.mock.calls).toEqual([[1]]);
    const oculto = expect.objectContaining({ mensaje: expect.stringContaining('[oculto]') });
    expect(errores(logs.lineas())).toEqual([expect.objectContaining({ msg: NO_ARRANCA, err: oculto })]);
    expect(logs.texto()).not.toContain(CONFIG_TOKENS.claveTokens);
    expect(logs.texto()).not.toContain(CONTRASENA);
  });
});

describe('arrancar con la base o el puerto que no sirven (RNF-05.3, RNF-19.1)', () => {
  it('la base no acepta conexiones: salir(1) con ECONNREFUSED, sin la contraseña y sin escuchar', async () => {
    const puertoDeLaBase = await puertoLibre();
    const puerto = await puertoLibre();
    const urlBd = `postgres://m2:${CONTRASENA}@127.0.0.1:${puertoDeLaBase}/m2`;
    const { salir, logs, arranque } = arrancarParaProbar(entorno(urlBd, puerto));

    expect(await arranque).toBeUndefined();
    expect(salir.mock.calls).toEqual([[1]]);
    expect(errores(logs.lineas())).toEqual([
      expect.objectContaining({ msg: NO_ARRANCA, err: expect.objectContaining({ codigo: 'ECONNREFUSED' }) }),
    ]);
    expect(logs.texto()).not.toContain(CONTRASENA);
    expect(await escucha(puerto)).toBe(false);
  });

  it('la base rechaza la contraseña: salir(1) con 28P01 y sin la contraseña', async () => {
    const urlBd = new URL(base.urlBd);
    urlBd.password = CONTRASENA;
    const { salir, logs, arranque } = arrancarParaProbar(entorno(urlBd.toString(), await puertoLibre()));

    expect(await arranque).toBeUndefined();
    expect(salir.mock.calls).toEqual([[1]]);
    expect(errores(logs.lineas())).toEqual([
      expect.objectContaining({ msg: NO_ARRANCA, err: expect.objectContaining({ codigo: '28P01' }) }),
    ]);
    expect(logs.texto()).not.toContain(CONTRASENA);
  });

  it('el puerto está ocupado: salir(1) con EADDRINUSE, con las migraciones ya aplicadas', async () => {
    const ocupado = net.createServer();
    await new Promise<void>((listo) => ocupado.listen(0, '0.0.0.0', listo));
    onTestFinished(() => new Promise<void>((listo) => ocupado.close(() => listo())));
    const { port: puerto } = ocupado.address() as AddressInfo;
    const { salir, logs, arranque } = arrancarParaProbar(entorno(base.urlBd, puerto));

    expect(await arranque).toBeUndefined();
    expect(salir.mock.calls).toEqual([[1]]);
    expect(errores(logs.lineas())).toEqual([
      expect.objectContaining({ msg: NO_ARRANCA, err: expect.objectContaining({ codigo: 'EADDRINUSE' }) }),
    ]);
    expect(await anotadas(base.urlBd)).toEqual(delRepositorio);
  });
});

describe('arranque normal (RNF-05.2)', () => {
  // El otro proceso tiene el bloqueo de las migraciones (RNF-05.2): arrancar espera en la fase de migraciones.
  it('escucha recién después de migrar: mientras otro proceso migra, no acepta conexiones', async () => {
    const otroProceso = new Client({ connectionString: base.urlBd });
    // Si la prueba falla antes de cerrarla, la base la corta al borrarse: ese error no importa.
    otroProceso.on('error', () => {});
    await otroProceso.connect();
    try {
      await otroProceso.query(`SELECT pg_advisory_lock(${PG_MIGRATE_LOCK_ID})`);
      const puerto = await puertoLibre();
      let termino = false;
      const { salir, logs, arranque } = arrancarParaProbar(entorno(base.urlBd, puerto));
      void arranque.finally(() => {
        termino = true;
      });

      // Ya está en las migraciones, esperando el bloqueo.
      await vi.waitFor(async () => expect(await esperanUnBloqueo(base.urlBd)).toBe(1), { timeout: 3000, interval: 20 });
      expect(termino).toBe(false);
      expect(await escucha(puerto)).toBe(false);
      expect(logs.texto()).not.toContain(ESCUCHANDO);

      await otroProceso.query(`SELECT pg_advisory_unlock(${PG_MIGRATE_LOCK_ID})`);
      expect(await arranque).toBeDefined();
      expect(salir).not.toHaveBeenCalled();
      expect(await escucha(puerto)).toBe(true);
      expect(await anotadas(base.urlBd)).toEqual(delRepositorio);
    } finally {
      await otroProceso.end();
    }
  }, 10_000);

  it('con el contrato del repositorio: migra, escucha en 0.0.0.0 y el puerto configurado, y GET /health da 200', async () => {
    const puerto = await puertoLibre();
    const { salir, arranque } = arrancarParaProbar(entorno(base.urlBd, puerto));
    const servicio = await arranque;

    expect(salir).not.toHaveBeenCalled();
    expect(servicio?.app.server.address()).toMatchObject({ address: '0.0.0.0', port: puerto });
    const respuesta = await fetch(`http://127.0.0.1:${puerto}/health`);
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ estado: 'ok' });
    expect(await anotadas(base.urlBd)).toEqual(delRepositorio);
  });

  it('registra en JSON, en este orden, las operaciones del contrato, las migraciones que aplica y dónde escucha', async () => {
    const puerto = await puertoLibre();
    const { logs, arranque } = arrancarParaProbar(entorno(base.urlBd, puerto));
    await arranque;

    const lineas = logs.lineas();
    const mensajes = lineas.map(({ msg }) => msg ?? '');
    const operaciones = mensajes.indexOf(OPERACIONES);
    const migraciones = delRepositorio.map((nombre) => mensajes.findIndex((mensaje) => mensaje.includes(nombre)));
    const escuchando = mensajes.indexOf(`${ESCUCHANDO}http://127.0.0.1:${puerto}`);
    expect(operaciones).toBeGreaterThanOrEqual(0);
    for (const indice of migraciones) expect(indice).toBeGreaterThan(operaciones);
    expect(escuchando).toBeGreaterThan(Math.max(...migraciones));
    expect(lineas[operaciones]).toMatchObject({ level: INFO, ...listarOperaciones(cargarContrato(), manejadores) });
    expect(errores(lineas)).toEqual([]);
    expect(logs.texto()).not.toContain('Server listening');
    for (const linea of lineas) {
      expect(Object.keys(linea).slice(0, 4)).toEqual(['level', 'time', 'pid', 'hostname']);
      expect(Object.keys(linea).at(-1)).toBe('msg');
    }
  });

  it('registra las operaciones implementadas y pendientes del contrato', async () => {
    const contrato = contratoEnArchivo(
      contratoConSalud(
        {},
        {
          '/clientes/{clienteId}': {
            get: { operationId: 'obtenerCliente', responses: { 200: { description: 'El cliente' } } },
          },
          '/clientes': { post: { responses: { 201: { description: 'Creado' } } } },
        },
      ),
    );
    const { logs, arranque } = arrancarParaProbar(entorno(base.urlBd, await puertoLibre()), contrato);
    await arranque;

    const linea = logs.lineas().find(({ msg }) => msg === OPERACIONES);
    expect({ implementadas: linea?.implementadas, pendientes: linea?.pendientes }).toEqual({
      implementadas: [{ operationId: 'verificarSalud', metodo: 'GET', ruta: '/health' }],
      pendientes: [
        { operationId: 'obtenerCliente', metodo: 'GET', ruta: '/clientes/{clienteId}' },
        { metodo: 'POST', ruta: '/clientes' },
      ],
    });
  });

  it('con el servicio andando, la causa de una falta de base queda en el log de la app (RNF-14.2)', async () => {
    const proxy = await crearProxy(base.urlBd);
    onTestFinished(() => proxy.terminar());
    const puerto = await puertoLibre();
    const { logs, arranque } = arrancarParaProbar(entorno(proxy.urlBd, puerto));
    expect(await arranque).toBeDefined();

    await proxy.cerrar();
    const respuesta = await fetch(`http://127.0.0.1:${puerto}/health`);

    expect(respuesta.status).toBe(503);
    expect(errores(logs.lineas())).toEqual([
      expect.objectContaining({
        msg: 'La base de datos no está disponible',
        err: expect.objectContaining({ codigo: 'ECONNREFUSED' }),
      }),
    ]);
  });
});

describe('src/servidor.ts, el punto de entrada (RNF-14.5)', () => {
  it('lee process.env y, si no puede arrancar, sale con process.exit(1) y escribe en la salida estándar', async () => {
    // Todas vacías, que cuenta como no definidas, salvo el emisor: el proceso puede traer otras de la máquina.
    for (const variable of Object.keys(entorno('', 0)).concat(VARIABLES_OPCIONALES)) vi.stubEnv(variable, '');
    vi.stubEnv('M2_EMISOR_TOKENS', CONFIG_TOKENS.emisorTokens);
    const salir = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const escrito: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((parte: string | Uint8Array) => {
      escrito.push(String(parte));
      return true;
    });

    await import('../../src/servidor.js');

    expect(salir.mock.calls).toEqual([[1]]);
    const lineas = escrito
      .join('')
      .split('\n')
      .filter((linea) => linea.startsWith('{'))
      .map((linea) => JSON.parse(linea) as LineaDeLog);
    expect(lineas.map(({ variable }) => variable)).toEqual(['M2_URL_BD', 'M2_CLAVE_TOKENS', 'M2_AUDIENCIA_TOKENS']);
    expect(lineas.every(({ msg }) => msg === NO_ARRANCA)).toBe(true);
  });
});
