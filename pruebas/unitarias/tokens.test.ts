import { decodeJwt, decodeProtectedHeader, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generarToken, ROLES_CONOCIDOS, verificarToken } from '../../src/auth/tokens.js';
import type { ConfigTokens, Entorno } from '../../src/config.js';
import { NoAutenticado } from '../../src/errores.js';
import { main } from '../../src/herramientas/token.js';
import {
  armarToken,
  base64url,
  codificar,
  CONFIG_TOKENS,
  firmar,
  type OpcionesToken,
  SUB_DE_PRUEBA,
} from '../ayudas/tokens.js';

// Un reloj fijo para todo el archivo: así los bordes de la tolerancia no dependen del milisegundo en que corre cada prueba.
const AHORA = Date.parse('2026-10-19T12:00:00Z') / 1000;

beforeEach(() => {
  vi.setSystemTime(AHORA * 1000);
});

afterEach(() => {
  vi.useRealTimers();
});

// Los motivos del 401: son el `detail` de la respuesta.
const FALTA = 'Falta el token';
const MAL_FORMADO = 'El token está mal formado';
const FIRMA = 'El token no está firmado con HS256 y la clave del servicio';
const VENCIDO = 'El token venció';
const SIN_VENCIMIENTO = 'El token no tiene fecha de vencimiento (exp)';
const TODAVIA_NO = 'El token todavía no es válido (nbf)';
const SUB_INVALIDO = 'El sub del token falta, está vacío o no es texto';
const EMISOR = 'El emisor del token no es el esperado';
const AUDIENCIA = 'La audiencia del token no es la esperada';
const ROLES_INVALIDOS = 'El campo de roles del token no es una lista de textos';
const NO_VALIDO = 'El token no es válido';

const verificar = (token: string, config: ConfigTokens = CONFIG_TOKENS) => verificarToken(`Bearer ${token}`, config);

// Espera un 401 con este motivo y comprueba lo que vale para todos (RNF-12.2): `WWW-Authenticate: Bearer` y un detail que
// no repite el token ni ninguna de sus partes.
async function rechazo(resultado: Promise<unknown>, motivo: string, token = '') {
  const error = await resultado.catch((e: unknown) => e);

  expect(error).toBeInstanceOf(NoAutenticado);
  const { codigo, title, detail, encabezados } = error as NoAutenticado;
  expect({ codigo, title, detail, encabezados }).toEqual({
    codigo: 401,
    title: 'No autenticado',
    detail: motivo,
    encabezados: { 'WWW-Authenticate': 'Bearer' },
  });
  for (const parte of [token, ...token.split('.')].filter((texto) => texto.length > 8)) {
    expect(detail).not.toContain(parte);
  }
}

describe('verificarToken: acepta un token válido y dice quién llama (RNF-12.4)', () => {
  it('devuelve el sub y los roles del token', async () => {
    const token = armarToken({ claims: { sub: 'abc-123', roles: ['CLIENTE', 'OPERADOR'] } });

    await expect(verificar(token)).resolves.toStrictEqual({ sub: 'abc-123', roles: ['CLIENTE', 'OPERADOR'] });
  });

  it.each([...ROLES_CONOCIDOS])('acepta el rol %s', async (rol) => {
    await expect(verificar(armarToken({ claims: { roles: [rol] } }))).resolves.toStrictEqual({
      sub: SUB_DE_PRUEBA,
      roles: [rol],
    });
  });

  it('los roles conocidos son CLIENTE, CONDUCTOR, OPERADOR y SERVICIO (RNF-12.3)', () => {
    expect(ROLES_CONOCIDOS).toStrictEqual(['CLIENTE', 'CONDUCTOR', 'OPERADOR', 'SERVICIO']);
  });

  it('no se fija en los claims que el servicio no usa', async () => {
    const token = armarToken({ claims: { name: 'Ana', email: 'ana@example.com', iat: AHORA - 5, jti: 'x' } });

    await expect(verificar(token)).resolves.toStrictEqual({ sub: SUB_DE_PRUEBA, roles: ['CLIENTE'] });
  });

  it.each(['Bearer', 'bearer', 'BEARER', 'bEaReR'])(
    'acepta el esquema escrito como %s: no distingue mayúsculas',
    async (esquema) => {
      const token = armarToken();

      await expect(verificarToken(`${esquema} ${token}`, CONFIG_TOKENS)).resolves.toMatchObject({ sub: SUB_DE_PRUEBA });
    },
  );

  it('acepta más de un espacio entre el esquema y el token', async () => {
    const token = armarToken();

    await expect(verificarToken(`Bearer    ${token}`, CONFIG_TOKENS)).resolves.toMatchObject({ sub: SUB_DE_PRUEBA });
  });
});

