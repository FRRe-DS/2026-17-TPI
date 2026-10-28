import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cargarConfigM6, cargarConfigPanel } from '../../../panel/servidor/config.js';
import {
  cargarEntornoEjemplo,
  completarEntorno,
  valoresDeEjemplo,
} from '../../../panel/servidor/entorno-ejemplo.js';

const CLAVE = 'clave-de-prueba-de-32-caracteres!';
const TOKENS = {
  M2_CLAVE_TOKENS: CLAVE,
  M2_EMISOR_TOKENS: 'm1-identidad',
  M2_AUDIENCIA_TOKENS: 'm2-clientes',
};
const EJEMPLO = new URL('../../../ejemplo.env', import.meta.url);

describe('cargarConfigPanel (RNF-06.4)', () => {
  it('aplica los valores por defecto del plan y lee los tokens de M2', () => {
    expect(cargarConfigPanel(TOKENS)).toEqual({
      config: {
        puerto: 8083,
        escucha: '127.0.0.1',
        urlM2: 'http://localhost:8082',
        urlM2Publica: 'http://localhost:8082',
        urlM6Control: 'http://localhost:3007',
        urlBd: undefined,
        docker: true,
        servicioBd: 'bd',
        claveTokens: CLAVE,
        emisorTokens: 'm1-identidad',
        audienciaTokens: 'm2-clientes',
        campoRoles: 'roles',
      },
    });
  });

  it('lee las variables PANEL_* y M2_CAMPO_ROLES', () => {
    const resultado = cargarConfigPanel({
      ...TOKENS,
      PANEL_PUERTO: '9090',
      PANEL_ESCUCHA: '0.0.0.0',
      PANEL_URL_M2: 'http://m2:8082/',
      PANEL_URL_M2_PUBLICA: 'https://m2.ejemplo.test',
      PANEL_URL_M6_CONTROL: 'http://m6:3007',
      M2_CAMPO_ROLES: 'permisos',
    });

    expect(resultado.config).toMatchObject({
      puerto: 9090,
      escucha: '0.0.0.0',
      urlM2: 'http://m2:8082',
      urlM2Publica: 'https://m2.ejemplo.test',
      urlM6Control: 'http://m6:3007',
      campoRoles: 'permisos',
    });
  });

  it('una variable vacía cuenta como no definida', () => {
    expect(cargarConfigPanel({ ...TOKENS, PANEL_PUERTO: '' }).config?.puerto).toBe(8083);
  });

  it.each(['M2_CLAVE_TOKENS', 'M2_EMISOR_TOKENS', 'M2_AUDIENCIA_TOKENS'])('%s es obligatoria', (variable) => {
    const resto = Object.fromEntries(Object.entries(TOKENS).filter(([nombre]) => nombre !== variable));

    expect(cargarConfigPanel(resto).errores).toEqual([{ variable, motivo: 'es obligatoria y no tiene valor' }]);
  });

  it('rechaza una clave de menos de 32 caracteres sin repetirla en el error', () => {
    const corta = 'clave-corta-secreta';

    const resultado = cargarConfigPanel({ ...TOKENS, M2_CLAVE_TOKENS: corta });

    expect(resultado.errores).toEqual([{ variable: 'M2_CLAVE_TOKENS', motivo: 'tiene menos de 32 caracteres' }]);
    expect(JSON.stringify(resultado)).not.toContain(corta);
  });

  it.each(['0', '65536', '-1', '80.5', '8e3', ' 8083', 'abc', '0x50'])('rechaza PANEL_PUERTO=%j', (puerto) => {
    expect(cargarConfigPanel({ ...TOKENS, PANEL_PUERTO: puerto }).errores).toEqual([
      { variable: 'PANEL_PUERTO', motivo: 'no es un entero entre 1 y 65535' },
    ]);
  });

  it.each(['1', '65535'])('acepta PANEL_PUERTO=%s', (puerto) => {
    expect(cargarConfigPanel({ ...TOKENS, PANEL_PUERTO: puerto }).config?.puerto).toBe(Number(puerto));
  });

  it.each(['localhost', 'ejemplo.test', '999.1.1.1', '127.0.0.1:80'])('rechaza PANEL_ESCUCHA=%j', (escucha) => {
    expect(cargarConfigPanel({ ...TOKENS, PANEL_ESCUCHA: escucha }).errores).toEqual([
      { variable: 'PANEL_ESCUCHA', motivo: 'no es una dirección IP' },
    ]);
  });

  it('acepta una dirección IPv6', () => {
    expect(cargarConfigPanel({ ...TOKENS, PANEL_ESCUCHA: '::1' }).config?.escucha).toBe('::1');
  });

  it.each(['PANEL_URL_M2', 'PANEL_URL_M2_PUBLICA', 'PANEL_URL_M6_CONTROL'])('%s tiene que ser una URL http sin credenciales', (variable) => {
    for (const valor of ['m2:8082', 'ftp://m2', 'http://usuario:clave@m2:8082']) {
      const resultado = cargarConfigPanel({ ...TOKENS, [variable]: valor });

      expect(resultado.errores).toEqual([
        { variable, motivo: 'no es una URL http:// o https:// sin usuario ni contraseña' },
      ]);
      expect(JSON.stringify(resultado)).not.toContain('clave@');
    }
  });

  it('junta todos los errores en una sola respuesta', () => {
    const resultado = cargarConfigPanel({ M2_CLAVE_TOKENS: 'corta', PANEL_PUERTO: '0' });

    expect(resultado.errores?.map((error) => error.variable).sort()).toEqual([
      'M2_AUDIENCIA_TOKENS',
      'M2_CLAVE_TOKENS',
      'M2_EMISOR_TOKENS',
      'PANEL_PUERTO',
    ]);
  });
});

