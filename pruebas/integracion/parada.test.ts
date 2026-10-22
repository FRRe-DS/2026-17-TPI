import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { arrancar, type Salir, type Servicio } from '../../src/arranque.js';
import type { Entorno } from '../../src/config.js';
import type { Manejador } from '../../src/contrato/operaciones.js';
import { entorno, escucha, puertoLibre } from '../ayudas/arranque.js';
import { type BaseDePrueba, crearBaseDePrueba } from '../ayudas/bd.js';
import { capturarLogs, type LineaDeLog } from '../ayudas/logs.js';
import { leerRespuesta } from '../ayudas/socket.js';

// El contrato de prueba: probarTarda y probarPublica son públicas, y probarProtegida exige un token.
const CONTRATO_PRUEBA = fileURLToPath(new URL('../ayudas/contrato-prueba.yml', import.meta.url));

// Los textos de las líneas de la parada y el de la línea de cada solicitud que termina.
const DETENIENDO = 'Deteniendo el servicio';
const DETENIDO = 'Servicio detenido';
const CORTADA = 'Solicitud cortada por la parada';
const NO_SE_DETUVO = 'El servicio no se detuvo en orden';
const TERMINADA = 'Solicitud terminada';

// Los niveles de pino.
const INFO = 30;
const WARN = 40;
const ERROR = 50;

// El corte de la parada cuando no se pasa otro (plan, Lógica 13), y lo que puede tardar la parada entera (RNF-04.5).
const CORTE_MS = 8000;
const LIMITE_MS = 10_000;

// Lo que se acepta por encima de un tiempo esperado: la máquina de CI puede ir lenta.
const MARGEN_MS = 1000;

// Node puede disparar un temporizador unos milisegundos antes de lo que mide performance.now().
const TOLERANCIA_MS = 20;

const PROBLEMA_JSON = /^application\/problem\+json/;

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

// Las sesiones abiertas en la base, sin contar la de esta consulta.
const sesionesAjenas = async (urlBd: string) =>
  (
    await filas(
      urlBd,
      `SELECT count(*)::int AS abiertas FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`,
    )
  )[0]?.abiertas;

// Las consultas de probarPublica que la base está ejecutando.
const consultasLargas = async (urlBd: string) =>
  (
    await filas(
      urlBd,
      `SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE datname = current_database() AND state = 'active' AND query LIKE 'SELECT pg_sleep%'`,
    )
  )[0]?.n;

// Un manejador que no contesta hasta que la prueba lo suelta: deja una solicitud en curso. Si la prueba no lo suelta, se
// suelta cuando termina.
function manejadorQueEspera() {
  const soltada = Promise.withResolvers<void>();
  let empezadas = 0;
  onTestFinished(() => soltada.resolve());
  const manejador: Manejador = async () => {
    empezadas += 1;
    await soltada.promise;
    return { estado: 'terminada' };
  };
  return { manejador, empezadas: () => empezadas, soltar: () => soltada.resolve() };
}

// Uno que ocupa una conexión del pool con una consulta de 30 s.
const consultaLarga: Manejador = async (request) => {
  await request.server.pool.consultar('SELECT pg_sleep(30)');
  return { estado: 'terminada' };
};

const bien: Manejador = async () => ({ ok: true });

// Una conexión con el servicio que queda abierta: la prueba manda solicitudes por ella cuando quiere. `cerrada` se cumple
// cuando se cierra la conexión, con todo lo que llegó por ella; `cortar` la cierra del lado del cliente.
async function abrirConexion(puerto: number) {
  const socket = net.connect(puerto, '127.0.0.1');
  onTestFinished(() => {
    socket.destroy();
  });
  const partes: Buffer[] = [];
  socket.on('data', (parte: Buffer) => partes.push(parte));
  // Un RST también cierra la conexión: lo que importa es lo que llegó antes.
  socket.on('error', () => {});
  const cerrada = new Promise<string>((listo) => socket.once('close', () => listo(Buffer.concat(partes).toString('latin1'))));
  await new Promise<void>((listo) => socket.once('connect', listo));
  return { mandar: (texto: string) => socket.write(texto), cerrada, cortar: () => socket.destroy() };
}

// Una solicitud sin cuerpo, escrita a mano, con los encabezados que se pasen.
const pedido = (metodo: string, ruta: string, encabezados: Record<string, string> = {}) =>
  [
    `${metodo} ${ruta} HTTP/1.1`,
    'Host: 127.0.0.1',
    ...Object.entries(encabezados).map(([nombre, valor]) => `${nombre}: ${valor}`),
    '',
    '',
  ].join('\r\n');