describe('verificarToken: 401 «Falta el token» si no hay un Authorization con la forma Bearer <token> (RNF-12.2)', () => {
  const token = armarToken();

  it.each([
    ['no hay encabezado', undefined],
    ['el encabezado está vacío', ''],
    ['son solo espacios', '   '],
    ['dice solo Bearer', 'Bearer'],
    ['dice Bearer y un espacio', 'Bearer '],
    ['dice Bearer y varios espacios', 'Bearer     '],
    ['es otro esquema', 'Basic dXNlcjpjbGF2ZQ=='],
    ['es el token sin esquema', token],
    ['el esquema es Token', `Token ${token}`],
    ['el esquema es otro que termina en Bearer', `MalBearer ${token}`],
    ['no hay espacio después de Bearer', `Bearer${token}`],
    ['vienen dos tokens', `Bearer ${token} ${token}`],
    ['el token está seguido de otra palabra', `Bearer ${token} extra`],
    ['Bearer aparece dos veces', `Bearer Bearer ${token}`],
  ])('cuando %s', async (_caso, encabezado) => {
    await rechazo(verificarToken(encabezado, CONFIG_TOKENS), FALTA, token);
  });
});

describe('verificarToken: 401 por token mal formado (RNF-12.2)', () => {
  const [cabecera = '', cuerpo = '', firma = ''] = armarToken().split('.');
  // Un token con cabecera y cuerpo escritos a mano, bien firmado: lo único mal es su contenido.
  const firmadoCon = (cabeceraTexto: string, cuerpoTexto: string) => {
    const firmado = `${base64url(cabeceraTexto)}.${base64url(cuerpoTexto)}`;
    return `${firmado}.${firmar(firmado, CONFIG_TOKENS.claveTokens)}`;
  };

  it.each([
    ['un texto cualquiera', 'esto-no-es-un-token'],
    ['tres partes que no son un token', 'a.b.c'],
    ['solo dos partes', `${cabecera}.${cuerpo}`],
    ['cuatro partes', `${cabecera}.${cuerpo}.${firma}.extra`],
    ['una cabecera que no es JSON', `${base64url('no es json')}.${cuerpo}.${firma}`],
    ['una cabecera que es JSON pero no un objeto', `${base64url('"HS256"')}.${cuerpo}.${firma}`],
    ['un cuerpo que no es JSON', firmadoCon('{"alg":"HS256"}', 'no es json')],
    ['un cuerpo que es un texto JSON', firmadoCon('{"alg":"HS256"}', '"un texto"')],
    ['un cuerpo que es una lista JSON', firmadoCon('{"alg":"HS256"}', '[1,2]')],
    ['un cuerpo que es un número JSON', firmadoCon('{"alg":"HS256"}', '123')],
    ['un cuerpo que es null', firmadoCon('{"alg":"HS256"}', 'null')],
    ['una cabecera sin alg', firmadoCon('{"typ":"JWT"}', '{"sub":"abc"}')],
    ['una cabecera con un alg que no es texto', firmadoCon('{"alg":256}', '{"sub":"abc"}')],
  ])('con %s', async (_caso, token) => {
    await rechazo(verificar(token), MAL_FORMADO, token);
  });

  it.each([
    ['exp es un texto', { exp: '1792411200' }],
    ['exp es null', { exp: null }],
    ['nbf es un texto', { nbf: 'ayer' }],
    ['iat es un texto', { iat: 'hoy' }],
  ])('cuando %s', async (_caso, claims) => {
    const token = armarToken({ claims });

    await rechazo(verificar(token), MAL_FORMADO, token);
  });
});

describe('verificarToken: 401 si no está firmado con HS256 y la clave configurada (RNF-12.2)', () => {
  const otraClave = 'otra-clave-de-prueba-de-32-caracteres';

  it.each<[string, OpcionesToken]>([
    ['otra clave', { clave: otraClave }],
    ['una clave que cambia un solo carácter', { clave: 'clave-de-prueba-de-32-caracteres?' }],
    ['una clave más larga que empieza igual', { clave: `${CONFIG_TOKENS.claveTokens}!` }],
    ['otro algoritmo: HS384', { alg: 'HS384' }],
    ['otro algoritmo: HS512', { alg: 'HS512' }],
    ['alg none, sin firma', { alg: 'none' }],
    ['alg NONE, sin firma', { alg: 'none', cabecera: { alg: 'NONE' } }],
    ['alg None, sin firma', { alg: 'none', cabecera: { alg: 'None' } }],
    ['alg hs256 en minúsculas', { cabecera: { alg: 'hs256' } }],
    ['un alg que no existe', { cabecera: { alg: 'HS257' } }],
  ])('con %s', async (_caso, opciones) => {
    const token = armarToken(opciones);

    await rechazo(verificar(token), FIRMA, token);
  });

  it('con alg HS256 y la firma vacía', async () => {
    const token = armarToken().replace(/\.[^.]*$/, '.');

    await rechazo(verificar(token), FIRMA, token);
  });

  it('con otro algoritmo, ES256, firmado con un par de claves', async () => {
    const { privateKey } = await generateKeyPair('ES256');
    const token = await new SignJWT({ roles: ['CLIENTE'] })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer(CONFIG_TOKENS.emisorTokens)
      .setAudience(CONFIG_TOKENS.audienciaTokens)
      .setSubject(SUB_DE_PRUEBA)
      .setExpirationTime(AHORA + 3600)
      .sign(privateKey);

    await rechazo(verificar(token), FIRMA, token);
  });

  it('con el cuerpo cambiado después de firmar', async () => {
    const [cabecera = '', , firma = ''] = armarToken().split('.');
    const [, cuerpoDeOperador = ''] = armarToken({ claims: { roles: ['OPERADOR'] } }).split('.');
    const token = `${cabecera}.${cuerpoDeOperador}.${firma}`;

    await rechazo(verificar(token), FIRMA, token);
  });

  it('la firma se comprueba antes que lo que dice el token: uno falso y vencido no dice por qué vencería', async () => {
    const token = armarToken({
      clave: otraClave,
      claims: { exp: AHORA - 3600, nbf: AHORA + 3600, sub: '', iss: 'otro', aud: 'otra', roles: 'CLIENTE' },
    });

    await rechazo(verificar(token), FIRMA, token);
  });
});