describe('cargarConfigPanel: base y Docker de la vista de demostración (spec 072, RNF-06.5, RNF-19.4)', () => {
  const URL_BD = 'postgres://m2:contrasena-secreta@127.0.0.1:5433/m2';

  it('PANEL_URL_BD vacía o ausente deja las acciones de base sin configurar', () => {
    expect(cargarConfigPanel(TOKENS).config?.urlBd).toBeUndefined();
    expect(cargarConfigPanel({ ...TOKENS, PANEL_URL_BD: '' }).config?.urlBd).toBeUndefined();
  });

  it.each([URL_BD, 'postgresql://m2:x@bd:5432/m2'])('acepta PANEL_URL_BD=%s tal cual', (url) => {
    expect(cargarConfigPanel({ ...TOKENS, PANEL_URL_BD: url }).config?.urlBd).toBe(url);
  });

  it.each(['m2:5432', 'mysql://m2:contrasena-secreta@bd/m2', 'http://m2:contrasena-secreta@bd', 'postgres://'])(
    'rechaza PANEL_URL_BD=%j sin repetir el valor en el error',
    (url) => {
      const resultado = cargarConfigPanel({ ...TOKENS, PANEL_URL_BD: url });

      expect(resultado.errores).toEqual([{ variable: 'PANEL_URL_BD', motivo: 'no es una URL postgres:// o postgresql://' }]);
      expect(JSON.stringify(resultado)).not.toContain('contrasena-secreta');
    },
  );

  it('PANEL_DOCKER es «si» por defecto y acepta «si» o «no»', () => {
    expect(cargarConfigPanel(TOKENS).config?.docker).toBe(true);
    expect(cargarConfigPanel({ ...TOKENS, PANEL_DOCKER: 'si' }).config?.docker).toBe(true);
    expect(cargarConfigPanel({ ...TOKENS, PANEL_DOCKER: 'no' }).config?.docker).toBe(false);
  });

  it.each(['sí', 'true', 'NO', '1', ' no'])('rechaza PANEL_DOCKER=%j', (valor) => {
    expect(cargarConfigPanel({ ...TOKENS, PANEL_DOCKER: valor }).errores).toEqual([
      { variable: 'PANEL_DOCKER', motivo: 'no es «si» ni «no»' },
    ]);
  });

  it('PANEL_SERVICIO_BD es «bd» por defecto y acepta nombres de servicio de compose', () => {
    expect(cargarConfigPanel(TOKENS).config?.servicioBd).toBe('bd');
    for (const nombre of ['base', 'bd-2', 'a', 'mi_bd', '0bd']) {
      expect(cargarConfigPanel({ ...TOKENS, PANEL_SERVICIO_BD: nombre }).config?.servicioBd).toBe(nombre);
    }
  });

  // El nombre llega como argumento de `docker compose stop`: nada que parezca una opción, una ruta o un comando (RNF-12.10).
  it.each(['-v', '--all', 'bd;rm', 'bd bd', '../bd', 'BD', '_bd', `a${'b'.repeat(63)}`])('rechaza PANEL_SERVICIO_BD=%j', (nombre) => {
    expect(cargarConfigPanel({ ...TOKENS, PANEL_SERVICIO_BD: nombre }).errores).toEqual([
      { variable: 'PANEL_SERVICIO_BD', motivo: 'no es un nombre de servicio válido (letras minúsculas, dígitos, «-» y «_»)' },
    ]);
  });
});