type Respuesta = { estado: string; encabezados: Record<string, string>; cuerpo: string };

// Las respuestas que llegaron una detrás de otra por la misma conexión, con el cuerpo como texto. Content-Length cuenta bytes:
// por eso la respuesta cruda se lee como latin1, un carácter por byte, y cada cuerpo se pasa después a UTF-8.
function separarRespuestas(cruda: string): Respuesta[] {
  const respuestas: Respuesta[] = [];
  for (let resto = cruda; resto !== ''; ) {
    const { estado, encabezados, resto: despues } = leerRespuesta(resto);
    if (encabezados['content-length'] === undefined) throw new Error(`una respuesta sin Content-Length: ${estado}`);
    const largo = Number(encabezados['content-length']);
    respuestas.push({ estado, encabezados, cuerpo: Buffer.from(despues.slice(0, largo), 'latin1').toString('utf8') });
    resto = despues.slice(largo);
  }
  return respuestas;
}

const conMensaje = (lineas: LineaDeLog[], msg: string) => lineas.filter((linea) => linea.msg === msg);

let base: BaseDePrueba;
const andando: Servicio[] = [];

beforeEach(async () => {
  base = await crearBaseDePrueba();
});

// Cada servicio que arrancó se detiene antes de borrar la base; si una prueba dejó una solicitud colgada, se corta en
// 100 ms. Una consulta cortada retiene al pool hasta que la base la termina, y la base la termina al borrarse.
afterEach(async () => {
  vi.useRealTimers();
  const servicios = andando.splice(0);
  for (const servicio of servicios) await servicio.detener({ corteMs: 100 });
  await base.borrar();
  for (const servicio of servicios) await vi.waitFor(() => expect(servicio.pool.ended).toBe(true));
});

// Arranca el servicio con el contrato de prueba, un `salir` de prueba y el log capturado. probarTarda deja la solicitud en
// curso hasta que la prueba la suelta, y probarPublica ocupa una conexión del pool. Se detiene al terminar la prueba.
async function arrancarParaParar(cambios: Entorno = {}) {
  const puerto = await puertoLibre();
  const salir = vi.fn<Salir>();
  const logs = capturarLogs();
  const tarda = manejadorQueEspera();
  const servicio = await arrancar(entorno(base.urlBd, puerto, cambios), salir, {
    flujoLog: logs.flujo,
    rutaContrato: CONTRATO_PRUEBA,
    manejadores: { probarTarda: tarda.manejador, probarPublica: consultaLarga, probarProtegida: bien },
  });
  if (servicio === undefined) throw new Error(`el servicio no arrancó:\n${logs.texto()}`);
  andando.push(servicio);
  return { servicio, salir, logs, tarda, puerto };
}

// Arranca el servicio y deja una solicitud en curso, GET /pruebas/tarda, por una conexión que queda abierta.
async function conUnaEnCurso(cambios: Entorno = {}) {
  const arrancado = await arrancarParaParar(cambios);
  const conexion = await abrirConexion(arrancado.puerto);
  conexion.mandar(pedido('GET', '/pruebas/tarda'));
  await vi.waitFor(() => expect(arrancado.tarda.empezadas()).toBe(1));
  return { ...arrancado, conexion };
}

