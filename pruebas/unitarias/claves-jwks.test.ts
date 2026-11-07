import { errors } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearClaves } from '../../src/auth/claves-jwks.js';
import { crearVerificador } from '../../src/auth/tokens.js';
import { ModuloNoDisponible, NoAutenticado, Problema } from '../../src/errores.js';
import { armarTokenRsa, crearClave, jwksDe } from '../ayudas/jwks.js';
import { crearServidorModulo, type Comportamiento } from '../ayudas/servidor-modulo.js';
import { armarToken, CONFIG_TOKENS, SUB_DE_PRUEBA } from '../ayudas/tokens.js';

// Qué pasa cuando Keycloak no entrega las claves (RNF-13.10, RNF-07.12). Las mismas reglas que con M6: cada intento tiene su
// tiempo máximo y entre uno y otro hay una pausa.
const servidor = crearServidorModulo();
const clave = crearClave();
const JWKS = jwksDe(clave);
const CABECERA = { alg: 'RS256', kid: clave.kid };

const TIEMPO_MS = 150;
const PAUSA_MS = 200;
const RETRY_AFTER_S = 7;
const MARGEN_MS = 150;

const config = (cambios: { reintentosModulos?: number; tiempoModulosMs?: number } = {}) => ({
  urlJwks: `${servidor.url}/certs`,
  tiempoModulosMs: TIEMPO_MS,
  reintentosModulos: 1,
  reintentarDespuesS: RETRY_AFTER_S,
  ...cambios,
});

const claves = (cambios?: Parameters<typeof config>[0]) => crearClaves(config(cambios));
const verificador = () => crearVerificador({ ...CONFIG_TOKENS, modoTokens: 'jwks', ...config() });

// Lo que falló, sin que la prueba pueda confundir un rechazo con una clave devuelta.
const fallaDe = (resultado: Promise<unknown>) =>
  resultado.then(
    () => {
      throw new Error('Se esperaba que fallara');
    },
    (error: unknown) => error,
  );

// Las formas en que Keycloak puede no entregar las claves, sin colgarse.
const CAIDAS: [string, Comportamiento][] = [
  ['responde 500', { tipo: '5xx', estado: 500 }],
  ['responde 503', { tipo: '5xx', estado: 503 }],
  ['responde 404', { tipo: '4xx', estado: 404 }],
  ['redirige', { tipo: 'ok', estado: 302, encabezados: { Location: 'http://127.0.0.1:1/certs' } }],
  ['corta la conexión', { tipo: 'corta' }],
  ['responde algo que no es JSON', { tipo: 'no-json', contenido: 'dato-del-cuerpo' }],
  ['responde un JSON sin keys', { tipo: 'ok', cuerpo: { dato: 'dato-del-cuerpo' } }],
  ['responde keys que no es una lista', { tipo: 'ok', cuerpo: { keys: 'dato-del-cuerpo' } }],
];

beforeAll(async () => {
  await servidor.levantar();
});

afterAll(async () => {
  await servidor.cerrar();
});

beforeEach(() => {
  servidor.responderCon({ tipo: 'ok', cuerpo: JWKS });
});

describe('claves: un JWKS que no entrega las claves da ModuloNoDisponible (RNF-13.10)', () => {
  it.each(CAIDAS)('si %s', async (_caso, caida) => {
    servidor.responderCon(caida);
    const error = await fallaDe(claves().clave(CABECERA));

    expect(error).toBeInstanceOf(ModuloNoDisponible);
    const { codigo, type, detail, encabezados, cause } = error as ModuloNoDisponible;
    expect({ codigo, type, detail, encabezados }).toEqual({
      codigo: 503,
      type: 'about:blank',
      detail: 'El servicio de identidad no está disponible',
      encabezados: { 'Retry-After': String(RETRY_AFTER_S) },
    });
    // La causa va al log (RNF-14.8) y no copia nada del cuerpo que respondió el otro (RNF-19.2).
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).not.toContain('dato-del-cuerpo');
    expect(servidor.llamadas).toBe(2);
  });

  it('si responde un documento vacío, no es un corte: las claves llegaron y el kid no está', async () => {
    servidor.responderCon({ tipo: 'ok', cuerpo: { keys: [] } });
    await expect(claves().clave(CABECERA)).rejects.toBeInstanceOf(errors.JWKSNoMatchingKey);
    expect(servidor.llamadas).toBe(1);
  });

  it('la causa es lo que falló en el último intento', async () => {
    servidor.responderCon([{ tipo: 'corta' }, { tipo: '5xx', estado: 500 }]);
    const { cause } = (await fallaDe(claves().clave(CABECERA))) as ModuloNoDisponible;
    expect((cause as Error).message).toContain('200 OK');
  });

  it('si el primer intento falla y el segundo anda, devuelve la clave', async () => {
    servidor.responderCon([{ tipo: '5xx', estado: 500 }, { tipo: 'ok', cuerpo: JWKS }]);
    await expect(claves().clave(CABECERA)).resolves.toBeDefined();
    expect(servidor.llamadas).toBe(2);
  });

  it('un JWKS que anda se pide una sola vez', async () => {
    await expect(claves().clave(CABECERA)).resolves.toBeDefined();
    expect(servidor.llamadas).toBe(1);
  });

  it('un kid que no está no es un corte: no se reintenta', async () => {
    await expect(claves().clave({ alg: 'RS256', kid: 'otro' })).rejects.toBeInstanceOf(errors.JWKSNoMatchingKey);
    expect(servidor.llamadas).toBe(1);
  });

  it('tampoco se reintenta si no se sabe cuál clave usar', async () => {
    servidor.responderCon({ tipo: 'ok', cuerpo: jwksDe(clave, crearClave('otra')) });
    await expect(claves().clave({ alg: 'RS256' })).rejects.toBeInstanceOf(errors.JWKSMultipleMatchingKeys);
    expect(servidor.llamadas).toBe(1);
  });
});