describe('verificarToken: 401 por el vencimiento y por nbf, con 30 s de tolerancia de reloj (RNF-12.2)', () => {
  it('sin exp', async () => {
    const token = armarToken({ claims: { exp: undefined } });

    await rechazo(verificar(token), SIN_VENCIMIENTO, token);
  });

  it.each([
    ['venció hace 1 s', AHORA - 1],
    ['venció hace 29 s, dentro de la tolerancia', AHORA - 29],
  ])('acepta un token que %s', async (_caso, exp) => {
    await expect(verificar(armarToken({ claims: { exp } }))).resolves.toMatchObject({ sub: SUB_DE_PRUEBA });
  });

  it.each([
    ['venció hace 31 s, fuera de la tolerancia', AHORA - 31],
    ['venció hace una hora', AHORA - 3600],
    ['venció en 1970', 1],
  ])('rechaza un token que %s', async (_caso, exp) => {
    const token = armarToken({ claims: { exp } });

    await rechazo(verificar(token), VENCIDO, token);
  });

  it.each([
    ['empieza a valer en 1 s', AHORA + 1],
    ['empieza a valer en 29 s, dentro de la tolerancia', AHORA + 29],
    ['ya empezó a valer', AHORA - 60],
  ])('acepta un token que %s', async (_caso, nbf) => {
    await expect(verificar(armarToken({ claims: { nbf } }))).resolves.toMatchObject({ sub: SUB_DE_PRUEBA });
  });

  it.each([
    ['empieza a valer en 31 s, fuera de la tolerancia', AHORA + 31],
    ['empieza a valer en una hora', AHORA + 3600],
  ])('rechaza un token que %s', async (_caso, nbf) => {
    const token = armarToken({ claims: { nbf } });

    await rechazo(verificar(token), TODAVIA_NO, token);
  });
});

describe('verificarToken: 401 si el sub falta, está vacío o no es texto (RNF-12.2)', () => {
  it.each([
    ['falta', undefined],
    ['es un texto vacío', ''],
    ['son solo espacios', '   '],
    ['es un número', 123],
    ['es true', true],
    ['es una lista', [SUB_DE_PRUEBA]],
    ['es un objeto', { id: SUB_DE_PRUEBA }],
    ['es null', null],
  ])('cuando el sub %s', async (_caso, sub) => {
    const token = armarToken({ claims: { sub } });

    await rechazo(verificar(token), SUB_INVALIDO, token);
  });
});

describe('verificarToken: 401 si el emisor o la audiencia no son los configurados (RNF-12.2)', () => {
  it.each([
    ['es otro', 'otro-emisor'],
    ['falta', undefined],
    ['no es un texto', ['pruebas']],
    ['es el esperado con otras mayúsculas', 'PRUEBAS'],
  ])('cuando el emisor %s', async (_caso, iss) => {
    const token = armarToken({ claims: { iss } });

    await rechazo(verificar(token), EMISOR, token);
  });

  it.each([
    ['es otra', 'otra-audiencia'],
    ['falta', undefined],
    ['es una lista sin la esperada', ['a', 'b']],
    ['es una lista vacía', []],
    ['es la esperada con otras mayúsculas', 'M2'],
  ])('cuando la audiencia %s', async (_caso, aud) => {
    const token = armarToken({ claims: { aud } });

    await rechazo(verificar(token), AUDIENCIA, token);
  });

  it('usa el emisor y la audiencia de la configuración que recibe', async () => {
    const config = { ...CONFIG_TOKENS, emisorTokens: 'm1-identidad', audienciaTokens: 'm2-clientes' };
    const token = armarToken({ config });

    await expect(verificar(token, config)).resolves.toMatchObject({ sub: SUB_DE_PRUEBA });
    await rechazo(verificar(token), EMISOR, token);
  });
});