describe('cargarConfigM6 (RNF-06.4, RNF-13.5)', () => {
  const M6 = { ...TOKENS };

  it('aplica los valores por defecto del plan', () => {
    expect(cargarConfigM6(M6)).toEqual({
      config: {
        puerto: 3006,
        puertoControl: 3007,
        retardoLentoMs: 5000,
        claveTokens: CLAVE,
        emisorTokens: 'm1-identidad',
        audienciaTokens: 'm2-clientes',
        campoRoles: 'roles',
        audienciaM6: 'm6-viajes',
      },
    });
  });

  it('lee las variables M6_* y M2_AUDIENCIA_M6', () => {
    const resultado = cargarConfigM6({
      ...M6,
      M6_PUERTO: '4006',
      M6_PUERTO_CONTROL: '4007',
      M6_RETARDO_LENTO_MS: '9000',
      M2_AUDIENCIA_M6: 'viajes',
    });

    expect(resultado.config).toMatchObject({ puerto: 4006, puertoControl: 4007, retardoLentoMs: 9000, audienciaM6: 'viajes' });
  });

  it.each(['M6_PUERTO', 'M6_PUERTO_CONTROL'])('rechaza %s=0', (variable) => {
    expect(cargarConfigM6({ ...M6, [variable]: '0' }).errores).toEqual([
      { variable, motivo: 'no es un entero entre 1 y 65535' },
    ]);
  });

  it('los dos puertos tienen que ser distintos: el modo caído cierra solo el de la API', () => {
    expect(cargarConfigM6({ ...M6, M6_PUERTO: '3500', M6_PUERTO_CONTROL: '3500' }).errores).toEqual([
      { variable: 'M6_PUERTO_CONTROL', motivo: 'es igual a M6_PUERTO' },
    ]);
  });

  it.each(['0', '2147483648', 'rápido'])('rechaza M6_RETARDO_LENTO_MS=%j', (retardo) => {
    expect(cargarConfigM6({ ...M6, M6_RETARDO_LENTO_MS: retardo }).errores).toEqual([
      { variable: 'M6_RETARDO_LENTO_MS', motivo: 'no es un entero entre 1 y 2147483647' },
    ]);
  });

  // Con un retardo menor que el tiempo que M2 espera a un módulo, el modo lento no haría fallar nada y la demostración mentiría.
  it('el retardo lento tiene que superar M2_TIEMPO_MODULOS_MS', () => {
    expect(cargarConfigM6({ ...M6, M2_TIEMPO_MODULOS_MS: '6000' }).errores).toEqual([
      { variable: 'M6_RETARDO_LENTO_MS', motivo: 'no supera a M2_TIEMPO_MODULOS_MS' },
    ]);
    expect(cargarConfigM6({ ...M6, M2_TIEMPO_MODULOS_MS: '4999' }).errores).toBeUndefined();
  });

  it('rechaza una audiencia de M6 con espacios al borde', () => {
    expect(cargarConfigM6({ ...M6, M2_AUDIENCIA_M6: ' m6 ' }).errores).toEqual([
      { variable: 'M2_AUDIENCIA_M6', motivo: 'está en blanco o tiene espacios al principio o al final' },
    ]);
  });

  it('rechaza una clave de menos de 32 caracteres', () => {
    expect(cargarConfigM6({ ...M6, M2_CLAVE_TOKENS: 'corta' }).errores).toEqual([
      { variable: 'M2_CLAVE_TOKENS', motivo: 'tiene menos de 32 caracteres' },
    ]);
  });
});

