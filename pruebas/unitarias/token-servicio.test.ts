import { decodeProtectedHeader, jwtVerify } from 'jose';
import { createServer } from 'node:net';
import { inspect } from 'node:util';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearTokenServicio, crearTokenServicioHs256 } from '../../src/auth/token-servicio.js';
import { ErrorDeIntegracion, ModuloNoDisponible } from '../../src/errores.js';
import { CONFIG } from '../ayudas/app.js';
import { crearServidorModulo, TIEMPO_HOLGADO_MS, terminaPorTiempo, type Comportamiento } from '../ayudas/servidor-modulo.js';

// Una URL a la que no escucha nadie: el puerto que acaba de dejar libre un servidor que se cerró.
async function urlSinServidor(): Promise<string> {
  const servidor = createServer();
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const { port } = servidor.address() as { port: number };
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

// El token con el que M2 se presenta ante M6 (spec 125). Sin las variables de Keycloak es el HS256 de siempre (RF-2.4.11.2): uno
// nuevo en cada pedido, que nunca se guarda ni se reutiliza.
describe('token de servicio HS256 (spec 125, RF-2.4.11.2)', () => {
  const config = { ...CONFIG, audienciaM6: 'm6-de-prueba' };

  // Como lo verificaría M6: con la clave del consorcio, el emisor de M1 y su propia audiencia.
  const comoM6 = (token: string) =>
    jwtVerify(token, new TextEncoder().encode(config.claveTokens), {
      algorithms: ['HS256'],
      issuer: config.emisorTokens,
      audience: 'm6-de-prueba',
      requiredClaims: ['exp'],
    });

  it('es el modo hs256', () => {
    expect(crearTokenServicioHs256(config).modo).toBe('hs256');
  });

  it('da el token de RF-2.4.11: HS256, sub m2-clientes, roles SERVICIO, la audiencia de M6 y 60 s de vida', async () => {
    const { token, reutilizado } = await crearTokenServicioHs256(config).obtener('id-de-correlacion');

    expect(reutilizado).toBe(false);
    expect(decodeProtectedHeader(token)).toStrictEqual({ alg: 'HS256', typ: 'JWT' });
    const { payload } = await comoM6(token);
    expect(payload).toMatchObject({ sub: 'm2-clientes', roles: ['SERVICIO'], aud: 'm6-de-prueba' });
    expect(payload.exp! - payload.iat!).toBe(60);
  });

  it('cada pedido firma uno nuevo, nunca reutilizado, y descartar no cambia nada', async () => {
    const tokenServicio = crearTokenServicioHs256(config);

    const primero = await tokenServicio.obtener('id-1');
    tokenServicio.descartar(primero.token);
    const segundo = await tokenServicio.obtener('id-2');

    expect([primero.reutilizado, segundo.reutilizado]).toEqual([false, false]);
    await expect(comoM6(segundo.token)).resolves.toBeDefined();
  });

  it('sin las variables de Keycloak, crearTokenServicio elige el HS256', () => {
    expect(crearTokenServicio({ ...config, tokenServicio: undefined }).modo).toBe('hs256');
  });
});

// El pedido a Keycloak por `client_credentials` (spec 125, T3). `servidor-modulo.ts` hace de endpoint de tokens. Sin caché todavía:
// cada `obtener` hace su pedido (la caché llega en T4).
describe('token de servicio de Keycloak: el pedido (spec 125, RF-2.4.11.1, RF-2.4.11.6, RF-2.4.11.7, RF-2.4.11.10)', () => {
  const keycloak = crearServidorModulo();
  const TIEMPO_MS = 200;
  const CLIENTE = 'grupo-17';
  const SECRETO = 'secreto-de-prueba';
  const TOKEN = 'eyJ.token-de-keycloak.firma';
  const RESPUESTA_OK = { tipo: 'ok', cuerpo: { access_token: TOKEN, expires_in: 300, token_type: 'Bearer' } } as const;

  // Con el tiempo máximo corto solo las pruebas que miden el corte; las demás, holgado (#136).
  const tokenServicioDe = (cambios: Partial<{ cliente: string; secreto: string; urlTokens: string }> = {}, tiempoModulosMs = TIEMPO_HOLGADO_MS) =>
    crearTokenServicio({
      ...CONFIG,
      audienciaM6: 'm6-de-prueba',
      tiempoModulosMs,
      reintentosModulos: 1,
      reintentarDespuesS: 7,
      tokenServicio: { urlTokens: `${keycloak.url}/realms/r/protocol/openid-connect/token`, cliente: CLIENTE, secreto: SECRETO, ...cambios },
    });

  // Lo que se espera cuando Keycloak no está disponible: el 503 genérico con el Retry-After configurado (RF-2.4.11.6).
  const noDisponible = {
    codigo: 503,
    type: 'about:blank',
    detail: 'Keycloak no está disponible',
    encabezados: { 'Retry-After': '7' },
  };

  beforeAll(async () => {
    await keycloak.levantar();
  });

  afterAll(async () => {
    await keycloak.cerrar();
  });

  it('con las tres variables es el modo keycloak', () => {
    expect(tokenServicioDe().modo).toBe('keycloak');
  });

  it('pide en formulario con grant_type=client_credentials y el cliente en Basic, y entrega el access_token tal cual', async () => {
    keycloak.responderCon(RESPUESTA_OK);

    const obtenido = await tokenServicioDe().obtener('id-1');

    expect(obtenido).toStrictEqual({ token: TOKEN, reutilizado: false });
    expect(keycloak.llamadas).toBe(1);
    expect(keycloak.metodoRecibido).toBe('POST');
    expect(keycloak.rutaRecibida).toBe('/realms/r/protocol/openid-connect/token');
    expect(keycloak.encabezadosRecibidos.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(keycloak.cuerpoRecibido.toString()).toBe('grant_type=client_credentials');
    expect(keycloak.autorizaciones[0]).toBe(`Basic ${Buffer.from(`${CLIENTE}:${SECRETO}`).toString('base64')}`);
  });

  it('codifica el cliente y el secreto como formulario antes de Basic (RFC 6749, 2.3.1)', async () => {
    keycloak.responderCon(RESPUESTA_OK);

    await tokenServicioDe({ cliente: 'un cliente', secreto: 'a:b%c&d' }).obtener('id-1');

    expect(keycloak.autorizaciones[0]).toBe(`Basic ${Buffer.from('un+cliente:a%3Ab%25c%26d').toString('base64')}`);
  });

  it('no mira el token: cualquier texto no vacío sirve (RF-2.4.11.10)', async () => {
    keycloak.responderCon({ tipo: 'ok', cuerpo: { access_token: 'no-es-un-jwt', expires_in: 1 } });

    await expect(tokenServicioDe().obtener('id-1')).resolves.toStrictEqual({ token: 'no-es-un-jwt', reutilizado: false });
  });

  it('un 5xx se reintenta una vez y vale el token del reintento', async () => {
    keycloak.responderCon([{ tipo: '5xx', estado: 502 }, RESPUESTA_OK]);

    await expect(tokenServicioDe().obtener('id-1')).resolves.toStrictEqual({ token: TOKEN, reutilizado: false });
    expect(keycloak.llamadas).toBe(2);
  });

  it('un corte por tiempo se reintenta una vez y vale el token del reintento', async () => {
    keycloak.responderCon([{ tipo: 'demora-cuerpo', retardoMs: TIEMPO_MS * 4, cuerpo: RESPUESTA_OK.cuerpo }, RESPUESTA_OK]);

    await expect(tokenServicioDe({}, TIEMPO_MS).obtener('id-1')).resolves.toStrictEqual({ token: TOKEN, reutilizado: false });
    expect(keycloak.llamadas).toBe(2);
  });

  it.each<[string, Comportamiento]>([
    ['un 5xx', { tipo: '5xx', estado: 500 }],
    ['un corte por tiempo', { tipo: 'cuelga' }],
    ['una conexión cortada', { tipo: 'corta' }],
    ['un 200 que no es JSON', { tipo: 'no-json' }],
    ['un 200 que no es un objeto', { tipo: 'ok', cuerpo: [TOKEN] }],
    ['un 200 sin access_token', { tipo: 'ok', cuerpo: { expires_in: 300 } }],
    ['un 200 con access_token vacío', { tipo: 'ok', cuerpo: { access_token: '', expires_in: 300 } }],
    ['un 200 con access_token que no es texto', { tipo: 'ok', cuerpo: { access_token: 123, expires_in: 300 } }],
    ['un 200 sin expires_in', { tipo: 'ok', cuerpo: { access_token: TOKEN } }],
    ['un 200 con expires_in 0', { tipo: 'ok', cuerpo: { access_token: TOKEN, expires_in: 0 } }],
    ['un 200 con expires_in negativo', { tipo: 'ok', cuerpo: { access_token: TOKEN, expires_in: -300 } }],
    ['un 200 con expires_in en texto', { tipo: 'ok', cuerpo: { access_token: TOKEN, expires_in: '300' } }],
    ['un 200 con expires_in decimal', { tipo: 'ok', cuerpo: { access_token: TOKEN, expires_in: 299.5 } }],
    ['un 204', { tipo: 'ok', estado: 204 }],
  ])('%s, dos veces, da 503 genérico con Retry-After tras un solo reintento', async (_caso, comportamiento) => {
    keycloak.responderCon(comportamiento);

    const error = await tokenServicioDe({}, terminaPorTiempo(comportamiento) ? TIEMPO_MS : TIEMPO_HOLGADO_MS)
      .obtener('id-1')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ModuloNoDisponible);
    expect(error).toMatchObject(noDisponible);
    expect(keycloak.llamadas).toBe(2);
  });

  it('un Keycloak al que no se llega da 503 con Retry-After', async () => {
    const error = await tokenServicioDe({ urlTokens: `${await urlSinServidor()}/token` })
      .obtener('id-1')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ModuloNoDisponible);
    expect(error).toMatchObject(noDisponible);
  });

  it.each([400, 401, 403])('un %i es un rechazo: 500 sin reintento y sin el cuerpo de Keycloak (RF-2.4.11.7)', async (estado) => {
    keycloak.responderCon({ tipo: '4xx', estado, cuerpo: { error: 'unauthorized_client', error_description: 'secreto-en-el-cuerpo' } });

    const error = await tokenServicioDe().obtener('id-1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ErrorDeIntegracion);
    expect(error).toMatchObject({ codigo: 500, detail: 'Ocurrió un error interno' });
    expect((error as Error).cause).toBeInstanceOf(Error);
    expect(((error as Error).cause as Error).message).toBe(`Keycloak respondió ${estado}`);
    expect(inspect(error, { depth: 5 })).not.toContain('secreto-en-el-cuerpo');
    expect(keycloak.llamadas).toBe(1);
  });

  it('ningún error lleva el secreto del cliente (RNF-19)', async () => {
    keycloak.responderCon({ tipo: '5xx', estado: 503 });
    const noDisponibleError = await tokenServicioDe().obtener('id-1').catch((e: unknown) => e);
    keycloak.responderCon({ tipo: '4xx', estado: 401 });
    const rechazo = await tokenServicioDe().obtener('id-1').catch((e: unknown) => e);

    for (const error of [noDisponibleError, rechazo]) {
      expect(inspect(error, { depth: 5 })).not.toContain(SECRETO);
      expect(inspect(error, { depth: 5 })).not.toContain(Buffer.from(`${CLIENTE}:${SECRETO}`).toString('base64'));
    }
  });
});

// La caché y el pedido compartido (spec 125, T4). Solo `Date` es falso: el servidor, los cortes y la pausa entre intentos
// siguen con el reloj real, y el tiempo de vida del token avanza cuando la prueba lo dice.
describe('token de servicio de Keycloak: caché y pedido compartido (spec 125, RF-2.4.11.4, RF-2.4.11.5)', () => {
  const keycloak = crearServidorModulo();
  const INICIO = new Date('2026-11-25T12:00:00Z').getTime();
  const conToken = (token: string, expiresIn = 300): Comportamiento => ({
    tipo: 'ok',
    cuerpo: { access_token: token, expires_in: expiresIn },
  });

  const tokenServicioDe = () =>
    crearTokenServicio({
      ...CONFIG,
      audienciaM6: 'm6-de-prueba',
      tiempoModulosMs: TIEMPO_HOLGADO_MS,
      reintentosModulos: 1,
      reintentarDespuesS: 7,
      tokenServicio: { urlTokens: `${keycloak.url}/token`, cliente: 'grupo-17', secreto: 'secreto-de-prueba' },
    });

  const avanzar = (ms: number) => vi.setSystemTime(Date.now() + ms);

  beforeAll(async () => {
    await keycloak.levantar();
  });

  afterAll(async () => {
    await keycloak.cerrar();
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(INICIO);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reutiliza el token guardado mientras le quedan 30 s o más, sin pedir otro', async () => {
    keycloak.responderCon([conToken('token-1'), conToken('token-2')]);
    const tokenServicio = tokenServicioDe();

    const primero = await tokenServicio.obtener('id-1');
    avanzar(270_000); // le quedan justo 30 s
    const segundo = await tokenServicio.obtener('id-2');

    expect(primero).toStrictEqual({ token: 'token-1', reutilizado: false });
    expect(segundo).toStrictEqual({ token: 'token-1', reutilizado: true });
    expect(keycloak.llamadas).toBe(1);
  });

  it('con menos de 30 s de vida pide otro y guarda el nuevo', async () => {
    keycloak.responderCon([conToken('token-1'), conToken('token-2'), conToken('token-3')]);
    const tokenServicio = tokenServicioDe();

    await tokenServicio.obtener('id-1');
    avanzar(270_001); // le quedan 29,999 s
    const segundo = await tokenServicio.obtener('id-2');
    const tercero = await tokenServicio.obtener('id-3');

    expect(segundo).toStrictEqual({ token: 'token-2', reutilizado: false });
    expect(tercero).toStrictEqual({ token: 'token-2', reutilizado: true });
    expect(keycloak.llamadas).toBe(2);
  });

  it('un expires_in de 10 s se usa para esa llamada y no se guarda', async () => {
    keycloak.responderCon([conToken('corto-1', 10), conToken('corto-2', 10)]);
    const tokenServicio = tokenServicioDe();

    const primero = await tokenServicio.obtener('id-1');
    const segundo = await tokenServicio.obtener('id-2');

    expect(primero).toStrictEqual({ token: 'corto-1', reutilizado: false });
    expect(segundo).toStrictEqual({ token: 'corto-2', reutilizado: false });
    expect(keycloak.llamadas).toBe(2);
  });

  it('un expires_in de 30 s justos se guarda', async () => {
    keycloak.responderCon([conToken('justo', 30), conToken('otro')]);
    const tokenServicio = tokenServicioDe();

    await tokenServicio.obtener('id-1');

    await expect(tokenServicio.obtener('id-2')).resolves.toStrictEqual({ token: 'justo', reutilizado: true });
    expect(keycloak.llamadas).toBe(1);
  });

  it('diez obtener simultáneos hacen un solo pedido y reciben el mismo token', async () => {
    keycloak.responderCon([conToken('compartido'), conToken('otro')]);
    const tokenServicio = tokenServicioDe();

    const obtenidos = await Promise.all(Array.from({ length: 10 }, (_, i) => tokenServicio.obtener(`id-${i}`)));

    expect(keycloak.llamadas).toBe(1);
    // Ninguno es reutilizado: se pidió durante su operación, y un 401 de M6 con él no se renueva (RF-2.4.11.8).
    expect(obtenidos).toStrictEqual(Array.from({ length: 10 }, () => ({ token: 'compartido', reutilizado: false })));
  });

  it('diez obtener simultáneos ante una falla reciben el mismo error, y el siguiente vuelve a pedir', async () => {
    keycloak.responderCon([{ tipo: '5xx', estado: 500 }, { tipo: '5xx', estado: 500 }, conToken('despues')]);
    const tokenServicio = tokenServicioDe();

    const resultados = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => tokenServicio.obtener(`id-${i}`)));
    const errores = resultados.map((r) => (r.status === 'rejected' ? (r.reason as unknown) : r));

    expect(keycloak.llamadas).toBe(2); // un pedido, con su reintento
    expect(errores[0]).toBeInstanceOf(ModuloNoDisponible);
    for (const error of errores) expect(error).toBe(errores[0]);

    await expect(tokenServicio.obtener('id-siguiente')).resolves.toStrictEqual({ token: 'despues', reutilizado: false });
    expect(keycloak.llamadas).toBe(3);
  });

  it('tras un rechazo de Keycloak el siguiente también vuelve a pedir', async () => {
    keycloak.responderCon([{ tipo: '4xx', estado: 401 }, conToken('despues')]);
    const tokenServicio = tokenServicioDe();

    await expect(tokenServicio.obtener('id-1')).rejects.toBeInstanceOf(ErrorDeIntegracion);
    await expect(tokenServicio.obtener('id-2')).resolves.toStrictEqual({ token: 'despues', reutilizado: false });
    expect(keycloak.llamadas).toBe(2);
  });

  it('descartar el token guardado hace que el siguiente pida otro', async () => {
    keycloak.responderCon([conToken('token-1'), conToken('token-2')]);
    const tokenServicio = tokenServicioDe();

    await tokenServicio.obtener('id-1');
    tokenServicio.descartar('token-1');

    await expect(tokenServicio.obtener('id-2')).resolves.toStrictEqual({ token: 'token-2', reutilizado: false });
    expect(keycloak.llamadas).toBe(2);
  });

  it('descartar un token viejo no borra uno más nuevo', async () => {
    keycloak.responderCon([conToken('viejo'), conToken('nuevo'), conToken('otro')]);
    const tokenServicio = tokenServicioDe();

    await tokenServicio.obtener('id-1');
    tokenServicio.descartar('viejo');
    await tokenServicio.obtener('id-2');
    // Otra operación que usó el viejo recibe su 401 tarde y lo descarta: el nuevo queda.
    tokenServicio.descartar('viejo');

    await expect(tokenServicio.obtener('id-3')).resolves.toStrictEqual({ token: 'nuevo', reutilizado: true });
    expect(keycloak.llamadas).toBe(2);
  });

  it('cada token de servicio tiene su propia caché', async () => {
    keycloak.responderCon([conToken('de-uno'), conToken('de-otro')]);

    await tokenServicioDe().obtener('id-1');
    await expect(tokenServicioDe().obtener('id-2')).resolves.toStrictEqual({ token: 'de-otro', reutilizado: false });
  });
});