describe('detener: la parada en orden (RNF-04.5)', () => {
  it(
    'una solicitud en curso termina con su respuesta; recién después se cierra el pool y sale con 0, sin esperar al corte',
    async () => {
      const { servicio, salir, logs, tarda, conexion } = await conUnaEnCurso();
      // Una consulta deja abierta la conexión del pool que la parada tiene que cerrar.
      await servicio.pool.consultar('SELECT 1');
      await vi.waitFor(async () => expect(await sesionesAjenas(base.urlBd)).toBe(1));
      let poolCerradoAlSalir: boolean | undefined;
      salir.mockImplementation(() => {
        poolCerradoAlSalir = servicio.pool.ended;
      });

      const parada = servicio.detener();
      // Mientras la solicitud no termina, el servicio no sale.
      await new Promise((listo) => setTimeout(listo, 200));
      expect(salir).not.toHaveBeenCalled();
      tarda.soltar();
      const soltada = performance.now();
      const respuestas = separarRespuestas(await conexion.cerrada);
      await parada;
      const demora = performance.now() - soltada;

      expect(respuestas).toEqual([expect.objectContaining({ estado: 'HTTP/1.1 200 OK', cuerpo: '{"estado":"terminada"}' })]);
      expect(salir.mock.calls).toEqual([[0]]);
      expect(poolCerradoAlSalir).toBe(true);
      expect(demora).toBeLessThan(MARGEN_MS);
      await vi.waitFor(async () => expect(await sesionesAjenas(base.urlBd)).toBe(0));
      const lineas = logs.lineas();
      const mensajes = lineas.map(({ msg }) => msg);
      expect(mensajes.indexOf(DETENIENDO)).toBeGreaterThanOrEqual(0);
      expect(mensajes.indexOf(TERMINADA)).toBeGreaterThan(mensajes.indexOf(DETENIENDO));
      expect(mensajes.indexOf(DETENIDO)).toBeGreaterThan(mensajes.indexOf(TERMINADA));
      expect(conMensaje(lineas, DETENIENDO)).toEqual([expect.objectContaining({ level: INFO })]);
      expect(conMensaje(lineas, DETENIDO)).toEqual([expect.objectContaining({ level: INFO, cortadas: 0 })]);
      expect(lineas.filter(({ level }) => level >= WARN)).toEqual([]);
    },
    LIMITE_MS,
  );

  it('mientras termina la solicitud en curso, rechaza las conexiones nuevas', async () => {
    const { servicio, tarda, puerto } = await conUnaEnCurso();

    const parada = servicio.detener();
    // app.close() cierra el puerto unos ticks después, en su propio orden.
    await vi.waitFor(() => expect(servicio.app.server.listening).toBe(false));

    expect(await escucha(puerto)).toBe(false);
    tarda.soltar();
    await parada;
  });

  // Por una conexión que ya estaba abierta, detrás de la solicitud en curso. El 503 va antes que el 401, el 404 y el 405
  // (RNF-03.5, punto 2), y la conexión se cierra después de esa respuesta.
  it.each([
    ['sin token, a una operación que lo exige', 'GET', '/pruebas/protegida'],
    ['a una ruta que no existe', 'GET', '/pruebas/nada'],
    ['con un método que la ruta no tiene', 'POST', '/pruebas/tarda'],
    ['a GET /health', 'GET', '/health'],
  ])(
    'una solicitud %s que llega por una conexión abierta durante la parada recibe 503 en problem+json',
    async (_caso, metodo, ruta) => {
      const { servicio, salir, tarda, conexion } = await conUnaEnCurso();

      const parada = servicio.detener();
      conexion.mandar(pedido(metodo, ruta, { 'X-Request-Id': 'llega-durante-la-parada' }));
      // Fastify ya la leyó: su respuesta espera a que salga la de la primera.
      await vi.waitFor(() => expect(servicio.app.enCurso.size).toBe(2));
      tarda.soltar();
      const soltada = performance.now();
      const respuestas = separarRespuestas(await conexion.cerrada);
      await parada;
      const demora = performance.now() - soltada;

      expect(respuestas.map(({ estado }) => estado)).toEqual(['HTTP/1.1 200 OK', 'HTTP/1.1 503 Service Unavailable']);
      const { encabezados, cuerpo } = respuestas[1];
      expect(encabezados['content-type']).toMatch(PROBLEMA_JSON);
      expect(encabezados.connection).toBe('close');
      expect(encabezados['x-request-id']).toBe('llega-durante-la-parada');
      expect(encabezados['www-authenticate']).toBeUndefined();
      expect(encabezados.allow).toBeUndefined();
      expect(JSON.parse(cuerpo)).toEqual({
        type: 'about:blank',
        title: 'Servicio no disponible',
        status: 503,
        detail: 'El servicio se está deteniendo',
        instance: ruta,
      });
      expect(salir.mock.calls).toEqual([[0]]);
      expect(demora).toBeLessThan(MARGEN_MS);
    },
    LIMITE_MS,
  );

  // Fastify la responde antes de buscar la ruta, sin pasar por los hooks (RNF-03.5, punto 1).
  it(
    'una URL mal codificada que llega por una conexión abierta durante la parada recibe el 400, y se cierra la conexión',
    async () => {
      const { servicio, salir, logs, tarda, conexion } = await conUnaEnCurso();

      const parada = servicio.detener();
      conexion.mandar(pedido('GET', '/pruebas/%E0%A4%A'));
      // Su respuesta no pasa por enCurso: la señal de que Fastify ya la leyó es su línea de log.
      await vi.waitFor(() => expect(logs.lineas()).toContainEqual(expect.objectContaining({ msg: TERMINADA, estado: 400 })));
      tarda.soltar();
      const soltada = performance.now();
      const respuestas = separarRespuestas(await conexion.cerrada);
      await parada;
      const demora = performance.now() - soltada;

      expect(respuestas.map(({ estado }) => estado)).toEqual(['HTTP/1.1 200 OK', 'HTTP/1.1 400 Bad Request']);
      const { encabezados, cuerpo } = respuestas[1];
      expect(encabezados['content-type']).toMatch(PROBLEMA_JSON);
      expect(encabezados.connection).toBe('close');
      expect(JSON.parse(cuerpo)).toMatchObject({
        status: 400,
        detail: 'La URL no es válida, o un parámetro de la ruta supera los 100 caracteres',
      });
      expect(salir.mock.calls).toEqual([[0]]);
      expect(demora).toBeLessThan(MARGEN_MS);
    },
    LIMITE_MS,
  );

  it('llamada otra vez, durante la parada o después, no hace otra: un solo salir(0) y una sola línea de cada una', async () => {
    const { servicio, salir, logs, tarda } = await conUnaEnCurso();

    const primera = servicio.detener();
    const segunda = servicio.detener({ corteMs: 1 });
    await new Promise((listo) => setTimeout(listo, 100));
    tarda.soltar();
    await Promise.all([primera, segunda]);
    await servicio.detener();

    expect(salir.mock.calls).toEqual([[0]]);
    const lineas = logs.lineas();
    expect(conMensaje(lineas, DETENIENDO)).toHaveLength(1);
    expect(conMensaje(lineas, DETENIDO)).toEqual([expect.objectContaining({ cortadas: 0 })]);
    expect(lineas.filter(({ level }) => level >= WARN)).toEqual([]);
  });

  it('si algo falla al cerrar, lo registra y sale igual con 0', async () => {
    const { servicio, salir, logs } = await arrancarParaParar();
    // Cerrar el pool dos veces falla: es la falla más simple de provocar.
    await servicio.pool.end();

    await servicio.detener();

    expect(salir.mock.calls).toEqual([[0]]);
    expect(logs.lineas().filter(({ level }) => level === ERROR)).toEqual([
      expect.objectContaining({
        msg: NO_SE_DETUVO,
        err: expect.objectContaining({ mensaje: 'Called end on pool more than once' }),
      }),
    ]);
  });
});