describe('verificarToken: 401 si el campo de roles existe y no es una lista de textos (RNF-12.2)', () => {
  it.each([
    ['un texto', 'CLIENTE'],
    ['un número', 1],
    ['true', true],
    ['null', null],
    ['un objeto', { 0: 'CLIENTE' }],
    ['una lista con un número', ['CLIENTE', 1]],
    ['una lista con null', ['CLIENTE', null]],
    ['una lista de listas', [['CLIENTE']]],
    ['una lista con un objeto', [{ rol: 'CLIENTE' }]],
  ])('cuando es %s', async (_caso, roles) => {
    const token = armarToken({ claims: { roles } });

    await rechazo(verificar(token), ROLES_INVALIDOS, token);
  });
});

describe('verificarToken: devuelve solo los roles conocidos (RNF-12.3)', () => {
  it.each<[string, unknown[], string[]]>([
    ['conserva los conocidos y saca los demás', ['CLIENTE', 'ADMIN', 'SERVICIO'], ['CLIENTE', 'SERVICIO']],
    ['conserva el orden del token', ['SERVICIO', 'CLIENTE', 'CONDUCTOR'], ['SERVICIO', 'CLIENTE', 'CONDUCTOR']],
    ['ignora los roles en minúsculas o con otras mayúsculas', ['cliente', 'Conductor', 'operador'], []],
    ['ignora los que tienen espacios o saltos de línea', [' CLIENTE', 'CLIENTE ', 'CLIENTE\n'], []],
    ['ignora los textos vacíos', ['', ' '], []],
    ['con la lista vacía no tiene ninguno', [], []],
    ['con solo desconocidos no tiene ninguno', ['ADMIN', 'ROOT'], []],
  ])('%s', async (_caso, roles, esperados) => {
    await expect(verificar(armarToken({ claims: { roles } }))).resolves.toStrictEqual({
      sub: SUB_DE_PRUEBA,
      roles: esperados,
    });
  });

  it('un token sin el campo de roles no tiene ninguno', async () => {
    const token = armarToken({ claims: { roles: undefined } });

    await expect(verificar(token)).resolves.toStrictEqual({ sub: SUB_DE_PRUEBA, roles: [] });
  });
});

describe('verificarToken: los roles salen del campo configurado (RNF-12.4)', () => {
  const config = { ...CONFIG_TOKENS, campoRoles: 'permisos' };

  it('lee el campo configurado y no mira el llamado roles', async () => {
    const token = armarToken({ config, claims: { roles: ['CLIENTE'], permisos: ['OPERADOR'] } });

    await expect(verificar(token, config)).resolves.toStrictEqual({ sub: SUB_DE_PRUEBA, roles: ['OPERADOR'] });
  });

  it('sin el campo configurado no tiene roles, aunque haya otro llamado roles', async () => {
    const token = armarToken({ claims: { roles: ['CLIENTE'] } });

    await expect(verificar(token, config)).resolves.toStrictEqual({ sub: SUB_DE_PRUEBA, roles: [] });
  });

  it('un campo roles que no es una lista no importa si el configurado es otro', async () => {
    const token = armarToken({ config, claims: { roles: 'CLIENTE', permisos: ['OPERADOR'] } });

    await expect(verificar(token, config)).resolves.toStrictEqual({ sub: SUB_DE_PRUEBA, roles: ['OPERADOR'] });
  });

  it('un campo configurado que no es una lista da 401', async () => {
    const token = armarToken({ config, claims: { permisos: 'OPERADOR' } });

    await rechazo(verificar(token, config), ROLES_INVALIDOS, token);
  });

  it.each(['toString', 'constructor', 'hasOwnProperty', '__proto__'])(
    'el nombre %s, que todo objeto tiene por herencia, no cuenta como un campo que el token trae',
    async (campoRoles) => {
      const token = armarToken();

      await expect(verificar(token, { ...CONFIG_TOKENS, campoRoles })).resolves.toStrictEqual({
        sub: SUB_DE_PRUEBA,
        roles: [],
      });
    },
  );
});

describe('verificarToken: el resto de los fallos', () => {
  it('una extensión crítica que no conoce es un 401 con un motivo general', async () => {
    const token = armarToken({ cabecera: { crit: ['foo'], foo: 1 } });

    await rechazo(verificar(token), NO_VALIDO, token);
  });

  it('una clave que no sirve no es culpa del token: no se vuelve un 401', async () => {
    const config = { ...CONFIG_TOKENS, claveTokens: '' };

    await expect(verificar(armarToken(), config)).rejects.not.toBeInstanceOf(NoAutenticado);
  });
});