describe('claves: tiempo máximo y reintentos (RNF-13.10)', () => {
  it.each<[string, Comportamiento]>([
    ['sin responder', { tipo: 'cuelga' }],
    ['con los encabezados, pero sin el cuerpo', { tipo: 'demora-cuerpo', retardoMs: TIEMPO_MS * 10, cuerpo: JWKS }],
  ])('un JWKS colgado %s corta en tiempoModulosMs por intento', async (_caso, cuelga) => {
    servidor.responderCon(cuelga);
    const inicio = Date.now();
    const error = await fallaDe(claves({ reintentosModulos: 2 }).clave(CABECERA));
    const tardo = Date.now() - inicio;

    expect(error).toBeInstanceOf(ModuloNoDisponible);
    expect(servidor.llamadas).toBe(3);
    // Tres intentos enteros y dos pausas.
    const esperado = 3 * TIEMPO_MS + 2 * PAUSA_MS;
    expect(tardo).toBeGreaterThanOrEqual(esperado - 50);
    expect(tardo).toBeLessThan(esperado + 3 * MARGEN_MS);
  });

  it.each([0, 1, 3])('con %i reintentos hace 1 + reintentos intentos', async (reintentosModulos) => {
    servidor.responderCon({ tipo: '5xx', estado: 500 });
    await expect(claves({ reintentosModulos }).clave(CABECERA)).rejects.toBeInstanceOf(ModuloNoDisponible);
    expect(servidor.llamadas).toBe(1 + reintentosModulos);
  });

  it('entre un intento y el siguiente hay 200 ms de pausa', async () => {
    servidor.responderCon({ tipo: '5xx', estado: 500 });
    await expect(claves().clave(CABECERA)).rejects.toBeInstanceOf(ModuloNoDisponible);
    const [primera, segunda] = servidor.momentos as [number, number];
    expect(segunda - primera).toBeGreaterThanOrEqual(PAUSA_MS - 20);
    expect(segunda - primera).toBeLessThan(PAUSA_MS + MARGEN_MS);
  });

  it('después del último intento no hay pausa', async () => {
    servidor.responderCon({ tipo: '5xx', estado: 500 });
    const inicio = Date.now();
    await expect(claves().clave(CABECERA)).rejects.toBeInstanceOf(ModuloNoDisponible);
    // Con otra pausa al final tardaría 400 ms o más.
    expect(Date.now() - inicio).toBeLessThan(2 * PAUSA_MS);
  });
});

describe('claves: solicitudes juntas sin claves (spec, Casos límite)', () => {
  const diez = (pedir: () => Promise<unknown>) => Promise.allSettled(Array.from({ length: 10 }, pedir));

  it.each<[string, Comportamiento]>([
    ['un 5xx', { tipo: '5xx', estado: 500 }],
    ['un JWKS colgado', { tipo: 'cuelga' }],
  ])('con %s hacen un solo pedido por intento', async (_caso, caida) => {
    servidor.responderCon(caida);
    const { clave: pedir } = claves();
    const resultados = await diez(() => pedir(CABECERA));

    expect(servidor.llamadas).toBe(2);
    for (const resultado of resultados) {
      expect(resultado).toMatchObject({ status: 'rejected', reason: expect.any(ModuloNoDisponible) as unknown });
    }
  });

  it('con un JWKS que anda hacen un solo pedido, y todas reciben la clave', async () => {
    const { clave: pedir } = claves();
    const resultados = await diez(() => pedir(CABECERA));

    expect(servidor.llamadas).toBe(1);
    for (const resultado of resultados) expect(resultado.status).toBe('fulfilled');
  });
});

