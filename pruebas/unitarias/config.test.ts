import { describe, expect, it } from 'vitest';
import {
  cargarConfig,
  cargarConfigTokens,
  type Entorno,
  type ErrorConfig,
  type ResultadoConfig,
} from '../../src/config.js';

const CLAVE = 'clave-secreta-de-prueba-0123456789abcdef'; // 40 caracteres
const CONTRASENA_BD = 'contrasena-secreta-de-la-base';

// Solo las variables obligatorias: todo lo demás toma su valor por defecto.
const OBLIGATORIAS = {
  M2_URL_BD: `postgres://m2:${CONTRASENA_BD}@bd:5432/m2`,
  M2_CLAVE_TOKENS: CLAVE,
  M2_EMISOR_TOKENS: 'm1-identidad',
  M2_AUDIENCIA_TOKENS: 'm2-clientes',
  M2_URL_M6: 'http://m6:3006/api/v1',
};
const NOMBRES_OBLIGATORIAS = Object.keys(OBLIGATORIAS);

const sin = (env: Entorno, variable: string): Entorno =>
  Object.fromEntries(Object.entries(env).filter(([nombre]) => nombre !== variable));

const nombres = (errores: ErrorConfig[]): string[] => errores.map((error) => error.variable).sort();

function cargada(env: Entorno) {
  const resultado = cargarConfig(env);
  if (resultado.errores) throw new Error(`la configuración no cargó: ${JSON.stringify(resultado.errores)}`);
  return resultado.config;
}

function erroresDe(resultado: ResultadoConfig<unknown>): ErrorConfig[] {
  if (!resultado.errores) throw new Error('la configuración cargó sin errores');
  return resultado.errores;
}

describe('cargarConfig: valores (RNF-06.1)', () => {
  it('con solo las obligatorias, usa los valores por defecto', () => {
    expect(cargada(OBLIGATORIAS)).toEqual({
      urlBd: OBLIGATORIAS.M2_URL_BD,
      puerto: 8082,
      claveTokens: CLAVE,
      emisorTokens: 'm1-identidad',
      audienciaTokens: 'm2-clientes',
      campoRoles: 'roles',
      tiempoBdMs: 2000,
      tiempoModulosMs: 2000,
      reintentosModulos: 1,
      encabezadoCorrelacion: 'X-Request-Id',
      urlM6: 'http://m6:3006/api/v1',
      credencialM6: undefined,
      reintentarDespuesS: 5,
    });
  });

  it('con todas las variables definidas, usa sus valores y convierte los números', () => {
    const env = {
      ...OBLIGATORIAS,
      M2_PUERTO: '9090',
      M2_CAMPO_ROLES: 'permisos',
      M2_TIEMPO_BD_MS: '500',
      M2_TIEMPO_MODULOS_MS: '750',
      M2_REINTENTOS_MODULOS: '3',
      M2_ENCABEZADO_CORRELACION: 'X-Correlation-Id',
      M2_URL_M6: 'https://m6.interno:8443/api/v1',
      M2_CREDENCIAL_M6: 'credencial.de-prueba_0123',
      M2_REINTENTAR_DESPUES_S: '30',
    };
    expect(cargada(env)).toEqual({
      urlBd: OBLIGATORIAS.M2_URL_BD,
      puerto: 9090,
      claveTokens: CLAVE,
      emisorTokens: 'm1-identidad',
      audienciaTokens: 'm2-clientes',
      campoRoles: 'permisos',
      tiempoBdMs: 500,
      tiempoModulosMs: 750,
      reintentosModulos: 3,
      encabezadoCorrelacion: 'X-Correlation-Id',
      urlM6: 'https://m6.interno:8443/api/v1',
      credencialM6: 'credencial.de-prueba_0123',
      reintentarDespuesS: 30,
    });
  });

  // Cada fila: variable, valor, campo de la configuración y valor esperado. Son los bordes de cada regla.
  it.each<[string, string, string, unknown]>([
    ['M2_PUERTO', '1', 'puerto', 1],
    ['M2_PUERTO', '65535', 'puerto', 65535],
    ['M2_TIEMPO_BD_MS', '1', 'tiempoBdMs', 1],
    ['M2_TIEMPO_MODULOS_MS', '1', 'tiempoModulosMs', 1],
    ['M2_TIEMPO_BD_MS', '2147483647', 'tiempoBdMs', 2147483647],
    ['M2_TIEMPO_MODULOS_MS', '2147483647', 'tiempoModulosMs', 2147483647],
    ['M2_REINTENTOS_MODULOS', '0', 'reintentosModulos', 0],
    ['M2_REINTENTOS_MODULOS', '5', 'reintentosModulos', 5],
    ['M2_CLAVE_TOKENS', 'k'.repeat(32), 'claveTokens', 'k'.repeat(32)],
    ['M2_URL_BD', 'postgresql://m2:clave@bd:5432/m2', 'urlBd', 'postgresql://m2:clave@bd:5432/m2'],
    ['M2_URL_BD', 'POSTGRES://m2@localhost/m2', 'urlBd', 'POSTGRES://m2@localhost/m2'],
    ['M2_ENCABEZADO_CORRELACION', 'x-request_id.v2', 'encabezadoCorrelacion', 'x-request_id.v2'],
    ['M2_URL_M6', 'http://localhost:3006/api/v1', 'urlM6', 'http://localhost:3006/api/v1'],
    ['M2_URL_M6', 'HTTPS://m6.interno', 'urlM6', 'HTTPS://m6.interno'],
    ['M2_URL_M6', 'http://m6:3006/api/v1/', 'urlM6', 'http://m6:3006/api/v1'],
    ['M2_CREDENCIAL_M6', 'a', 'credencialM6', 'a'],
    ['M2_CREDENCIAL_M6', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhIn0.firma-0_9', 'credencialM6', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhIn0.firma-0_9'],
    ['M2_REINTENTAR_DESPUES_S', '1', 'reintentarDespuesS', 1],
    ['M2_REINTENTAR_DESPUES_S', '3600', 'reintentarDespuesS', 3600],
  ])('%s = %j es válida', (variable, valor, campo, esperado) => {
    expect(cargada({ ...OBLIGATORIAS, [variable]: valor })).toMatchObject({ [campo]: esperado });
  });
});

