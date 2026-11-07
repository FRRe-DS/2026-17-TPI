import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearVerificador, type ConfigVerificador } from '../../src/auth/tokens.js';
import { NoAutenticado } from '../../src/errores.js';
import { armarTokenRsa, crearClave, crearClaveDeCifrado, jwksDe, type OpcionesTokenRsa } from '../ayudas/jwks.js';
import { crearServidorModulo } from '../ayudas/servidor-modulo.js';
import { armarToken, CONFIG_TOKENS, SUB_DE_PRUEBA } from '../ayudas/tokens.js';

// El verificador en modo `jwks` (RNF-12.11, RNF-12.12, RNF-07.12), con claves generadas acá y un JWKS propio de la prueba.
const servidor = crearServidorModulo();
const clave = crearClave();
const otraClave = crearClave(clave.kid); // El mismo `kid`, pero las claves son otras.
const JWKS = jwksDe(clave);

// Los motivos del 401: son el `detail` de la respuesta. Los de RNF-12.2 son iguales a los del modo `hs256`, salvo el de la firma.
const FALTA = 'Falta el token';
const MAL_FORMADO = 'El token está mal formado';
const FIRMA = 'El token no está firmado con RS256 y una clave del servicio de identidad';
const FIRMA_HS256 = 'El token no está firmado con HS256 y la clave del servicio';
const VENCIDO = 'El token venció';
const SIN_VENCIMIENTO = 'El token no tiene fecha de vencimiento (exp)';
const TODAVIA_NO = 'El token todavía no es válido (nbf)';
const SUB_INVALIDO = 'El sub del token falta, está vacío o no es texto';
const EMISOR = 'El emisor del token no es el esperado';
const AUDIENCIA = 'La audiencia del token no es la esperada';
const ROLES_INVALIDOS = 'El campo de roles del token no es una lista de textos';
const SCOPE_INVALIDO = 'El campo scope del token no es un texto';

const ahora = () => Math.floor(Date.now() / 1000);

const configJwks = (cambios: Partial<ConfigVerificador> = {}): ConfigVerificador => ({
  ...CONFIG_TOKENS,
  modoTokens: 'jwks',
  urlJwks: `${servidor.url}/certs`,
  ...cambios,
});

const verificar = (token: string, config = configJwks()) => crearVerificador(config).verificar(`Bearer ${token}`);
const conClave = (opciones?: OpcionesTokenRsa) => armarTokenRsa(clave, opciones);

// Espera un 401 con este motivo y comprueba lo que vale para todos (RNF-12.2): `WWW-Authenticate: Bearer` y un detail que no
// repite el token ni ninguna de sus partes.
async function rechazo(resultado: Promise<unknown>, motivo: string, token = '') {
  const error = await resultado.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(NoAutenticado);
  const { codigo, detail, encabezados } = error as NoAutenticado;
  expect({ codigo, detail, encabezados }).toEqual({ codigo: 401, detail: motivo, encabezados: { 'WWW-Authenticate': 'Bearer' } });
  for (const parte of [token, ...token.split('.')].filter((texto) => texto.length > 8)) {
    expect(detail).not.toContain(parte);
  }
}

beforeAll(async () => {
  await servidor.levantar();
});

afterAll(async () => {
  await servidor.cerrar();
});

beforeEach(() => {
  servidor.responderCon({ tipo: 'ok', cuerpo: JWKS });
});