describe('entorno-ejemplo: valores por defecto de ejemplo.env sin pisar el entorno (RNF-06.4)', () => {
  const texto = [
    '# comentario',
    '',
    'PANEL_PUERTO=${PANEL_PUERTO:-8083}',
    'M6_PUERTO=${M6_PUERTO:-3006}',
    'M2_CLAVE_TOKENS=${M2_CLAVE_TOKENS:-una-clave}',
    'M2_URL_BD=${M2_URL_BD:-postgres://m2:secreta@bd:5432/m2}',
    'POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-secreta}',
    'ESTO=no-tiene-la-forma',
    '',
  ].join('\r\n');

  it('toma solo las variables del panel, del M6 simulado y de los tokens', () => {
    expect(valoresDeEjemplo(texto)).toEqual({ PANEL_PUERTO: '8083', M6_PUERTO: '3006', M2_CLAVE_TOKENS: 'una-clave' });
  });

  it('no trae la base: el panel no necesita su URL ni su contraseña', () => {
    const traidas = Object.keys(valoresDeEjemplo(texto));

    expect(traidas).not.toContain('M2_URL_BD');
    expect(traidas).not.toContain('POSTGRES_PASSWORD');
  });

  it('una variable ya definida manda sobre el ejemplo, y una vacía no', () => {
    const completo = completarEntorno({ PANEL_PUERTO: '9090', M6_PUERTO: '' }, valoresDeEjemplo(texto));

    expect(completo['PANEL_PUERTO']).toBe('9090');
    expect(completo['M6_PUERTO']).toBe('3006');
    expect(completo['M2_CLAVE_TOKENS']).toBe('una-clave');
  });

  it('conserva las variables del entorno que el ejemplo no menciona', () => {
    expect(completarEntorno({ PATH: '/usr/bin' }, valoresDeEjemplo(texto))['PATH']).toBe('/usr/bin');
  });

  it('con el ejemplo.env real, el panel y el M6 simulado quedan configurados sin definir nada', () => {
    const entorno = cargarEntornoEjemplo({}, EJEMPLO);

    expect(cargarConfigPanel(entorno).errores).toBeUndefined();
    expect(cargarConfigM6(entorno).errores).toBeUndefined();
    expect(cargarConfigPanel(entorno).config).toMatchObject({ puerto: 8083, urlM2: 'http://localhost:8082' });
  });

  it('con el ejemplo.env real, trae las variables de la vista de demostración, y el puente queda para compose (spec 072)', () => {
    const valores = valoresDeEjemplo(readFileSync(EJEMPLO, 'utf8'));
    const entorno = cargarEntornoEjemplo({}, EJEMPLO);

    expect(valores).toMatchObject({ PANEL_DOCKER: 'si', PANEL_SERVICIO_BD: 'bd', PANEL_PUERTO_BD: '5433' });
    expect(valores['PANEL_URL_BD']).toBe('postgres://m2:m2-contrasena-de-desarrollo@127.0.0.1:5433/m2');
    expect(cargarConfigPanel(entorno).config).toMatchObject({
      urlBd: valores['PANEL_URL_BD'],
      docker: true,
      servicioBd: 'bd',
    });
  });

  it('con el ejemplo.env real, lo definido en el entorno manda', () => {
    const entorno = cargarEntornoEjemplo({ PANEL_PUERTO: '9090' }, EJEMPLO);

    expect(cargarConfigPanel(entorno).config?.puerto).toBe(9090);
  });

  it('nunca lee un .env: rechaza cualquier archivo que no se llame ejemplo.env, sin abrirlo', () => {
    const carpeta = mkdtempSync(join(tmpdir(), 'panel-env-'));
    try {
      const dotenv = join(carpeta, '.env');
      writeFileSync(dotenv, 'PANEL_PUERTO=${PANEL_PUERTO:-1111}\n');

      expect(() => cargarEntornoEjemplo({}, dotenv)).toThrow(/ejemplo\.env/);
      expect(() => cargarEntornoEjemplo({}, join(carpeta, 'otro.env'))).toThrow(/ejemplo\.env/);
    } finally {
      rmSync(carpeta, { recursive: true, force: true });
    }
  });
});
