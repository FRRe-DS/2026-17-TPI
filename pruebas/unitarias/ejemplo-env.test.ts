import { existsSync, readFileSync } from 'node:fs';
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
  'M2_MODO_TOKENS',
  'M2_URL_JWKS',
];
const DE_LA_BASE = ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'];
// Specs 071 y 072: las del panel y las del M6 simulado. Las lee panel/servidor/config.ts, no el servicio (PANEL_PUERTO_BD, solo compose).
const DEL_PANEL = [
  'PANEL_PUERTO',
  'PANEL_ESCUCHA',
  'PANEL_URL_M2',
  'PANEL_URL_M2_PUBLICA',
  'PANEL_URL_M6_CONTROL',
  'PANEL_URL_BD',
  'PANEL_PUERTO_BD',
  'PANEL_DOCKER',
  'PANEL_SERVICIO_BD',
  'M6_PUERTO',
  'M6_PUERTO_CONTROL',
  'M6_RETARDO_LENTO_MS',
];

describe('ejemplo.env (RNF-06.3)', () => {
  it('trae todas las variables del servicio, de la base y del panel, y ninguna más', () => {
    expect(entradas.map((entrada) => entrada.variable).sort()).toEqual([...DEL_SERVICIO, ...DE_LA_BASE, ...DEL_PANEL].sort());
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
      modoTokens: 'hs256',
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

// ejemplo-keycloak.env (spec 080, RNF-06.7, RNF-06.8): lo que cambia para levantar M2 en modo jwks con un solo comando,
// `docker compose --env-file ejemplo-keycloak.env up -d --build --wait`. Compose lo carga como su propio entorno, así que activa el
// perfil y sus valores llegan a ejemplo.env por la interpolación.
const URL_KEYCLOAK = new URL('../../ejemplo-keycloak.env', import.meta.url);
const textoKeycloak = existsSync(URL_KEYCLOAK) ? readFileSync(URL_KEYCLOAK, 'utf8').replaceAll('\r\n', '\n') : '';
const lineasKeycloak = textoKeycloak.split('\n');
const DE_KEYCLOAK = /^([A-Z][A-Z0-9_]*)=(.*)$/;
const valoresKeycloak = Object.fromEntries(
  lineasKeycloak.flatMap((linea) => {
    const coincide = DE_KEYCLOAK.exec(linea);
    return coincide ? [[coincide[1] ?? '', coincide[2] ?? '']] : [];
  }),
);
const textoComposeKeycloak = readFileSync(new URL('../../docker-compose.yml', import.meta.url), 'utf8');

// Lo que haría compose con el puerto por defecto: resuelve ${KEYCLOAK_PUERTO:-8080}.
function conPuerto(valor: string, puerto = '8080'): string {
  return valor.replaceAll('${KEYCLOAK_PUERTO:-8080}', puerto);
}

describe('ejemplo-keycloak.env (spec 080, RNF-06.7, RNF-06.8)', () => {
  it('existe y trae solo el perfil, el modo y el emisor', () => {
    expect(existsSync(URL_KEYCLOAK)).toBe(true);
    expect(valoresKeycloak).toEqual({
      COMPOSE_PROFILES: 'keycloak',
      M2_MODO_TOKENS: 'jwks',
      M2_EMISOR_TOKENS: 'http://localhost:${KEYCLOAK_PUERTO:-8080}/realms/ds-2026-realm',
    });
  });

  it('toda línea es un comentario, está vacía o es VARIABLE=valor, y cada variable tiene un comentario justo arriba', () => {
    expect(lineasKeycloak.filter((linea) => linea.trim() !== '' && !linea.startsWith('#') && !DE_KEYCLOAK.test(linea))).toEqual([]);
    const sinComentario = lineasKeycloak.filter((linea, i) => DE_KEYCLOAK.test(linea) && !(lineasKeycloak[i - 1] ?? '').startsWith('#'));
    expect(sinComentario).toEqual([]);
  });

  it('las variables de M2 que cambia están en ejemplo.env, para que la interpolación las lleve al servicio', () => {
    for (const variable of Object.keys(valoresKeycloak).filter((nombre) => nombre.startsWith('M2_'))) {
      expect(porDefecto, variable).toHaveProperty(variable);
    }
  });

  // Un emisor distinto del KC_HOSTNAME daría 401 en todos los tokens (plan, Decisiones): los dos salen de KEYCLOAK_PUERTO.
  it('el emisor es KC_HOSTNAME del compose más el realm, con el mismo KEYCLOAK_PUERTO', () => {
    const hostname = /KC_HOSTNAME: (\S+)/.exec(textoComposeKeycloak)?.[1] ?? '';
    expect(hostname).toBe('http://localhost:${KEYCLOAK_PUERTO:-8080}');
    expect(valoresKeycloak['M2_EMISOR_TOKENS']).toBe(`${hostname}/realms/ds-2026-realm`);
  });

  it('el emisor y las claves de ejemplo.env nombran el mismo realm, el que se importa', () => {
    const realm = (JSON.parse(readFileSync(new URL('../../keycloak/ds-2026-realm-realm.json', import.meta.url), 'utf8')) as { realm: string }).realm;
    expect(new URL(conPuerto(valoresKeycloak['M2_EMISOR_TOKENS'] ?? '')).pathname).toBe(`/realms/${realm}`);
    expect(new URL(porDefecto['M2_URL_JWKS'] ?? '').pathname).toBe(`/realms/${realm}/protocol/openid-connect/certs`);
  });

  it('con sus valores sobre los de ejemplo.env, el servicio arranca en modo jwks con el emisor de Keycloak', () => {
    const env = { ...porDefecto, M2_MODO_TOKENS: valoresKeycloak['M2_MODO_TOKENS'] ?? '', M2_EMISOR_TOKENS: conPuerto(valoresKeycloak['M2_EMISOR_TOKENS'] ?? '') };
    const { config, errores } = cargarConfig(env);
    expect(errores).toBeUndefined();
    expect(config).toMatchObject({ modoTokens: 'jwks', emisorTokens: 'http://localhost:8080/realms/ds-2026-realm', audienciaTokens: 'm2-clientes' });
  });
});

function resultadoDe(env: Record<string, string>) {
  const { config } = cargarConfig(env);
  return config;
}