describe('detener: el corte de lo que no termina (RNF-04.5)', () => {
  it('a los corteMs corta lo que no terminó, aunque ocupe el pool: deja una línea por cada una y sale igual con 0', async () => {
    // Con 20 s de tiempo de base, la consulta retiene su conexión del pool mucho más que el corte.
    const { servicio, salir, logs, tarda, puerto } = await arrancarParaParar({ M2_TIEMPO_BD_MS: '20000' });
    const espera = await abrirConexion(puerto);
    espera.mandar(pedido('GET', '/pruebas/tarda?pagina=1', { 'X-Request-Id': 'la-que-espera' }));
    const consulta = await abrirConexion(puerto);
    consulta.mandar(pedido('GET', '/pruebas/publica', { 'X-Request-Id': 'la-que-consulta' }));
    await vi.waitFor(() => expect(tarda.empezadas()).toBe(1));
    await vi.waitFor(async () => expect(await consultasLargas(base.urlBd)).toBe(1));
    const corteMs = 300;

    const inicio = performance.now();
    await servicio.detener({ corteMs });
    const demora = performance.now() - inicio;

    expect(salir.mock.calls).toEqual([[0]]);
    expect(demora).toBeGreaterThanOrEqual(corteMs - TOLERANCIA_MS);
    expect(demora).toBeLessThan(corteMs + MARGEN_MS);
    // Las dos conexiones se cerraron sin respuesta.
    expect(await espera.cerrada).toBe('');
    expect(await consulta.cerrada).toBe('');
    const lineas = logs.lineas();
    const cortadas = conMensaje(lineas, CORTADA);
    expect(cortadas).toHaveLength(2);
    for (const [idCorrelacion, ruta] of [
      ['la-que-espera', '/pruebas/tarda'],
      ['la-que-consulta', '/pruebas/publica'],
    ]) {
      expect(cortadas).toContainEqual(expect.objectContaining({ level: WARN, idCorrelacion, metodo: 'GET', ruta }));
    }
    for (const linea of cortadas) {
      expect(linea.duracionMs).toBeGreaterThanOrEqual(corteMs - TOLERANCIA_MS);
      expect(linea).not.toHaveProperty('estado');
    }
    expect(conMensaje(lineas, DETENIDO)).toEqual([expect.objectContaining({ level: INFO, cortadas: 2 })]);
    expect(conMensaje(lineas, TERMINADA)).toEqual([]);
  });

  // Con el reloj falso, salir(0) llega a los 8 s justos: el corte no espera nada más.
  it('sin corteMs, corta a los 8 s: salir(0) llega antes de los 10 s', async () => {
    const { servicio, salir, logs, conexion } = await conUnaEnCurso();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const parada = servicio.detener();
    await vi.advanceTimersByTimeAsync(CORTE_MS - 1);
    expect(salir).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await parada;

    expect(salir.mock.calls).toEqual([[0]]);
    expect(await conexion.cerrada).toBe('');
    expect(conMensaje(logs.lineas(), DETENIDO)).toEqual([expect.objectContaining({ cortadas: 1 })]);
  });

  // Ya no están en curso: la que terminó, aunque su conexión siga abierta con otra detrás, y las de una conexión que el
  // cliente cortó, la que tenía en curso y la que esperaba detrás de ella.
  it('corta solo lo que sigue en curso: no cuenta lo que terminó ni lo de una conexión que el cliente cortó', async () => {
    const { servicio, logs, tarda, puerto } = await arrancarParaParar();
    const viva = await abrirConexion(puerto);
    viva.mandar(pedido('GET', '/health') + pedido('GET', '/pruebas/tarda', { 'X-Request-Id': 'la-que-sigue' }));
    const cortada = await abrirConexion(puerto);
    cortada.mandar(pedido('GET', '/pruebas/tarda') + pedido('GET', '/pruebas/tarda'));
    await vi.waitFor(() => expect(tarda.empezadas()).toBe(3));

    cortada.cortar();
    await vi.waitFor(() => expect(servicio.app.enCurso.size).toBe(1));
    await servicio.detener({ corteMs: 200 });

    const respuestas = separarRespuestas(await viva.cerrada);
    expect(respuestas.map(({ estado, cuerpo }) => [estado, cuerpo])).toEqual([['HTTP/1.1 200 OK', '{"estado":"ok"}']]);
    const lineas = logs.lineas();
    expect(conMensaje(lineas, CORTADA)).toEqual([expect.objectContaining({ idCorrelacion: 'la-que-sigue' })]);
    expect(conMensaje(lineas, DETENIDO)).toEqual([expect.objectContaining({ cortadas: 1 })]);
  });
});