describe('generarToken: firma un token que verificarToken acepta (RNF-12.5)', () => {
  const sub = '5f0c3a52-1d2e-4b6f-9a3c-7e8d9f0a1b2c';

  it.each([
    ['un rol', ['CLIENTE']],
    ['dos roles', ['CLIENTE', 'CONDUCTOR']],
    ['los cuatro roles', ['CLIENTE', 'CONDUCTOR', 'OPERADOR', 'SERVICIO']],
    ['ningún rol', []],
  ])('ida y vuelta con %s: vuelven el mismo sub y los mismos roles', async (_caso, roles) => {
    const token = await generarToken({ sub, roles }, CONFIG_TOKENS);

    await expect(verificar(token)).resolves.toStrictEqual({ sub, roles });
  });

  it('firma con HS256', async () => {
    const token = await generarToken({ sub, roles: ['CLIENTE'] }, CONFIG_TOKENS);

    expect(decodeProtectedHeader(token)).toStrictEqual({ alg: 'HS256', typ: 'JWT' });
  });

  it('lleva iss, aud, sub, iat, exp y los roles, y nada más', async () => {
    const token = await generarToken({ sub, roles: ['CLIENTE', 'OPERADOR'] }, CONFIG_TOKENS);

    expect(decodeJwt(token)).toStrictEqual({
      iss: CONFIG_TOKENS.emisorTokens,
      aud: CONFIG_TOKENS.audienciaTokens,
      sub,
      iat: AHORA,
      exp: AHORA + 3600,
      roles: ['CLIENTE', 'OPERADOR'],
    });
  });

  it('cuenta segundos enteros: a los 999 ms de un segundo todavía es ese segundo', async () => {
    vi.setSystemTime(AHORA * 1000 + 999);
    const token = await generarToken({ sub, roles: ['CLIENTE'] }, CONFIG_TOKENS);

    expect(decodeJwt(token)).toMatchObject({ iat: AHORA, exp: AHORA + 3600 });
  });

  it.each([
    ['60 s', 60],
    ['un día', 86_400],
  ])('vence en %s si se le pide', async (_caso, venceEnSegundos) => {
    const token = await generarToken({ sub, roles: ['CLIENTE'], venceEnSegundos }, CONFIG_TOKENS);

    expect(decodeJwt(token)).toMatchObject({ iat: AHORA, exp: AHORA + venceEnSegundos });
  });

  it('deja de valer cuando vence, con los 30 s de tolerancia', async () => {
    const token = await generarToken({ sub, roles: ['CLIENTE'], venceEnSegundos: 60 }, CONFIG_TOKENS);

    vi.setSystemTime((AHORA + 60 + 29) * 1000);
    await expect(verificar(token)).resolves.toMatchObject({ sub });

    vi.setSystemTime((AHORA + 60 + 31) * 1000);
    await rechazo(verificar(token), VENCIDO, token);
  });

  it('pone los roles en el campo configurado', async () => {
    const config = { ...CONFIG_TOKENS, campoRoles: 'permisos' };
    const token = await generarToken({ sub, roles: ['OPERADOR'] }, config);

    expect(decodeJwt(token)).toMatchObject({ permisos: ['OPERADOR'] });
    expect(decodeJwt(token)).not.toHaveProperty('roles');
    await expect(verificar(token, config)).resolves.toStrictEqual({ sub, roles: ['OPERADOR'] });
  });

  it('no valida el sub ni los roles: firma lo que se le pide', async () => {
    const token = await generarToken({ sub: '', roles: ['cliente', 'ADMIN'] }, CONFIG_TOKENS);

    expect(decodeJwt(token)).toMatchObject({ sub: '', roles: ['cliente', 'ADMIN'] });
  });

  it.each([
    ['otra clave', { claveTokens: 'otra-clave-de-prueba-de-32-caracteres' }, FIRMA],
    ['otro emisor', { emisorTokens: 'otro-emisor' }, EMISOR],
    ['otra audiencia', { audienciaTokens: 'otra-audiencia' }, AUDIENCIA],
  ])('quien espera %s lo rechaza', async (_caso, cambio, motivo) => {
    const token = await generarToken({ sub, roles: ['CLIENTE'] }, CONFIG_TOKENS);

    await rechazo(verificar(token, { ...CONFIG_TOKENS, ...cambio }), motivo, token);
  });

  it('la firma es la de cualquier biblioteca: HMAC-SHA256 con la clave como texto UTF-8', async () => {
    const token = await generarToken({ sub, roles: ['CLIENTE'] }, CONFIG_TOKENS);
    const [cabecera, cuerpo, firma] = token.split('.');

    expect(firma).toBe(firmar(`${cabecera}.${cuerpo}`, CONFIG_TOKENS.claveTokens));
    expect(cabecera).toBe(codificar({ alg: 'HS256', typ: 'JWT' }));
  });

  // Con una clave solo ASCII, UTF-8 da los mismos bytes que latin1 y que otras codificaciones; con la ñ y el € ya no. Así se
  // fija que la clave es el texto en UTF-8, al firmar y al verificar.
  it('una clave con ñ y € también se toma como texto UTF-8, al firmar y al verificar', async () => {
    const config = { ...CONFIG_TOKENS, claveTokens: 'clave-de-prueba-con-ñ-y-€-en-utf-8' };
    const token = await generarToken({ sub, roles: ['CLIENTE'] }, config);
    const [cabecera, cuerpo, firma] = token.split('.');

    expect(firma).toBe(firmar(`${cabecera}.${cuerpo}`, config.claveTokens));
    await expect(verificar(armarToken({ config }), config)).resolves.toStrictEqual({
      sub: SUB_DE_PRUEBA,
      roles: ['CLIENTE'],
    });
  });
});