describe('precargar: trae las claves sin lanzar nunca (RNF-13.9, RNF-13.12)', () => {
  it('con un JWKS que anda no hay motivo, y la clave ya no se pide', async () => {
    const claveros = claves();
    await expect(claveros.precargar()).resolves.toBeUndefined();
    expect(servidor.llamadas).toBe(1);

    await expect(claveros.clave(CABECERA)).resolves.toBeDefined();
    expect(servidor.llamadas).toBe(1);
  });

  it.each(CAIDAS)('si %s, devuelve el motivo tras los mismos intentos', async (_caso, caida) => {
    servidor.responderCon(caida);
    const motivo = await claves().precargar();

    expect(motivo).toEqual(expect.any(String));
    expect(motivo).not.toBe('');
    expect(motivo).not.toContain('dato-del-cuerpo');
    expect(servidor.llamadas).toBe(2);
  });

  it('con un JWKS colgado también corta, y el motivo dice que se agotó el tiempo', async () => {
    servidor.responderCon({ tipo: 'cuelga' });
    await expect(claves({ reintentosModulos: 0 }).precargar()).resolves.toMatch(/timed out/);
    expect(servidor.llamadas).toBe(1);
  });

  it('con la conexión cortada el motivo dice por qué, no solo «fetch failed»', async () => {
    servidor.responderCon({ tipo: 'corta' });
    const motivo = await claves({ reintentosModulos: 0 }).precargar();
    expect(motivo).toMatch(/^fetch failed: .+/);
  });

  it('si el primer intento falla y el segundo anda, no hay motivo', async () => {
    servidor.responderCon([{ tipo: '5xx', estado: 500 }, { tipo: 'ok', cuerpo: JWKS }]);
    await expect(claves().precargar()).resolves.toBeUndefined();
    expect(servidor.llamadas).toBe(2);
  });

  it('si falló, las claves llegan con el primer token', async () => {
    servidor.responderCon([{ tipo: '5xx', estado: 500 }, { tipo: '5xx', estado: 500 }, { tipo: 'ok', cuerpo: JWKS }]);
    const claveros = claves();
    await expect(claveros.precargar()).resolves.toEqual(expect.any(String));
    await expect(claveros.clave(CABECERA)).resolves.toBeDefined();
    expect(servidor.llamadas).toBe(3);
  });
});

// Lo mismo visto desde quien valida: un corte es un 503 y no un 401, porque el token puede ser válido (RNF-13.10).
describe('verificador: Keycloak caído y sin claves', () => {
  it.each<[string, Comportamiento]>([...CAIDAS, ['se cuelga', { tipo: 'cuelga' }]])('si %s da 503', async (_caso, caida) => {
    servidor.responderCon(caida);
    const error = await fallaDe(verificador().verificar(`Bearer ${armarTokenRsa(clave)}`));

    expect(error).toBeInstanceOf(ModuloNoDisponible);
    expect(error).not.toBeInstanceOf(NoAutenticado);
    expect(error).toBeInstanceOf(Problema);
    expect((error as ModuloNoDisponible).codigo).toBe(503);
  });

  it('cuando vuelve, ese mismo verificador acepta el token sin reiniciar', async () => {
    servidor.responderCon([{ tipo: '5xx', estado: 500 }, { tipo: '5xx', estado: 500 }, { tipo: 'ok', cuerpo: JWKS }]);
    const unVerificador = verificador();
    await expect(unVerificador.verificar(`Bearer ${armarTokenRsa(clave)}`)).rejects.toBeInstanceOf(ModuloNoDisponible);
    await expect(unVerificador.verificar(`Bearer ${armarTokenRsa(clave)}`)).resolves.toMatchObject({ sub: SUB_DE_PRUEBA });
  });

  it('un token con otro algoritmo da 401 y no 503: para rechazarlo no hace falta ninguna clave', async () => {
    servidor.responderCon({ tipo: '5xx', estado: 500 });
    await expect(verificador().verificar(`Bearer ${armarToken()}`)).rejects.toBeInstanceOf(NoAutenticado);
    expect(servidor.llamadas).toBe(0);
  });
});
