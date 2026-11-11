import type { FastifyBaseLogger } from 'fastify';
import { createServer } from 'node:net';
import { inspect } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aProblema, ModuloNoDisponible } from '../../src/errores.js';
import { serializarError } from '../../src/logs.js';
import { crearClienteModulo } from '../../src/modulos/cliente.js';
import { crearServidorModulo } from '../ayudas/servidor-modulo.js';

const TIEMPO_MS = 200;
// La pausa entre un intento y el siguiente (plan, Integraciones).
const PAUSA_MS = 200;

// Una URL a la que no escucha nadie: el puerto que acaba de dejar libre un servidor que se cerró.
async function urlSinServidor(): Promise<string> {
  const servidor = createServer();
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const { port } = servidor.address() as { port: number };
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

const clienteDe = (urlBase: string, reintentos: number, tiempoMs = 2000) =>
  crearClienteModulo({ nombre: 'M6', urlBase, tiempoMs, reintentos, encabezadoCorrelacion: 'X-Request-Id' });

describe('crearClienteModulo', () => {
  const serv = crearServidorModulo();

  beforeAll(async () => {
    await serv.levantar();
  });

  afterAll(async () => {
    await serv.cerrar();
  });

  // ## T24

  it('corta el intento aunque los encabezados lleguen antes del plazo', async () => {
    serv.responderCon({ tipo: 'demora-cuerpo', retardoMs: TIEMPO_MS * 4 });
    const cliente = crearClienteModulo({
      nombre: 'M6',
      urlBase: serv.url,
      tiempoMs: TIEMPO_MS,
      reintentos: 0,
      encabezadoCorrelacion: 'X-Request-Id',
    });

    const inicio = Date.now();
    await expect(cliente.obtener('/', 'id-prueba')).rejects.toThrow(ModuloNoDisponible);
    expect(Date.now() - inicio).toBeLessThan(TIEMPO_MS * 3);
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(TIEMPO_MS - 20);
  });

  it('envía el id de correlación en el encabezado configurado', async () => {
    serv.responderCon({ tipo: 'ok', cuerpo: { ok: true } });
    const cliente = crearClienteModulo({
      nombre: 'M6',
      urlBase: serv.url,
      tiempoMs: 2000,
      reintentos: 0,
      encabezadoCorrelacion: 'X-Request-Id',
    });
    await cliente.obtener('/', 'mi-id-de-prueba');
    expect(serv.encabezadosRecibidos.get('x-request-id')).toBe('mi-id-de-prueba');
  });

  it('devuelve el estado y el cuerpo de un 4xx sin reintentar', async () => {
    const cuerpoProblem = { type: 'about:blank', title: 'No encontrado', status: 404 };
    serv.responderCon({ tipo: '4xx', estado: 404, cuerpo: cuerpoProblem });
    const cliente = crearClienteModulo({
      nombre: 'M6',
      urlBase: serv.url,
      tiempoMs: 2000,
      reintentos: 1,
      encabezadoCorrelacion: 'X-Request-Id',
    });

    const resultado = await cliente.obtener('/', 'id');
    expect(resultado.estado).toBe(404);
    expect(resultado.cuerpo).toEqual(cuerpoProblem);
    expect(serv.llamadas).toBe(1);
  });

  it('devuelve el estado y el cuerpo como texto si un 4xx no responde con JSON', async () => {
    serv.responderCon({ tipo: 'no-json', estado: 400 });
    const cliente = crearClienteModulo({
      nombre: 'M6',
      urlBase: serv.url,
      tiempoMs: 2000,
      reintentos: 1,
      encabezadoCorrelacion: 'X-Request-Id',
    });

    const resultado = await cliente.enviar('POST', '/ruta-error', { dato: 1 }, 'id');
    expect(resultado.estado).toBe(400);
    expect(typeof resultado.cuerpo).toBe('string');
    expect(serv.llamadas).toBe(1);
  });

  it('lanza ModuloNoDisponible ante un 2xx sin cuerpo JSON (204)', async () => {
    serv.responderCon({ tipo: 'no-json', contenido: '', estado: 204 });
    const cliente = crearClienteModulo({
      nombre: 'M6',
      urlBase: serv.url,
      tiempoMs: 2000,
      reintentos: 0,
      encabezadoCorrelacion: 'X-Request-Id',
    });
    await expect(cliente.obtener('/', 'id')).rejects.toThrow(ModuloNoDisponible);
  });

  // ## T25

  describe.each([
    ['un 5xx', { tipo: '5xx', estado: 500 }],
    ['un corte de la conexión', { tipo: 'corta' }],
    ['una respuesta que no es JSON', { tipo: 'no-json' }],
    ['un corte por tiempo', { tipo: 'demora-cuerpo', retardoMs: TIEMPO_MS * 4 }],
  ] as const)('un GET con %s', (_nombre, falla) => {
    it('se reintenta una vez a los 200 ms y devuelve lo que responda el segundo intento', async () => {
      serv.responderCon([falla, { tipo: 'ok', cuerpo: { dato: 7 } }]);

      const resultado = await clienteDe(serv.url, 1, TIEMPO_MS).obtener('/', 'id');

      expect(resultado).toEqual({ estado: 200, cuerpo: { dato: 7 } });
      expect(serv.llamadas).toBe(2);
      // La pausa se cuenta desde que falló el primer intento; con el corte por tiempo, esa espera ya pasó antes del segundo.
      const [primera, segunda] = serv.momentos as [number, number];
      const esperado = falla.tipo === 'demora-cuerpo' ? TIEMPO_MS + PAUSA_MS : PAUSA_MS;
      expect(segunda - primera).toBeGreaterThanOrEqual(esperado - 20);
      expect(segunda - primera).toBeLessThan(esperado + 150);
    });

    it('da ModuloNoDisponible cuando el segundo intento también falla', async () => {
      serv.responderCon(falla);

      await expect(clienteDe(serv.url, 1, TIEMPO_MS).obtener('/', 'id')).rejects.toMatchObject({
        codigo: 503,
        detail: 'M6 no está disponible',
      });
      expect(serv.llamadas).toBe(2);
    });
  });

  // La causa la registra el manejador de errores con el id de la solicitud (RNF-14.8; plan, Integraciones).
  describe('ModuloNoDisponible lleva en cause lo que falló en el último intento', () => {
    const causaDe = async (promesa: Promise<unknown>) => {
      const error = await promesa.catch((motivo: unknown) => motivo);
      expect(error).toBeInstanceOf(ModuloNoDisponible);
      return (error as Error).cause;
    };

    it.each([
      [
        'un 5xx: el código, sin el cuerpo',
        { tipo: '5xx', estado: 502, cuerpo: { secreto: 'del-cuerpo' } },
        { message: 'M6 respondió 502' },
      ],
      ['un corte de la conexión: el error de fetch', { tipo: 'corta' }, { name: 'TypeError', message: 'fetch failed' }],
      // El SyntaxError de JSON.parse copia un pedazo del texto en su mensaje: la causa no puede ser ese error.
      [
        'un cuerpo que no es JSON: el código, sin el cuerpo',
        { tipo: 'no-json', contenido: '<html><body>del-cuerpo, Av. Siempre Viva 742</body></html>' },
        { message: 'M6 respondió 200 con un cuerpo que no es JSON' },
      ],
      ['un corte por tiempo: el del plazo', { tipo: 'demora-cuerpo', retardoMs: TIEMPO_MS * 4 }, { name: 'TimeoutError' }],
    ] as const)('%s', async (_caso, falla, causa) => {
      serv.responderCon(falla);

      const error = await causaDe(clienteDe(serv.url, 0, TIEMPO_MS).obtener('/', 'id'));

      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject(causa);
      // La causa va al log (RNF-14.8), y el log no lleva cuerpos (RNF-19.2): ni en el mensaje ni en la traza.
      expect(String((error as Error).message)).not.toContain('del-cuerpo');
      expect(String((error as Error).stack)).not.toContain('del-cuerpo');
    });

    it('con un reintento, es la del segundo intento y no la del primero', async () => {
      serv.responderCon([{ tipo: '5xx', estado: 500 }, { tipo: '5xx', estado: 503 }]);

      expect(await causaDe(clienteDe(serv.url, 1, TIEMPO_MS).obtener('/', 'id'))).toMatchObject({
        message: 'M6 respondió 503',
      });
    });

    it('ante una conexión rechazada, el error de fetch con el ECONNREFUSED en su causa', async () => {
      const error = await causaDe(clienteDe(await urlSinServidor(), 0).obtener('/', 'id'));

      expect(error).toMatchObject({ message: 'fetch failed', cause: { code: 'ECONNREFUSED' } });
    });

    it('en un POST, que no se reintenta, la del único intento', async () => {
      serv.responderCon({ tipo: '5xx', estado: 500 });

      expect(await causaDe(clienteDe(serv.url, 1).enviar('POST', '/', { dato: 1 }, 'id'))).toMatchObject({
        message: 'M6 respondió 500',
      });
    });
  });

  it('reintenta un GET ante una conexión rechazada y da ModuloNoDisponible', async () => {
    const url = await urlSinServidor();
    const inicio = Date.now();

    await expect(clienteDe(url, 1).obtener('/', 'id')).rejects.toThrow(ModuloNoDisponible);
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(PAUSA_MS - 20);
  });

  it('no reintenta un POST: un 5xx da ModuloNoDisponible a la primera', async () => {
    serv.responderCon({ tipo: '5xx', estado: 503 });

    await expect(clienteDe(serv.url, 1).enviar('POST', '/', { dato: 1 }, 'id')).rejects.toThrow(ModuloNoDisponible);
    expect(serv.llamadas).toBe(1);
  });

  it('hace 1 + reintentos intentos en un GET, y con reintentos 0 hace uno', async () => {
    serv.responderCon({ tipo: '5xx', estado: 500 });
    await expect(clienteDe(serv.url, 2).obtener('/', 'id')).rejects.toThrow(ModuloNoDisponible);
    expect(serv.llamadas).toBe(3);

    serv.responderCon({ tipo: '5xx', estado: 500 });
    await expect(clienteDe(serv.url, 0).obtener('/', 'id')).rejects.toThrow(ModuloNoDisponible);
    expect(serv.llamadas).toBe(1);
  });

  it('con los valores por defecto, un módulo que nunca contesta termina en no más de 4,2 s', async () => {
    serv.responderCon({ tipo: 'demora-cuerpo', retardoMs: 10_000 });
    const inicio = Date.now();

    await expect(clienteDe(serv.url, 1).obtener('/', 'id')).rejects.toThrow(ModuloNoDisponible);

    const tardo = Date.now() - inicio;
    expect(serv.llamadas).toBe(2);
    // 2 s + 200 ms + 2 s, más un margen para los temporizadores.
    expect(tardo).toBeGreaterThanOrEqual(4200 - 50);
    expect(tardo).toBeLessThan(4200 + 300);
  }, 10_000);

  // ## Spec 007, T2 y T10

  const CREDENCIAL = 'credencial-de-m2-ante-m6';
  const conCredencial = (urlBase: string, reintentos = 0, credencial = async () => CREDENCIAL) =>
    crearClienteModulo({
      nombre: 'M6',
      urlBase,
      tiempoMs: TIEMPO_MS,
      reintentos,
      encabezadoCorrelacion: 'X-Request-Id',
      credencial,
      reintentarDespuesS: 5,
    });

  // Una credencial distinta en cada llamada, como el token de servicio que se firma por intento (RF-2.4.11).
  const credencialPorLlamada = () => {
    let n = 0;
    const credencial = async () => `token-${++n}`;
    return { credencial, llamadas: () => n };
  };

  describe('la credencial ante el módulo (RNF-06, RF-2.4.6, RF-2.4.11)', () => {
    it('va en Authorization: Bearer en un GET y en un POST', async () => {
      serv.responderCon({ tipo: 'ok', cuerpo: { ok: true } });

      await conCredencial(serv.url).obtener('/', 'id');
      expect(serv.encabezadosRecibidos.get('authorization')).toBe(`Bearer ${CREDENCIAL}`);

      await conCredencial(serv.url).enviar('POST', '/', { dato: 1 }, 'id');
      expect(serv.encabezadosRecibidos.get('authorization')).toBe(`Bearer ${CREDENCIAL}`);
    });

    it('se pide en cada intento: el reintento lleva su propia credencial', async () => {
      serv.responderCon([{ tipo: '5xx', estado: 500 }, { tipo: 'ok', cuerpo: { ok: true } }]);
      const { credencial, llamadas } = credencialPorLlamada();

      await conCredencial(serv.url, 1, credencial).obtener('/', 'id');

      expect(serv.llamadas).toBe(2);
      expect(llamadas()).toBe(2);
      expect(serv.autorizaciones).toEqual(['Bearer token-1', 'Bearer token-2']);
    });

    it('cada pedido pide la suya: no se guarda de un pedido al siguiente', async () => {
      serv.responderCon({ tipo: 'ok', cuerpo: { ok: true } });
      const { credencial } = credencialPorLlamada();
      const cliente = conCredencial(serv.url, 0, credencial);

      await cliente.obtener('/', 'id');
      await cliente.enviar('POST', '/', { dato: 1 }, 'id');

      expect(serv.autorizaciones).toEqual(['Bearer token-1', 'Bearer token-2']);
    });

    // Si M2 no puede dar su credencial, la falla es de M2 y no del módulo: no se llama, no se reintenta y no es un 503.
    it('si la credencial falla, el error sale tal cual, sin llamar al módulo ni reintentar', async () => {
      serv.responderCon({ tipo: 'ok', cuerpo: { ok: true } });
      const falla = new Error('no se pudo firmar');
      let pedidas = 0;
      const credencial = async () => {
        pedidas++;
        throw falla;
      };

      await expect(conCredencial(serv.url, 1, credencial).obtener('/', 'id')).rejects.toBe(falla);
      expect(pedidas).toBe(1);
      expect(serv.llamadas).toBe(0);
    });

    it('sin credencial no se envía Authorization', async () => {
      serv.responderCon({ tipo: 'ok', cuerpo: { ok: true } });

      await clienteDe(serv.url, 0).obtener('/', 'id');
      expect(serv.encabezadosRecibidos.has('authorization')).toBe(false);
    });

    // El 503 va al log con su causa (RNF-14.8): ni el detail, ni la causa, ni lo que el log guarda del error la traen (RNF-19).
    it.each([
      ['un 5xx que repite la credencial en su cuerpo', { tipo: '5xx', estado: 500, cuerpo: { error: `Bearer ${CREDENCIAL}` } }],
      ['un cuerpo que no es JSON y la repite', { tipo: 'no-json', contenido: `Bearer ${CREDENCIAL}` }],
      ['un corte de la conexión', { tipo: 'corta' }],
      ['un corte por tiempo', { tipo: 'demora-cuerpo', retardoMs: TIEMPO_MS * 4 }],
    ] as const)('no aparece en el error ante %s', async (_caso, falla) => {
      serv.responderCon(falla);

      const error = await conCredencial(serv.url).obtener('/', 'id').catch((motivo: unknown) => motivo);

      expect(error).toBeInstanceOf(ModuloNoDisponible);
      expect(JSON.stringify(aProblema(error).cuerpo)).not.toContain(CREDENCIAL);
      expect(inspect(error, { depth: 10 })).not.toContain(CREDENCIAL);
      // Sin ningún secreto que ocultar: lo que el log guarda no la trae ni siquiera antes de limpiarlo.
      expect(JSON.stringify(serializarError(error, []))).not.toContain(CREDENCIAL);
    });

    it('no aparece en el error ante una conexión rechazada', async () => {
      const error = await conCredencial(await urlSinServidor()).obtener('/', 'id').catch((motivo: unknown) => motivo);

      expect(error).toBeInstanceOf(ModuloNoDisponible);
      expect(inspect(error, { depth: 10 })).not.toContain(CREDENCIAL);
      expect(JSON.stringify(serializarError(error, []))).not.toContain(CREDENCIAL);
    });
  });

  // ## Spec 007, T11
  //
  // Toda llamada al módulo deja una sola línea al terminar, salga bien o mal (RNF-14.10). Sin la ruta, que lleva el clienteId o el
  // viajeId, ni encabezados ni cuerpos (RNF-19).
  describe('la línea de log de cada llamada (RNF-14.10)', () => {
    type Linea = { nivel: 'info' | 'warn'; campos: Record<string, unknown>; mensaje: string };
    const logDePrueba = () => {
      const lineas: Linea[] = [];
      const log = {
        info: (campos: Record<string, unknown>, mensaje: string) => lineas.push({ nivel: 'info', campos, mensaje }),
        warn: (campos: Record<string, unknown>, mensaje: string) => lineas.push({ nivel: 'warn', campos, mensaje }),
      };
      return { log, lineas };
    };
    const conLog = (log: ReturnType<typeof logDePrueba>['log'], reintentos = 1) =>
      crearClienteModulo({
        nombre: 'M6',
        urlBase: serv.url,
        tiempoMs: TIEMPO_MS,
        reintentos,
        encabezadoCorrelacion: 'X-Request-Id',
        credencial: async () => CREDENCIAL,
        log,
      });
    const RUTA = '/trips?clientId=ruta-con-datos-del-cliente';

    it('un 200: info, con correlación, módulo, método, código, un intento y la duración', async () => {
      serv.responderCon({ tipo: 'ok', cuerpo: { dato: 'del-cuerpo' } });
      const { log, lineas } = logDePrueba();

      await conLog(log).obtener(RUTA, 'id-de-la-solicitud');

      expect(lineas).toHaveLength(1);
      expect(lineas[0]).toMatchObject({
        nivel: 'info',
        mensaje: 'llamada a M6',
        campos: { idCorrelacion: 'id-de-la-solicitud', modulo: 'M6', metodo: 'GET', estado: 200, intentos: 1 },
      });
      expect(lineas[0]?.campos.duracionMs).toBeTypeOf('number');
      // Lista cerrada de campos: ni la ruta, ni la credencial, ni el cuerpo.
      expect(Object.keys(lineas[0]?.campos ?? {}).sort()).toEqual(
        ['duracionMs', 'estado', 'idCorrelacion', 'intentos', 'metodo', 'modulo'].sort(),
      );
      const texto = JSON.stringify(lineas);
      for (const dato of ['ruta-con-datos-del-cliente', CREDENCIAL, 'del-cuerpo']) expect(texto).not.toContain(dato);
    });

    it('un 4xx: info con ese código, porque el módulo respondió', async () => {
      serv.responderCon({ tipo: '4xx', estado: 404, cuerpo: { title: 'No encontrado' } });
      const { log, lineas } = logDePrueba();

      await conLog(log).obtener(RUTA, 'id-del-404');

      expect(lineas).toHaveLength(1);
      expect(lineas[0]).toMatchObject({
        nivel: 'info',
        mensaje: 'llamada a M6',
        campos: { idCorrelacion: 'id-del-404', modulo: 'M6', metodo: 'GET', estado: 404, intentos: 1 },
      });
      expect(lineas[0]?.campos.duracionMs).toBeTypeOf('number');
    });

    it('bien al segundo intento: una sola línea, con dos intentos, el código final y la pausa en la duración', async () => {
      serv.responderCon([{ tipo: '5xx', estado: 500 }, { tipo: 'ok', cuerpo: { ok: true } }]);
      const { log, lineas } = logDePrueba();

      await conLog(log).obtener(RUTA, 'id-del-reintento');

      expect(lineas).toHaveLength(1);
      expect(lineas[0]).toMatchObject({
        nivel: 'info',
        campos: { idCorrelacion: 'id-del-reintento', modulo: 'M6', metodo: 'GET', estado: 200, intentos: 2 },
      });
      expect(lineas[0]?.campos.duracionMs as number).toBeGreaterThanOrEqual(PAUSA_MS - 20);
    });

    it('agotados los intentos con un 5xx: warn, con el código que respondió y los intentos que hizo', async () => {
      serv.responderCon({ tipo: '5xx', estado: 502, cuerpo: { secreto: 'del-cuerpo' } });
      const { log, lineas } = logDePrueba();

      await expect(conLog(log).obtener(RUTA, 'id')).rejects.toThrow(ModuloNoDisponible);

      expect(lineas).toHaveLength(1);
      expect(lineas[0]).toMatchObject({
        nivel: 'warn',
        mensaje: 'llamada a M6',
        campos: { idCorrelacion: 'id', modulo: 'M6', metodo: 'GET', estado: 502, intentos: 2 },
      });
      // Dos intentos y una pausa entre ellos.
      expect(lineas[0]?.campos.duracionMs as number).toBeGreaterThanOrEqual(PAUSA_MS - 20);
      expect(JSON.stringify(lineas)).not.toContain('del-cuerpo');
    });

    it('agotados los intentos con un 200 que no es JSON: warn, con ese 200', async () => {
      serv.responderCon({ tipo: 'no-json', contenido: 'texto-del-cuerpo' });
      const { log, lineas } = logDePrueba();

      await expect(conLog(log).obtener(RUTA, 'id')).rejects.toThrow(ModuloNoDisponible);

      expect(lineas).toEqual([
        expect.objectContaining({ nivel: 'warn', campos: expect.objectContaining({ estado: 200, intentos: 2 }) }),
      ]);
      expect(JSON.stringify(lineas)).not.toContain('texto-del-cuerpo');
    });

    it('si el último intento no tuvo respuesta, el código es null aunque el anterior la tuviera', async () => {
      serv.responderCon([{ tipo: '5xx', estado: 503 }, { tipo: 'demora-cuerpo', retardoMs: TIEMPO_MS * 4 }]);
      const { log, lineas } = logDePrueba();

      await expect(conLog(log).obtener(RUTA, 'id')).rejects.toThrow(ModuloNoDisponible);

      expect(lineas).toEqual([
        expect.objectContaining({ nivel: 'warn', campos: expect.objectContaining({ estado: null, intentos: 2 }) }),
      ]);
    });

    it('un POST, que no se reintenta, deja su línea con el método', async () => {
      serv.responderCon({ tipo: 'ok', cuerpo: { ok: true } });
      const { log, lineas } = logDePrueba();

      await conLog(log).enviar('POST', '/', { dato: 1 }, 'id');

      expect(lineas).toEqual([expect.objectContaining({ campos: expect.objectContaining({ metodo: 'POST', estado: 200, intentos: 1 }) })]);
    });

    it('sin log no escribe nada y la llamada sale igual, bien o mal', async () => {
      serv.responderCon({ tipo: 'ok', cuerpo: { ok: true } });
      await expect(clienteDe(serv.url, 1).obtener(RUTA, 'id')).resolves.toEqual({ estado: 200, cuerpo: { ok: true } });

      serv.responderCon({ tipo: '5xx', estado: 502 });
      await expect(clienteDe(serv.url, 1).obtener(RUTA, 'id')).rejects.toThrow(ModuloNoDisponible);
    });

    it('si M2 no puede dar la credencial, no se llamó al módulo y no hay línea', async () => {
      const { log, lineas } = logDePrueba();
      const cliente = crearClienteModulo({
        nombre: 'M6',
        urlBase: serv.url,
        tiempoMs: TIEMPO_MS,
        reintentos: 1,
        encabezadoCorrelacion: 'X-Request-Id',
        credencial: async () => {
          throw new Error('no se pudo firmar');
        },
        log,
      });

      await expect(cliente.obtener(RUTA, 'id')).rejects.toThrow('no se pudo firmar');
      expect(lineas).toEqual([]);
    });

    it('si la credencial falla en el segundo intento, queda la línea con el intento que salió', async () => {
      serv.responderCon({ tipo: '5xx', estado: 502 });
      const { log, lineas } = logDePrueba();
      let firmas = 0;
      const cliente = crearClienteModulo({
        nombre: 'M6',
        urlBase: serv.url,
        tiempoMs: TIEMPO_MS,
        reintentos: 1,
        encabezadoCorrelacion: 'X-Request-Id',
        credencial: async () => {
          firmas += 1;
          if (firmas > 1) throw new Error('no se pudo firmar');
          return CREDENCIAL;
        },
        log,
      });

      await expect(cliente.obtener(RUTA, 'id')).rejects.toThrow('no se pudo firmar');
      expect(lineas).toEqual([
        expect.objectContaining({ nivel: 'warn', campos: expect.objectContaining({ estado: 502, intentos: 1 }) }),
      ]);
    });
  });

  // La opción es del cliente y no de M6: cada módulo declara su encabezado y su largo en su contrato (plan 007, Decisiones).
  describe('el encabezado de correlación propio del módulo (RNF-14.11, RNF-14.12; 007/T13)', () => {
    const conPropio = (encabezadoCorrelacion = 'X-Request-Id') =>
      crearClienteModulo({
        nombre: 'M6',
        urlBase: serv.url,
        tiempoMs: TIEMPO_MS,
        reintentos: 1,
        encabezadoCorrelacion,
        correlacionDelModulo: { encabezado: 'X-Traza', largoMaximo: 8 },
      });

    it('sin la opción, el cliente manda lo mismo que antes: solo el encabezado configurado', async () => {
      serv.responderCon([{ tipo: '5xx', estado: 502 }, { tipo: 'ok' }]);

      await clienteDe(serv.url, 1).obtener('/', 'a'.repeat(128));

      expect(serv.llamadas).toBe(2);
      for (const intento of [0, 1]) {
        expect(serv.valoresDe(intento, 'x-request-id')).toEqual(['a'.repeat(128)]);
        expect(serv.valoresDe(intento, 'x-correlation-id')).toEqual([]);
      }
    });

    it('con la opción, el identificador va en el encabezado del módulo y en el configurado, también en un POST', async () => {
      serv.responderCon({ tipo: 'ok' });

      await conPropio().enviar('POST', '/', { dato: 1 }, 'id-corto');

      expect(serv.valoresDe(0, 'x-traza')).toEqual(['id-corto']);
      expect(serv.valoresDe(0, 'x-request-id')).toEqual(['id-corto']);
    });

    it('si el identificador pasa del largo máximo del módulo, va solo en el configurado', async () => {
      serv.responderCon({ tipo: 'ok' });

      await conPropio().obtener('/', 'id-de-nueve'.slice(0, 9));

      expect(serv.valoresDe(0, 'x-traza')).toEqual([]);
      expect(serv.valoresDe(0, 'x-request-id')).toEqual(['id-de-nueve'.slice(0, 9)]);
    });

    it('si el encabezado del módulo es el configurado, sale una vez y, pasado el largo máximo, no sale', async () => {
      serv.responderCon({ tipo: 'ok' });
      await conPropio('x-traza').obtener('/', 'id-corto');
      expect(serv.valoresDe(0, 'x-traza')).toEqual(['id-corto']);

      serv.responderCon({ tipo: 'ok' });
      await conPropio('x-traza').obtener('/', 'id-de-nueve'.slice(0, 9));
      expect(serv.llamadas).toBe(1);
      expect(serv.valoresDe(0, 'x-traza')).toEqual([]);
    });
  });

  // El cliente entrega el encabezado sin interpretarlo: qué vale lo decide quien conoce el contrato del módulo (plan 007).
  describe('el Retry-After de un 4xx del módulo (RF-2.4.15; 007/T14)', () => {
    it.each([
      ['un número de segundos', '30', '30'],
      ['ceros a la izquierda', '030', '030'],
      ['una fecha HTTP', 'Wed, 11 Nov 2026 20:00:00 GMT', 'Wed, 11 Nov 2026 20:00:00 GMT'],
      ['algo que no es un número', '30s', '30s'],
      ['el encabezado repetido', ['30', '30'], '30, 30'],
    ])('la respuesta trae reintentarDespues tal como llegó: %s', async (_caso, enviado, recibido) => {
      serv.responderCon({ tipo: '4xx', estado: 429, encabezados: { 'Retry-After': enviado } });

      const resultado = await clienteDe(serv.url, 1).obtener('/', 'id');

      expect(resultado).toStrictEqual({ estado: 429, cuerpo: { type: 'about:blank', status: 429 }, reintentarDespues: recibido });
    });

    it('también si el 4xx no responde con JSON y en un POST', async () => {
      serv.responderCon({ tipo: 'no-json', estado: 429, encabezados: { 'Retry-After': '12' } });

      const resultado = await clienteDe(serv.url, 1).enviar('POST', '/', { dato: 1 }, 'id');

      expect(resultado).toStrictEqual({ estado: 429, cuerpo: 'no es json', reintentarDespues: '12' });
    });

    it('si el 4xx no tiene Retry-After, la respuesta no trae reintentarDespues', async () => {
      serv.responderCon({ tipo: '4xx', estado: 429 });

      const resultado = await clienteDe(serv.url, 1).obtener('/', 'id');

      expect(resultado).toStrictEqual({ estado: 429, cuerpo: { type: 'about:blank', status: 429 } });
      expect('reintentarDespues' in resultado).toBe(false);
    });

    it('un 4xx con Retry-After se sigue devolviendo sin reintento, sea un GET o un POST', async () => {
      serv.responderCon({ tipo: '4xx', estado: 429, encabezados: { 'Retry-After': '1' } });
      await clienteDe(serv.url, 1).obtener('/', 'id');
      expect(serv.llamadas).toBe(1);

      serv.responderCon({ tipo: '4xx', estado: 404, encabezados: { 'Retry-After': '1' } });
      await clienteDe(serv.url, 1).enviar('POST', '/', { dato: 1 }, 'id');
      expect(serv.llamadas).toBe(1);
    });

    it('solo en un 4xx: un 200 con Retry-After no trae reintentarDespues', async () => {
      serv.responderCon({ tipo: 'ok', cuerpo: { dato: 7 }, encabezados: { 'Retry-After': '30' } });

      const resultado = await clienteDe(serv.url, 1).obtener('/', 'id');

      expect(resultado).toStrictEqual({ estado: 200, cuerpo: { dato: 7 } });
    });

    it('la línea de la llamada no cambia: lleva el estado y no el Retry-After', async () => {
      serv.responderCon({ tipo: '4xx', estado: 429, encabezados: { 'Retry-After': '30' } });
      const lineas: { nivel: string; campos: Record<string, unknown> }[] = [];
      const anotar = (nivel: string) => (campos: Record<string, unknown>) => void lineas.push({ nivel, campos });
      const cliente = crearClienteModulo({
        nombre: 'M6',
        urlBase: serv.url,
        tiempoMs: TIEMPO_MS,
        reintentos: 1,
        encabezadoCorrelacion: 'X-Request-Id',
        log: { info: anotar('info'), warn: anotar('warn') } as unknown as FastifyBaseLogger,
      });

      await cliente.obtener('/', 'id');

      expect(lineas).toHaveLength(1);
      expect(lineas[0]!.nivel).toBe('info');
      expect(Object.keys(lineas[0]!.campos).sort()).toEqual(['duracionMs', 'estado', 'idCorrelacion', 'intentos', 'metodo', 'modulo']);
      expect(lineas[0]!.campos).toMatchObject({ estado: 429, intentos: 1 });
    });
  });

  describe('Retry-After en el 503 (RF-2.4.6)', () => {
    it('con reintentarDespuesS, ModuloNoDisponible lo lleva en segundos', async () => {
      serv.responderCon({ tipo: '5xx', estado: 500 });

      const error = await conCredencial(serv.url).obtener('/', 'id').catch((motivo: unknown) => motivo);

      expect(error).toBeInstanceOf(ModuloNoDisponible);
      expect(aProblema(error).encabezados['Retry-After']).toBe('5');
    });

    it('sin reintentarDespuesS, el 503 queda como antes: sin Retry-After', async () => {
      serv.responderCon({ tipo: '5xx', estado: 500 });

      const error = await clienteDe(serv.url, 0).obtener('/', 'id').catch((motivo: unknown) => motivo);

      expect(error).toBeInstanceOf(ModuloNoDisponible);
      expect(aProblema(error).encabezados).toEqual({ 'Content-Type': 'application/problem+json' });
    });
  });
});