// El comando de desarrollo que genera tokens (RNF-12.5). Las pruebas llaman a `main` como función, con los argumentos y el
// entorno que recibiría de la línea de comandos. Lo que imprime se junta de console.log (la salida) y console.error (los
// errores): cada llamada es una entrada de la lista.
const ENTORNO = {
  M2_CLAVE_TOKENS: CONFIG_TOKENS.claveTokens,
  M2_EMISOR_TOKENS: CONFIG_TOKENS.emisorTokens,
  M2_AUDIENCIA_TOKENS: CONFIG_TOKENS.audienciaTokens,
};

// Tres partes en base64url separadas por puntos y nada más: ni texto delante, ni espacios, ni saltos de línea.
const FORMA_DE_TOKEN = /^[\w-]+\.[\w-]+\.[\w-]+$/;

async function comando(argv: string[], env: Entorno = ENTORNO) {
  const salida = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const errores = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const codigo = await main(argv, env);
    const lineas = (espia: typeof salida) => espia.mock.calls.map((argumentos) => argumentos.join(' '));
    return { codigo, salida: lineas(salida), errores: lineas(errores) };
  } finally {
    salida.mockRestore();
    errores.mockRestore();
  }
}

describe('main, el comando de tokens: imprime un token que verificarToken acepta (RNF-12.5)', () => {
  it('con --sub, --roles y --vence: imprime solo el token, con ese sub, esos roles y ese vencimiento', async () => {
    const { codigo, salida, errores } = await comando([
      '--sub',
      SUB_DE_PRUEBA,
      '--roles',
      'CLIENTE,OPERADOR',
      '--vence',
      '60',
    ]);

    expect(codigo).toBe(0);
    expect(errores).toEqual([]);
    expect(salida).toHaveLength(1);
    const [token] = salida;
    expect(token).toMatch(FORMA_DE_TOKEN);
    await expect(verificar(token)).resolves.toStrictEqual({ sub: SUB_DE_PRUEBA, roles: ['CLIENTE', 'OPERADOR'] });
    expect(decodeJwt(token)).toStrictEqual({
      iss: CONFIG_TOKENS.emisorTokens,
      aud: CONFIG_TOKENS.audienciaTokens,
      sub: SUB_DE_PRUEBA,
      iat: AHORA,
      exp: AHORA + 60,
      roles: ['CLIENTE', 'OPERADOR'],
    });
  });

  it.each([
    ['--vence 60', 60, ['--vence', '60']],
    ['--vence 1', 1, ['--vence', '1']],
    ['--vence 86400', 86_400, ['--vence', '86400']],
    ['sin --vence', 3600, []],
  ])('%s: el token vence a los %i s, con los 30 s de tolerancia', async (_caso, segundos, vence) => {
    const {
      salida: [token],
    } = await comando(['--sub', SUB_DE_PRUEBA, '--roles', 'CLIENTE', ...vence]);

    expect(decodeJwt(token)).toMatchObject({ iat: AHORA, exp: AHORA + segundos });

    vi.setSystemTime((AHORA + segundos + 29) * 1000);
    await expect(verificar(token)).resolves.toMatchObject({ sub: SUB_DE_PRUEBA });

    vi.setSystemTime((AHORA + segundos + 31) * 1000);
    await rechazo(verificar(token), VENCIDO, token);
  });

  it.each([
    ['un rol', 'CLIENTE', ['CLIENTE']],
    ['dos roles', 'CLIENTE,CONDUCTOR', ['CLIENTE', 'CONDUCTOR']],
    ['los cuatro roles', 'CLIENTE,CONDUCTOR,OPERADOR,SERVICIO', ['CLIENTE', 'CONDUCTOR', 'OPERADOR', 'SERVICIO']],
    ['los roles en otro orden', 'SERVICIO,CLIENTE', ['SERVICIO', 'CLIENTE']],
    ['espacios alrededor de cada rol', ' CLIENTE , OPERADOR ', ['CLIENTE', 'OPERADOR']],
    ['comas de más', ',CLIENTE,,OPERADOR,', ['CLIENTE', 'OPERADOR']],
  ])('--roles con %s (valor %j): el token lleva los roles esperados', async (_caso, roles, esperados) => {
    const { codigo, salida, errores } = await comando(['--sub', SUB_DE_PRUEBA, '--roles', roles]);

    expect(codigo).toBe(0);
    expect(errores).toEqual([]);
    expect(decodeJwt(salida[0])).toMatchObject({ roles: esperados });
    await expect(verificar(salida[0])).resolves.toStrictEqual({ sub: SUB_DE_PRUEBA, roles: esperados });
  });

  it.each([
    ['las opciones en otro orden', ['--vence', '60', '--roles', 'CLIENTE', '--sub', SUB_DE_PRUEBA]],
    ['la forma --opcion=valor', ['--vence=60', '--roles=CLIENTE', `--sub=${SUB_DE_PRUEBA}`]],
  ])('acepta %s', async (_caso, argv) => {
    const { codigo, salida } = await comando(argv);

    expect(codigo).toBe(0);
    await expect(verificar(salida[0])).resolves.toStrictEqual({ sub: SUB_DE_PRUEBA, roles: ['CLIENTE'] });
    expect(decodeJwt(salida[0])).toMatchObject({ exp: AHORA + 60 });
  });

  it('firma con la clave, el emisor, la audiencia y el campo de roles del entorno', async () => {
    const otra: ConfigTokens = {
      claveTokens: 'otra-clave-de-prueba-de-32-caracteres',
      emisorTokens: 'otro-emisor',
      audienciaTokens: 'otra-audiencia',
      campoRoles: 'permisos',
    };
    const env = {
      M2_CLAVE_TOKENS: otra.claveTokens,
      M2_EMISOR_TOKENS: otra.emisorTokens,
      M2_AUDIENCIA_TOKENS: otra.audienciaTokens,
      M2_CAMPO_ROLES: otra.campoRoles,
    };

    const { codigo, salida } = await comando(['--sub', SUB_DE_PRUEBA, '--roles', 'OPERADOR'], env);

    expect(codigo).toBe(0);
    expect(decodeJwt(salida[0])).toMatchObject({ iss: 'otro-emisor', aud: 'otra-audiencia', permisos: ['OPERADOR'] });
    await expect(verificar(salida[0], otra)).resolves.toStrictEqual({ sub: SUB_DE_PRUEBA, roles: ['OPERADOR'] });
    await rechazo(verificar(salida[0]), FIRMA, salida[0]);
  });

  it('un rol que el servicio no reconoce se firma igual y se avisa por la salida de errores', async () => {
    const { codigo, salida, errores } = await comando(['--sub', SUB_DE_PRUEBA, '--roles', 'cliente,OPERADOR,ADMIN']);

    expect(codigo).toBe(0);
    expect(errores).toEqual([
      [
        'Aviso: el servicio ignora los roles que no reconoce (cliente, ADMIN).',
        'Los que reconoce, escritos así: CLIENTE, CONDUCTOR, OPERADOR, SERVICIO.',
      ].join(' '),
    ]);
    expect(salida).toHaveLength(1);
    expect(salida[0]).toMatch(FORMA_DE_TOKEN);
    expect(decodeJwt(salida[0])).toMatchObject({ roles: ['cliente', 'OPERADOR', 'ADMIN'] });
    await expect(verificar(salida[0])).resolves.toStrictEqual({ sub: SUB_DE_PRUEBA, roles: ['OPERADOR'] });
  });

  it('importar el módulo no ejecuta el comando: solo exporta main', () => {
    expect(process.exitCode).toBeUndefined();
  });
});