describe('modo jwks: acepta un token RS256 de una clave publicada (RNF-12.11, RNF-12.12)', () => {
  it('devuelve el sub, los roles y los scopes', async () => {
    const token = conClave({ claims: { roles: ['OPERADOR'], scope: 'clientes:read clientes:write' } });
    await expect(verificar(token)).resolves.toStrictEqual({
      sub: SUB_DE_PRUEBA,
      roles: ['OPERADOR'],
      scopes: ['clientes:read', 'clientes:write'],
    });
  });

  it('un rol repetido no cambia nada', async () => {
    const repetido = await verificar(conClave({ claims: { roles: ['CLIENTE', 'OPERADOR', 'CLIENTE'] } }));
    const sinRepetir = await verificar(conClave({ claims: { roles: ['CLIENTE', 'OPERADOR'] } }));
    expect(repetido).toStrictEqual(sinRepetir);
  });

  it('una clave de cifrado en el JWKS no molesta, ni aunque venga primero', async () => {
    servidor.responderCon({ tipo: 'ok', cuerpo: jwksDe(crearClaveDeCifrado(), clave) });
    await expect(verificar(conClave())).resolves.toMatchObject({ sub: SUB_DE_PRUEBA });
  });

  it('elige la clave por su kid entre varias de firma', async () => {
    const segunda = crearClave('otro-kid');
    servidor.responderCon({ tipo: 'ok', cuerpo: jwksDe(clave, segunda) });
    await expect(verificar(armarTokenRsa(segunda))).resolves.toMatchObject({ sub: SUB_DE_PRUEBA });
  });

  it('se queda solo con los roles conocidos (RNF-12.3)', async () => {
    const token = conClave({ claims: { roles: ['CLIENTE', 'ADMIN', 'offline_access', 'cliente'] } });
    await expect(verificar(token)).resolves.toMatchObject({ roles: ['CLIENTE'] });
  });

  it('un token sin el campo de roles no tiene ninguno', async () => {
    await expect(verificar(conClave({ claims: { roles: undefined } }))).resolves.toMatchObject({ roles: [] });
  });

  it('lee los roles del campo configurado (RNF-12.4)', async () => {
    const config = configJwks({ campoRoles: 'permisos' });
    const token = conClave({ config, claims: { permisos: ['SERVICIO'], roles: ['OPERADOR'] } });
    await expect(verificar(token, config)).resolves.toMatchObject({ roles: ['SERVICIO'] });
  });

  it('el esquema Bearer no distingue mayúsculas, como en hs256', async () => {
    const identidad = await crearVerificador(configJwks()).verificar(`bearer ${conClave()}`);
    expect(identidad.sub).toBe(SUB_DE_PRUEBA);
  });

  it('no pide las claves en cada solicitud', async () => {
    const verificador = crearVerificador(configJwks());
    await verificador.verificar(`Bearer ${conClave()}`);
    await verificador.verificar(`Bearer ${conClave()}`);
    expect(servidor.llamadas).toBe(1);
  });
});

describe('modo jwks: 401 con los motivos de RNF-12.2 (RNF-12.12)', () => {
  it.each<[string, Record<string, unknown>, string]>([
    ['vencido', { exp: 1000 }, VENCIDO],
    ['vencido por más que la tolerancia', { exp: ahora() - 40 }, VENCIDO],
    ['sin exp', { exp: undefined }, SIN_VENCIMIENTO],
    ['con un exp que no es un número', { exp: 'mañana' }, MAL_FORMADO],
    ['con nbf en el futuro', { nbf: ahora() + 3600 }, TODAVIA_NO],
    ['con nbf más adelante que la tolerancia', { nbf: ahora() + 40 }, TODAVIA_NO],
    ['con otro emisor', { iss: 'otro-emisor' }, EMISOR],
    ['sin emisor', { iss: undefined }, EMISOR],
    ['con otra audiencia', { aud: 'otra-audiencia' }, AUDIENCIA],
    ['sin audiencia', { aud: undefined }, AUDIENCIA],
    ['sin sub', { sub: undefined }, SUB_INVALIDO],
    ['con el sub vacío', { sub: '' }, SUB_INVALIDO],
    ['con el sub en blanco', { sub: '   ' }, SUB_INVALIDO],
    ['con un sub que no es texto', { sub: 42 }, SUB_INVALIDO],
    ['con un campo de roles que no es una lista', { roles: 'CLIENTE' }, ROLES_INVALIDOS],
    ['con una lista de roles que no son textos', { roles: [1, 2] }, ROLES_INVALIDOS],
  ])('un token %s', async (_caso, claims, motivo) => {
    const token = conClave({ claims });
    await rechazo(verificar(token), motivo, token);
  });

  it.each<[string, Record<string, unknown>]>([
    ['exp', { exp: ahora() - 10 }],
    ['nbf', { nbf: ahora() + 10 }],
  ])('perdona 30 s de reloj en %s', async (_campo, claims) => {
    await expect(verificar(conClave({ claims }))).resolves.toMatchObject({ sub: SUB_DE_PRUEBA });
  });

  it('un token firmado con otra clave, con el mismo kid', async () => {
    const token = armarTokenRsa(otraClave);
    await rechazo(verificar(token), FIRMA, token);
  });

  it('un token que trae su propia clave en la cabecera no la usa para validarse', async () => {
    const token = armarTokenRsa(otraClave, { cabecera: { jwk: otraClave.jwk } });
    await rechazo(verificar(token), FIRMA, token);
  });

  it('un token con el cuerpo cambiado después de firmar', async () => {
    const [cabecera, , firma] = conClave().split('.');
    const [, cuerpoAjeno] = conClave({ claims: { roles: ['OPERADOR'] } }).split('.');
    const token = `${cabecera}.${cuerpoAjeno}.${firma}`;
    await rechazo(verificar(token), FIRMA, token);
  });

  it('la firma se comprueba antes que lo que dice el token: uno falso y vencido no dice por qué vencería', async () => {
    const token = armarTokenRsa(otraClave, { claims: { exp: 1000 } });
    await rechazo(verificar(token), FIRMA, token);
  });
});