// La línea de cada pedido a Keycloak (spec 125, T5): el mismo formato que la de las llamadas a M6, con el id de la operación que
// lo disparó. Un token reutilizado no hace pedido y no deja línea. Nunca el token, el secreto, el `Basic` ni la URL.
describe('token de servicio de Keycloak: la línea del pedido (spec 125, RNF-14.15, RNF-19)', () => {
  const keycloak = crearServidorModulo();
  const SECRETO = 'secreto-de-prueba';
  const TOKEN = 'eyJ.token-de-keycloak.firma';
  const RUTA = '/realms/r/protocol/openid-connect/token';

  type Linea = { nivel: 'info' | 'warn'; datos: Record<string, unknown>; msg: string };
  function logDePrueba() {
    const lineas: Linea[] = [];
    return {
      lineas,
      log: {
        info: (datos: Record<string, unknown>, msg: string) => lineas.push({ nivel: 'info', datos, msg }),
        warn: (datos: Record<string, unknown>, msg: string) => lineas.push({ nivel: 'warn', datos, msg }),
      },
    };
  }

  // Con el tiempo máximo corto solo las pruebas que miden el corte; las demás, holgado (#136).
  const tokenServicioDe = (log: ReturnType<typeof logDePrueba>['log'], tiempoModulosMs = TIEMPO_HOLGADO_MS) =>
    crearTokenServicio(
      {
        ...CONFIG,
        audienciaM6: 'm6-de-prueba',
        tiempoModulosMs,
        reintentosModulos: 1,
        reintentarDespuesS: 7,
        tokenServicio: { urlTokens: `${keycloak.url}${RUTA}`, cliente: 'grupo-17', secreto: SECRETO },
      },
      log as never,
    );

  // Lo que no puede aparecer en ninguna línea (RNF-19).
  const sinSecretos = (lineas: Linea[]) => {
    const texto = JSON.stringify(lineas);
    expect(texto).not.toContain(TOKEN);
    expect(texto).not.toContain(SECRETO);
    expect(texto).not.toContain(Buffer.from(`grupo-17:${SECRETO}`).toString('base64'));
    expect(texto).not.toContain(RUTA);
    expect(texto).not.toContain('127.0.0.1');
  };

  beforeAll(async () => {
    await keycloak.levantar();
  });

  afterAll(async () => {
    await keycloak.cerrar();
  });

  it('un pedido que sale bien deja una línea info con los campos de RNF-14.15; el token reutilizado no deja otra', async () => {
    keycloak.responderCon({ tipo: 'ok', cuerpo: { access_token: TOKEN, expires_in: 300 } });
    const { lineas, log } = logDePrueba();
    const tokenServicio = tokenServicioDe(log);

    await tokenServicio.obtener('id-1');
    await tokenServicio.obtener('id-2');

    expect(lineas).toEqual([
      {
        nivel: 'info',
        msg: 'llamada a Keycloak',
        datos: { idCorrelacion: 'id-1', modulo: 'Keycloak', metodo: 'POST', estado: 200, intentos: 1, duracionMs: expect.any(Number) },
      },
    ]);
    expect(Object.keys(lineas[0]!.datos)).toEqual(['idCorrelacion', 'modulo', 'metodo', 'estado', 'intentos', 'duracionMs']);
    sinSecretos(lineas);
  });

  it('un pedido compartido deja una sola línea, con el id de la operación que lo disparó', async () => {
    keycloak.responderCon({ tipo: 'ok', cuerpo: { access_token: TOKEN, expires_in: 300 } });
    const { lineas, log } = logDePrueba();
    const tokenServicio = tokenServicioDe(log);

    await Promise.all(['id-a', 'id-b', 'id-c'].map((id) => tokenServicio.obtener(id)));

    expect(lineas).toHaveLength(1);
    expect(lineas[0]!.datos).toMatchObject({ idCorrelacion: 'id-a', intentos: 1 });
  });

  it('con el reintento, la línea cuenta los dos intentos y el código del último', async () => {
    keycloak.responderCon([{ tipo: '5xx', estado: 502 }, { tipo: 'ok', cuerpo: { access_token: TOKEN, expires_in: 300 } }]);
    const { lineas, log } = logDePrueba();

    await tokenServicioDe(log).obtener('id-1');

    expect(lineas).toEqual([expect.objectContaining({ nivel: 'info', datos: expect.objectContaining({ estado: 200, intentos: 2 }) })]);
    expect((lineas[0]!.datos.duracionMs as number) >= 200).toBe(true); // la pausa entre intentos
  });

  it.each<[string, Comportamiento, number | null, number]>([
    ['un 5xx', { tipo: '5xx', estado: 503 }, 503, 2],
    ['un corte por tiempo', { tipo: 'cuelga' }, null, 2],
    ['un cuerpo que se corta por tiempo', { tipo: 'demora-cuerpo', retardoMs: 800 }, null, 2],
    ['un 200 sin access_token', { tipo: 'ok', cuerpo: { expires_in: 300, dato: TOKEN } }, 200, 2],
    ['un 401 de Keycloak', { tipo: '4xx', estado: 401, cuerpo: { error: 'invalid_client', detalle: SECRETO } }, 401, 1],
  ])('%s deja una línea warn con el código del último intento y los intentos', async (_caso, comportamiento, estado, intentos) => {
    keycloak.responderCon(comportamiento);
    const { lineas, log } = logDePrueba();

    await tokenServicioDe(log, terminaPorTiempo(comportamiento) ? 200 : TIEMPO_HOLGADO_MS)
      .obtener('id-1')
      .catch(() => undefined);

    expect(lineas).toEqual([
      {
        nivel: 'warn',
        msg: 'llamada a Keycloak',
        datos: { idCorrelacion: 'id-1', modulo: 'Keycloak', metodo: 'POST', estado, intentos, duracionMs: expect.any(Number) },
      },
    ]);
    sinSecretos(lineas);
  });

  it('sin log no escribe nada y anda igual', async () => {
    keycloak.responderCon({ tipo: 'ok', cuerpo: { access_token: TOKEN, expires_in: 300 } });

    await expect(tokenServicioDe(undefined as never).obtener('id-1')).resolves.toMatchObject({ token: TOKEN });
  });
});
