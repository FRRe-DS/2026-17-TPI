import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cargarConfig } from '../../src/config.js';

// ejemplo.env es el archivo que docker compose carga por defecto (RNF-06.3). Cada línea es VARIABLE=${VARIABLE:-valor}: compose
// interpola los env_file con el entorno de quien lo corre, así que una variable definida en el entorno manda sobre el ejemplo.
const texto = readFileSync(new URL('../../ejemplo.env', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const lineas = texto.split('\n');

type Entrada = { variable: string; porDefecto: string; comentario: boolean };

const FORMA = /^([A-Z][A-Z0-9_]*)=\$\{\1:-([^}]*)\}$/;

// Una entrada por línea de variable, con si la línea anterior es un comentario.
const entradas: Entrada[] = lineas.flatMap((linea, i): Entrada[] => {
  const coincide = FORMA.exec(linea);
  return coincide ? [{ variable: coincide[1] ?? '', porDefecto: coincide[2] ?? '', comentario: (lineas[i - 1] ?? '').startsWith('#') }] : [];
});
const porDefecto = Object.fromEntries(entradas.map((entrada) => [entrada.variable, entrada.porDefecto]));

const DEL_SERVICIO = [
  'M2_URL_BD',
  'M2_PUERTO',
  'M2_CLAVE_TOKENS',
  'M2_EMISOR_TOKENS',
  'M2_AUDIENCIA_TOKENS',
  'M2_CAMPO_ROLES',
  'M2_TIEMPO_BD_MS',
  'M2_TIEMPO_MODULOS_MS',
  'M2_REINTENTOS_MODULOS',
  'M2_ENCABEZADO_CORRELACION',
  'M2_URL_M6',
  'M2_AUDIENCIA_M6',
  'M2_REINTENTAR_DESPUES_S',
];
const DE_LA_BASE = ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'];

describe('ejemplo.env (RNF-06.3)', () => {
  it('trae todas las variables del servicio y de la base, y ninguna más', () => {
    expect(entradas.map((entrada) => entrada.variable).sort()).toEqual([...DEL_SERVICIO, ...DE_LA_BASE].sort());
  });

  it('toda línea que no es comentario ni está vacía tiene la forma VARIABLE=${VARIABLE:-valor}', () => {
    const otras = lineas.filter((linea) => linea.trim() !== '' && !linea.startsWith('#') && !FORMA.test(linea));
    expect(otras).toEqual([]);
  });

  it('cada variable tiene un valor por defecto y un comentario justo arriba', () => {
    expect(entradas.filter((entrada) => entrada.porDefecto === '').map((entrada) => entrada.variable)).toEqual([]);
    expect(entradas.filter((entrada) => !entrada.comentario).map((entrada) => entrada.variable)).toEqual([]);
  });

  it('ninguna variable se repite', () => {
    const nombres = entradas.map((entrada) => entrada.variable);
    expect(nombres.filter((nombre, i) => nombres.indexOf(nombre) !== i)).toEqual([]);
  });

  it('sus valores pasan la validación del servicio', () => {
    const resultado = cargarConfig(porDefecto);
    expect(resultado.errores).toBeUndefined();
  });

  // Los valores por defecto de RNF-06.1: el ejemplo no los cambia, así que compose y el servicio sin variables coinciden.
  it('repite los valores por defecto de las variables opcionales', () => {
    expect(resultadoDe(porDefecto)).toMatchObject({
      puerto: 8082,
      campoRoles: 'roles',
      tiempoBdMs: 2000,
      tiempoModulosMs: 2000,
      reintentosModulos: 1,
      encabezadoCorrelacion: 'X-Request-Id',
      audienciaM6: 'm6-viajes',
      reintentarDespuesS: 5,
    });
  });

  // M2_URL_BD repite el usuario, la contraseña y la base de POSTGRES_*: se cambian juntos (plan, Configuración).
  it('M2_URL_BD usa el usuario, la contraseña y la base de POSTGRES_*, en el servicio bd', () => {
    const url = new URL(porDefecto['M2_URL_BD'] ?? '');
    expect(decodeURIComponent(url.username)).toBe(porDefecto['POSTGRES_USER']);
    expect(decodeURIComponent(url.password)).toBe(porDefecto['POSTGRES_PASSWORD']);
    expect(url.pathname).toBe(`/${porDefecto['POSTGRES_DB']}`);
    expect(url.hostname).toBe('bd');
    expect(url.port).toBe('5432');
  });
});

function resultadoDe(env: Record<string, string>) {
  const { config } = cargarConfig(env);
  return config;
}