describe('cargarConfig: valores inválidos (RNF-06.2)', () => {
  it.each<[string, string]>([
    ['M2_URL_BD', 'mysql://m2:clave@bd:3306/m2'],
    ['M2_URL_BD', 'http://bd:5432/m2'],
    ['M2_URL_BD', 'postgres:/bd/m2'],
    ['M2_URL_BD', 'bd:5432/m2'],
    ['M2_URL_BD', 'postgres://bd:99999/m2'],
    ['M2_URL_BD', 'esto no es una url'],
    ['M2_PUERTO', '0'],
    ['M2_PUERTO', '65536'],
    ['M2_PUERTO', '-1'],
    ['M2_PUERTO', '80.5'],
    ['M2_PUERTO', '1e3'],
    ['M2_PUERTO', '0x50'],
    ['M2_PUERTO', '8082 '],
    ['M2_PUERTO', 'abc'],
    ['M2_CLAVE_TOKENS', 'k'.repeat(31)],
    ['M2_TIEMPO_BD_MS', '0'],
    ['M2_TIEMPO_BD_MS', '-5'],
    ['M2_TIEMPO_BD_MS', '1.5'],
    ['M2_TIEMPO_BD_MS', 'rápido'],
    ['M2_TIEMPO_BD_MS', '2147483648'],
    ['M2_TIEMPO_MODULOS_MS', '0'],
    ['M2_TIEMPO_MODULOS_MS', '-5'],
    ['M2_TIEMPO_MODULOS_MS', '1.5'],
    ['M2_TIEMPO_MODULOS_MS', 'rápido'],
    ['M2_TIEMPO_MODULOS_MS', '2147483648'],
    ['M2_REINTENTOS_MODULOS', '-1'],
    ['M2_REINTENTOS_MODULOS', '6'],
    ['M2_REINTENTOS_MODULOS', '1.5'],
    ['M2_REINTENTOS_MODULOS', 'uno'],
    ['M2_ENCABEZADO_CORRELACION', 'X Request Id'],
    ['M2_ENCABEZADO_CORRELACION', 'X-Request-Id:'],
    ['M2_ENCABEZADO_CORRELACION', 'X-Correlación'],
    ['M2_ENCABEZADO_CORRELACION', 'X-Id\r\nOtro: 1'],
    ['M2_URL_M6', 'ftp://m6:3006/api/v1'],
    ['M2_URL_M6', 'm6:3006/api/v1'],
    ['M2_URL_M6', 'http:/m6/api'],
    ['M2_URL_M6', 'http://m6:99999/api/v1'],
    ['M2_URL_M6', 'esto no es una url'],
    ['M2_CREDENCIAL_M6', 'con espacio'],
    ['M2_CREDENCIAL_M6', 'con\r\nsalto'],
    ['M2_CREDENCIAL_M6', 'ñandú'],
    ['M2_REINTENTAR_DESPUES_S', '0'],
    ['M2_REINTENTAR_DESPUES_S', '3601'],
    ['M2_REINTENTAR_DESPUES_S', '1.5'],
    ['M2_REINTENTAR_DESPUES_S', 'pronto'],
  ])('%s = %j es inválida y se informa sola', (variable, valor) => {
    const errores = erroresDe(cargarConfig({ ...OBLIGATORIAS, [variable]: valor }));
    expect(nombres(errores)).toEqual([variable]);
  });

  // Los dos tiempos tienen la misma regla: un entero entre 1 y 2147483647, el mayor que aceptan los temporizadores de
  // Node. El error trae solo la variable y ese motivo: ni rastro del valor recibido.
  const MOTIVO_TIEMPO = 'no es un entero entre 1 y 2147483647';
  const VALORES_INVALIDOS_DE_TIEMPO = ['0', '-5', '1.5', 'rápido', '2147483648', '99999999999999999999'];
  it.each(
    ['M2_TIEMPO_BD_MS', 'M2_TIEMPO_MODULOS_MS'].flatMap((variable) =>
      VALORES_INVALIDOS_DE_TIEMPO.map((valor): [string, string] => [variable, valor]),
    ),
  )('%s = %j: el error da el motivo del tope', (variable, valor) => {
    expect(erroresDe(cargarConfig({ ...OBLIGATORIAS, [variable]: valor }))).toEqual([
      { variable, motivo: MOTIVO_TIEMPO },
    ]);
  });

  it('informa todas las variables con problemas, no solo la primera', () => {
    const errores = erroresDe(
      cargarConfig({
        ...sin(OBLIGATORIAS, 'M2_CLAVE_TOKENS'),
        M2_PUERTO: 'abc',
        M2_TIEMPO_BD_MS: '0',
        M2_REINTENTOS_MODULOS: '9',
      }),
    );
    expect(nombres(errores)).toEqual(
      ['M2_CLAVE_TOKENS', 'M2_PUERTO', 'M2_REINTENTOS_MODULOS', 'M2_TIEMPO_BD_MS'].sort(),
    );
  });

  // Los valores pueden ser secretos (la clave, la contraseña de la base): el error nombra la variable y nada más.
  const CENTINELA = 'valor-centinela-7f3a';
  it.each<[string, string]>([
    ['M2_URL_BD', `mysql://m2:${CENTINELA}@bd:3306/m2`],
    ['M2_PUERTO', CENTINELA],
    ['M2_CLAVE_TOKENS', CENTINELA],
    ['M2_TIEMPO_BD_MS', CENTINELA],
    ['M2_TIEMPO_MODULOS_MS', CENTINELA],
    ['M2_REINTENTOS_MODULOS', CENTINELA],
    ['M2_ENCABEZADO_CORRELACION', `${CENTINELA} con espacios`],
    ['M2_URL_M6', `ftp://usuario:${CENTINELA}@m6/api`],
    ['M2_CREDENCIAL_M6', `${CENTINELA} con espacios`],
    ['M2_REINTENTAR_DESPUES_S', CENTINELA],
  ])('%s inválida: el error no repite el valor recibido', (variable, valor) => {
    const errores = erroresDe(cargarConfig({ ...OBLIGATORIAS, [variable]: valor }));
    expect(nombres(errores)).toEqual([variable]);
    const texto = JSON.stringify(errores);
    expect(texto).not.toContain(CENTINELA);
    expect(texto).not.toContain(CLAVE);
    expect(texto).not.toContain(CONTRASENA_BD);
  });
});