describe('main, el comando de tokens: sin la configuración de tokens (RNF-12.5, RNF-06.2)', () => {
  const argumentos = ['--sub', SUB_DE_PRUEBA, '--roles', 'CLIENTE'];
  const ENCABEZADO = 'La configuración de tokens no es válida:';

  it.each([
    ['M2_CLAVE_TOKENS', undefined],
    ['M2_CLAVE_TOKENS', ''],
    ['M2_EMISOR_TOKENS', undefined],
    ['M2_AUDIENCIA_TOKENS', undefined],
  ])('sin %s (valor %j): código 1, nombra la variable y no imprime ningún token', async (variable, valor) => {
    const { codigo, salida, errores } = await comando(argumentos, { ...ENTORNO, [variable]: valor });

    expect(codigo).toBe(1);
    expect(salida).toEqual([]);
    expect(errores).toEqual([`${ENCABEZADO}\n  ${variable}: es obligatoria y no tiene valor`]);
  });

  it('con una clave de menos de 32 caracteres: nombra la variable, dice por qué y no repite la clave', async () => {
    const clave = 'clave-corta-y-secreta';

    const { codigo, salida, errores } = await comando(argumentos, { ...ENTORNO, M2_CLAVE_TOKENS: clave });

    expect(codigo).toBe(1);
    expect(salida).toEqual([]);
    expect(errores).toEqual([`${ENCABEZADO}\n  M2_CLAVE_TOKENS: tiene menos de 32 caracteres`]);
    expect(errores.join('\n')).not.toContain(clave);
  });

  it('sin ninguna variable: las informa todas juntas', async () => {
    const { codigo, salida, errores } = await comando(argumentos, {});

    expect(codigo).toBe(1);
    expect(salida).toEqual([]);
    expect(errores).toEqual([
      [
        ENCABEZADO,
        '  M2_CLAVE_TOKENS: es obligatoria y no tiene valor',
        '  M2_EMISOR_TOKENS: es obligatoria y no tiene valor',
        '  M2_AUDIENCIA_TOKENS: es obligatoria y no tiene valor',
      ].join('\n'),
    ]);
  });
});