// jose revisa el algoritmo antes de pedir la clave: estos tokens ni siquiera llegan a Keycloak, aunque esté caído.
describe('modo jwks: 401 sin pedir las claves (RNF-12.11)', () => {
  const firmaHs256 = armarToken({ cabecera: { kid: clave.kid } });

  it.each<[string, string, string]>([
    ['alg none', armarToken({ alg: 'none', cabecera: { kid: clave.kid } }), FIRMA],
    ['HS256 firmado con M2_CLAVE_TOKENS', firmaHs256, FIRMA],
    ['HS512', armarToken({ alg: 'HS512', cabecera: { kid: clave.kid } }), FIRMA],
    ['RS384 con una clave publicada', armarTokenRsa(clave, { alg: 'RS384' }), FIRMA],
    ['mal formado', 'esto.no.es-un-token', MAL_FORMADO],
  ])('con %s', async (_caso, token, motivo) => {
    await rechazo(verificar(token), motivo, token);
    expect(servidor.llamadas).toBe(0);
  });

  it.each<[string, string | undefined]>([
    ['sin encabezado', undefined],
    ['vacío', ''],
    ['con otro esquema', `Basic ${firmaHs256}`],
    ['con el esquema solo', 'Bearer'],
  ])('falta el token: %s', async (_caso, encabezado) => {
    await rechazo(crearVerificador(configJwks()).verificar(encabezado), FALTA);
    expect(servidor.llamadas).toBe(0);
  });
});

describe('modo jwks: los scopes salen del campo scope, partido por espacios', () => {
  it.each<[string, string | undefined, string[]]>([
    ['ausente da una lista vacía', undefined, []],
    ['vacío da una lista vacía', '', []],
    ['con uno solo', 'clientes:read', ['clientes:read']],
    ['con varios', 'openid profile clientes:write', ['openid', 'profile', 'clientes:write']],
    ['con espacios de más', ' clientes:read  clientes:write ', ['clientes:read', 'clientes:write']],
  ])('%s', async (_caso, scope, esperados) => {
    await expect(verificar(conClave({ claims: { scope } }))).resolves.toMatchObject({ scopes: esperados });
  });

  it.each<[string, unknown]>([
    ['un número', 42],
    ['una lista', ['clientes:read']],
    ['un objeto', { valor: 'clientes:read' }],
    ['null', null],
  ])('un scope que es %s da 401', async (_caso, scope) => {
    const token = conClave({ claims: { scope } });
    await rechazo(verificar(token), SCOPE_INVALIDO, token);
  });
});