describe('cargarConfig: variables que faltan o están vacías (RNF-06.1, RNF-06.2)', () => {
  it.each(NOMBRES_OBLIGATORIAS)('si falta %s, se informa sola', (variable) => {
    const errores = erroresDe(cargarConfig(sin(OBLIGATORIAS, variable)));
    expect(nombres(errores)).toEqual([variable]);
  });

  it.each(NOMBRES_OBLIGATORIAS)('si %s está vacía, cuenta como no definida', (variable) => {
    const vacia = erroresDe(cargarConfig({ ...OBLIGATORIAS, [variable]: '' }));
    const ausente = erroresDe(cargarConfig(sin(OBLIGATORIAS, variable)));
    expect(vacia).toEqual(ausente);
  });

  it('sin ninguna variable, informa las cinco obligatorias y nada más', () => {
    expect(nombres(erroresDe(cargarConfig({})))).toEqual([...NOMBRES_OBLIGATORIAS].sort());
  });

  it('las opcionales vacías toman su valor por defecto, también el nombre del encabezado', () => {
    const vacias = {
      ...OBLIGATORIAS,
      M2_PUERTO: '',
      M2_CAMPO_ROLES: '',
      M2_TIEMPO_BD_MS: '',
      M2_TIEMPO_MODULOS_MS: '',
      M2_REINTENTOS_MODULOS: '',
      M2_ENCABEZADO_CORRELACION: '',
      M2_CREDENCIAL_M6: '',
      M2_REINTENTAR_DESPUES_S: '',
    };
    expect(cargada(vacias)).toEqual(cargada(OBLIGATORIAS));
  });
});

