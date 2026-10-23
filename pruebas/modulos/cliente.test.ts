import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ModuloNoDisponible } from '../../src/errores.js';
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
});