describe('main, el comando de tokens: argumentos que no sirven (RNF-12.5)', () => {
  const USO = 'Uso: node dist/herramientas/token.js --sub <texto> --roles <ROL[,ROL…]> [--vence <segundos>]';
  const NO_VALIDOS = 'Los argumentos no son válidos.';
  const FALTA_SUB = 'Falta --sub, el identificador de quien llama (el sub del token).';
  const FALTA_ROLES = 'Falta --roles, al menos un rol (varios, separados por comas).';
  const VENCE_INVALIDO = '--vence tiene que ser un entero de segundos mayor que 0.';
  const CON_SUB_Y_ROLES = ['--sub', SUB_DE_PRUEBA, '--roles', 'CLIENTE'];

  it.each([
    ['sin argumentos', [], [FALTA_SUB, FALTA_ROLES]],
    ['sin --sub', ['--roles', 'CLIENTE'], [FALTA_SUB]],
    ['con --sub vacío', ['--sub', '', '--roles', 'CLIENTE'], [FALTA_SUB]],
    ['con --sub de solo espacios', ['--sub', '  ', '--roles', 'CLIENTE'], [FALTA_SUB]],
    ['sin --roles', ['--sub', SUB_DE_PRUEBA], [FALTA_ROLES]],
    ['con --roles vacío', ['--sub', SUB_DE_PRUEBA, '--roles', ''], [FALTA_ROLES]],
    ['con --roles que son solo comas y espacios', ['--sub', SUB_DE_PRUEBA, '--roles', ' , ,'], [FALTA_ROLES]],
    ['con --sub vacío y sin --roles', ['--sub', ''], [FALTA_SUB, FALTA_ROLES]],
    ['con --sub vacío, sin --roles y --vence mal', ['--sub', '', '--vence', 'x'], [FALTA_SUB, FALTA_ROLES, VENCE_INVALIDO]],
  ])('%s: código 2 con cada motivo y el uso, y ningún token', async (_caso, argv, motivos) => {
    const { codigo, salida, errores } = await comando(argv);

    expect(codigo).toBe(2);
    expect(salida).toEqual([]);
    expect(errores).toEqual([[...motivos, USO].join('\n')]);
  });

  it.each(['abc', '0', '1.5', '', '60s', '1e3', '+60', ' 60', '0x10', '99999999999999999999'])(
    '--vence %j no es un entero de segundos mayor que 0: código 2',
    async (vence) => {
      const { codigo, salida, errores } = await comando([...CON_SUB_Y_ROLES, '--vence', vence]);

      expect(codigo).toBe(2);
      expect(salida).toEqual([]);
      expect(errores).toEqual([`${VENCE_INVALIDO}\n${USO}`]);
    },
  );

  it('--vence=-60, que ya venció, tampoco: el vencimiento es de más de 0 segundos', async () => {
    const { codigo, salida, errores } = await comando([...CON_SUB_Y_ROLES, '--vence=-60']);

    expect(codigo).toBe(2);
    expect(salida).toEqual([]);
    expect(errores).toEqual([`${VENCE_INVALIDO}\n${USO}`]);
  });

  it.each([
    ['una opción que no existe', [...CON_SUB_Y_ROLES, '--clave', 'secreto-que-no-se-repite']],
    ['un argumento suelto', [...CON_SUB_Y_ROLES, 'secreto-que-no-se-repite']],
    ['--sub sin su valor', ['--roles', 'CLIENTE', '--sub']],
  ])('%s: código 2 con un solo mensaje fijo, sin repetir lo que se pasó', async (_caso, argv) => {
    const { codigo, salida, errores } = await comando(argv);

    expect(codigo).toBe(2);
    expect(salida).toEqual([]);
    expect(errores).toEqual([`${NO_VALIDOS}\n${USO}`]);
  });

  it('controla los argumentos antes que la configuración', async () => {
    const { codigo, errores } = await comando(['--roles', 'CLIENTE'], {});

    expect(codigo).toBe(2);
    expect(errores).toEqual([`${FALTA_SUB}\n${USO}`]);
  });
});