describe('cargarConfigTokens (RNF-06.1, RNF-06.2)', () => {
  const SOLO_TOKENS = {
    M2_CLAVE_TOKENS: CLAVE,
    M2_EMISOR_TOKENS: 'm1-identidad',
    M2_AUDIENCIA_TOKENS: 'm2-clientes',
  };
  const NOMBRES_TOKENS = Object.keys(SOLO_TOKENS);

  it('pide solo las variables de los tokens: no necesita la base ni lo demás', () => {
    expect(cargarConfigTokens(SOLO_TOKENS)).toEqual({
      config: { claveTokens: CLAVE, emisorTokens: 'm1-identidad', audienciaTokens: 'm2-clientes', campoRoles: 'roles' },
    });
  });

  it('usa M2_CAMPO_ROLES si está definida', () => {
    const resultado = cargarConfigTokens({ ...SOLO_TOKENS, M2_CAMPO_ROLES: 'permisos' });
    expect(resultado.config?.campoRoles).toBe('permisos');
  });

  it('no mira las variables que no son de los tokens, aunque sean inválidas', () => {
    const resultado = cargarConfigTokens({
      ...SOLO_TOKENS,
      M2_URL_BD: 'no-es-una-url',
      M2_PUERTO: 'abc',
      M2_ENCABEZADO_CORRELACION: 'con espacios',
    });
    expect(resultado.errores).toBeUndefined();
    expect(resultado.config).toBeDefined();
  });

  it.each(NOMBRES_TOKENS)('si falta %s, se informa sola', (variable) => {
    expect(nombres(erroresDe(cargarConfigTokens(sin(SOLO_TOKENS, variable))))).toEqual([variable]);
  });

  it.each(NOMBRES_TOKENS)('si %s está vacía, cuenta como no definida', (variable) => {
    expect(nombres(erroresDe(cargarConfigTokens({ ...SOLO_TOKENS, [variable]: '' })))).toEqual([variable]);
  });

  it('sin ninguna variable, informa solo las tres de los tokens', () => {
    expect(nombres(erroresDe(cargarConfigTokens({})))).toEqual([...NOMBRES_TOKENS].sort());
  });

  it('rechaza una clave de menos de 32 caracteres sin repetirla', () => {
    const corta = 'clave-corta-centinela';
    const errores = erroresDe(cargarConfigTokens({ ...SOLO_TOKENS, M2_CLAVE_TOKENS: corta }));
    expect(nombres(errores)).toEqual(['M2_CLAVE_TOKENS']);
    expect(JSON.stringify(errores)).not.toContain(corta);
  });
});