// Un `kid` que M2 no tiene vuelve a pedir las claves, pero como mucho una vez cada 30 s desde la última obtención (RNF-12.16).
// El reloj es el de Vitest, solo `Date`: es el que usa jose para contar los 30 s, y los temporizadores reales siguen andando
// para el servidor de la prueba.
describe('modo jwks: un kid desconocido (RNF-12.16, RNF-12.19)', () => {
  const KID_DESCONOCIDO = 'El kid del token no está entre las claves del servicio de identidad';
  const COOLDOWN_MS = 30_000;
  const desconocida = crearClave('clave-que-no-esta');
  const nueva = crearClave('clave-nueva');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('da 401 con el motivo del kid, sin repetirlo', async () => {
    const token = armarTokenRsa(desconocida);
    await rechazo(verificar(token), KID_DESCONOCIDO, token);
    expect(KID_DESCONOCIDO).not.toContain(desconocida.kid);
  });

  it('un token sin kid, con varias claves, también da 401 por el kid y no pide más', async () => {
    servidor.responderCon({ tipo: 'ok', cuerpo: jwksDe(clave, crearClave('otra-de-firma')) });
    const token = armarTokenRsa(clave, { cabecera: { kid: undefined } });
    await rechazo(verificar(token), KID_DESCONOCIDO, token);
    expect(servidor.llamadas).toBe(1);
  });

  it('sin claves guardadas, el primer pedido trae las claves y el kid no aparece: un solo pedido', async () => {
    await rechazo(verificar(armarTokenRsa(desconocida)), KID_DESCONOCIDO);
    expect(servidor.llamadas).toBe(1);
  });

  it('con las claves recién obtenidas, otro kid da 401 sin pedir de nuevo', async () => {
    const verificador = crearVerificador(configJwks());
    await verificador.verificar(`Bearer ${conClave()}`);
    expect(servidor.llamadas).toBe(1);

    for (let i = 0; i < 3; i++) {
      await rechazo(verificador.verificar(`Bearer ${armarTokenRsa(desconocida)}`), KID_DESCONOCIDO);
    }
    expect(servidor.llamadas).toBe(1);
  });

  it('pasados los 30 s vuelve a pedir, y si el kid no aparece da 401 sin otro pedido dentro de los 30 s siguientes', async () => {
    const verificador = crearVerificador(configJwks());
    await verificador.verificar(`Bearer ${conClave()}`);

    vi.advanceTimersByTime(COOLDOWN_MS + 1);
    await rechazo(verificador.verificar(`Bearer ${armarTokenRsa(desconocida)}`), KID_DESCONOCIDO);
    expect(servidor.llamadas).toBe(2);

    vi.advanceTimersByTime(COOLDOWN_MS - 1);
    await rechazo(verificador.verificar(`Bearer ${armarTokenRsa(desconocida)}`), KID_DESCONOCIDO);
    expect(servidor.llamadas).toBe(2);

    vi.advanceTimersByTime(2);
    await rechazo(verificador.verificar(`Bearer ${armarTokenRsa(desconocida)}`), KID_DESCONOCIDO);
    expect(servidor.llamadas).toBe(3);
  });

  it('a los 30 s justos todavía no pide, y un instante después sí', async () => {
    const verificador = crearVerificador(configJwks());
    await verificador.verificar(`Bearer ${conClave()}`);

    vi.advanceTimersByTime(COOLDOWN_MS - 1);
    await rechazo(verificador.verificar(`Bearer ${armarTokenRsa(desconocida)}`), KID_DESCONOCIDO);
    expect(servidor.llamadas).toBe(1);

    vi.advanceTimersByTime(2);
    await rechazo(verificador.verificar(`Bearer ${armarTokenRsa(desconocida)}`), KID_DESCONOCIDO);
    expect(servidor.llamadas).toBe(2);
  });

  it('si Keycloak publica una clave nueva, un token con ese kid se acepta sin reiniciar', async () => {
    const verificador = crearVerificador(configJwks());
    await verificador.verificar(`Bearer ${conClave()}`);

    servidor.responderCon({ tipo: 'ok', cuerpo: jwksDe(clave, nueva) });
    vi.advanceTimersByTime(COOLDOWN_MS + 1);

    await expect(verificador.verificar(`Bearer ${armarTokenRsa(nueva)}`)).resolves.toMatchObject({ sub: SUB_DE_PRUEBA });
    expect(servidor.llamadas).toBe(1);
    // La clave vieja sigue valiendo: Keycloak rota con las dos publicadas un tiempo.
    await expect(verificador.verificar(`Bearer ${conClave()}`)).resolves.toMatchObject({ sub: SUB_DE_PRUEBA });
    expect(servidor.llamadas).toBe(1);
  });

  it('con la clave nueva ya publicada, un token con ese kid dentro de los 30 s da 401 hasta que pase el plazo (caso límite)', async () => {
    const verificador = crearVerificador(configJwks());
    await verificador.verificar(`Bearer ${conClave()}`);

    servidor.responderCon({ tipo: 'ok', cuerpo: jwksDe(clave, nueva) });
    vi.advanceTimersByTime(COOLDOWN_MS - 1);
    await rechazo(verificador.verificar(`Bearer ${armarTokenRsa(nueva)}`), KID_DESCONOCIDO);
    expect(servidor.llamadas).toBe(0);

    vi.advanceTimersByTime(2);
    await expect(verificador.verificar(`Bearer ${armarTokenRsa(nueva)}`)).resolves.toMatchObject({ sub: SUB_DE_PRUEBA });
  });
});

// Con `hs256` el verificador se comporta como `verificarToken`, sin scopes ni pedidos a nadie (RNF-12.15).
describe('modo hs256: valida como siempre', () => {
  const configHs256: ConfigVerificador = { ...CONFIG_TOKENS, modoTokens: 'hs256', urlJwks: undefined };

  it('acepta un HS256 y su identidad no trae scopes, aunque el token traiga el campo', async () => {
    const token = armarToken({ claims: { scope: 'clientes:read' } });
    await expect(verificar(token, configHs256)).resolves.toStrictEqual({ sub: SUB_DE_PRUEBA, roles: ['CLIENTE'] });
    expect(servidor.llamadas).toBe(0);
  });

  it('rechaza un RS256 con el motivo de hs256, aunque tenga una URL de claves configurada', async () => {
    const token = conClave();
    await rechazo(verificar(token, { ...configHs256, urlJwks: `${servidor.url}/certs` }), FIRMA_HS256, token);
    expect(servidor.llamadas).toBe(0);
  });
});

describe('crearVerificador: la configuración', () => {
  // `cargarConfig` no deja llegar hasta acá. Si alguien arma la configuración a mano, falla al crear y no con el primer token.
  it('el modo jwks sin URL no se puede crear', () => {
    expect(() => crearVerificador(configJwks({ urlJwks: undefined }))).toThrow('urlJwks');
  });
});