describe('src/servidor.ts, el punto de entrada: SIGTERM y SIGINT detienen el servicio (RNF-04.5)', () => {
  const SENALES = ['SIGTERM', 'SIGINT'] as const;

  afterEach(() => {
    vi.doUnmock('../../src/arranque.js');
    vi.resetModules();
  });

  // Ejecuta servidor.ts con un `arrancar` falso que devuelve `servicio`, y devuelve los oyentes que sumó a cada señal. Se
  // sacan al terminar la prueba.
  async function ejecutarServidor(servicio: Pick<Servicio, 'detener'> | undefined) {
    vi.resetModules();
    vi.doMock('../../src/arranque.js', () => ({ arrancar: async () => servicio }));
    const antes = new Map(SENALES.map((senal) => [senal, process.listeners(senal)]));
    await import('../../src/servidor.js');
    const sumados = new Map(
      SENALES.map((senal) => [senal, process.listeners(senal).filter((oyente) => !antes.get(senal)?.includes(oyente))]),
    );
    onTestFinished(() => {
      for (const [senal, oyentes] of sumados) for (const oyente of oyentes) process.off(senal, oyente);
    });
    return sumados;
  }

  it.each(SENALES)('%s llama a detener(), y el oyente queda para la señal siguiente', async (senal) => {
    const detener = vi.fn(async () => {});
    const sumados = await ejecutarServidor({ detener });

    const [oyente, ...otros] = sumados.get(senal) ?? [];
    expect(otros).toEqual([]);
    oyente?.(senal);

    expect(detener).toHaveBeenCalledOnce();
    // Con `once`, rawListeners tendría el envoltorio y no el oyente: una segunda señal haría lo de siempre en Node, terminar
    // el proceso sin esperar a la parada.
    expect(process.rawListeners(senal)).toContain(oyente);
  });

  it('si no arrancó, no atiende las señales: no hay nada que detener', async () => {
    const sumados = await ejecutarServidor(undefined);

    expect([...sumados.values()]).toEqual([[], []]);
  });
});
