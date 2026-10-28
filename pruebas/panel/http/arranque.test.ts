import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenDeServicio } from '../../../src/auth/tokens.js';
import { arrancarM6, type M6Andando } from '../../../panel/m6-simulado/arranque.js';
import { arrancarPanel } from '../../../panel/servidor/arranque.js';
import { escucha, puertoLibre } from '../../ayudas/arranque.js';
import { capturarLogs } from '../../ayudas/logs.js';
import { CONFIG_M6 } from '../ayudas/m6.js';

// El arranque de los dos procesos del perfil `panel` (RNF-04.6): lo que hacen `node dist/servidor/main.js` y
// `node dist/m6-simulado/main.js` con las variables del entorno, sin Docker.
const TOKENS = {
  M2_CLAVE_TOKENS: 'clave-de-prueba-de-32-caracteres!',
  M2_EMISOR_TOKENS: 'm1-identidad',
  M2_AUDIENCIA_TOKENS: 'm2-clientes',
};

const carpetas: string[] = [];
const andando: { detener: () => Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(andando.splice(0).map((servicio) => servicio.detener()));
  for (const carpeta of carpetas.splice(0)) rmSync(carpeta, { recursive: true, force: true });
});

function clienteCompilado(): string {
  const carpeta = mkdtempSync(join(tmpdir(), 'panel-arranque-'));
  carpetas.push(carpeta);
  mkdirSync(join(carpeta, 'assets'));
  writeFileSync(join(carpeta, 'index.html'), '<!doctype html><title>panel</title>');
  return carpeta;
}

describe('arrancarPanel', () => {
  const entorno = async () => ({ ...TOKENS, PANEL_PUERTO: String(await puertoLibre()), PANEL_ESCUCHA: '127.0.0.1' });

  async function arrancar(env: Record<string, string | undefined>) {
    const logs = capturarLogs();
    const salir = vi.fn<(codigo: number) => void>();
    const panel = await arrancarPanel(env, salir, { flujoLog: logs.flujo, directorioCliente: clienteCompilado() });
    if (panel !== undefined) andando.push(panel);
    return { panel, salir, logs };
  }

  it('escucha en PANEL_ESCUCHA y PANEL_PUERTO y sirve la salud y el cliente', async () => {
    const env = await entorno();

    const { panel, salir } = await arrancar(env);

    expect(panel).toBeDefined();
    expect(salir).not.toHaveBeenCalled();
    const url = `http://127.0.0.1:${env.PANEL_PUERTO}`;
    expect(await (await fetch(`${url}/salud-panel`)).json()).toEqual({ estado: 'ok' });
    const raiz = await fetch(url);
    expect(raiz.status).toBe(200);
    expect(await raiz.text()).toContain('<title>panel</title>');
  });

  it('detener cierra el puerto, sale con 0 y repetirlo no hace nada más', async () => {
    const env = await entorno();
    const { panel, salir } = await arrancar(env);

    await panel?.detener();
    await panel?.detener();

    expect(await escucha(Number(env.PANEL_PUERTO))).toBe(false);
    expect(salir).toHaveBeenCalledTimes(1);
    expect(salir).toHaveBeenCalledWith(0);
  });

  it('una configuración inválida sale con 1, nombra cada variable y no repite su valor', async () => {
    const { panel, salir, logs } = await arrancar({ ...TOKENS, M2_CLAVE_TOKENS: 'secreto-corto', PANEL_PUERTO: 'no-es-un-puerto' });

    expect(panel).toBeUndefined();
    expect(salir).toHaveBeenCalledWith(1);
    const variables = logs.lineas().map((l) => l['variable']);
    expect(variables.sort()).toEqual(['M2_CLAVE_TOKENS', 'PANEL_PUERTO']);
    expect(logs.texto()).not.toContain('secreto-corto');
    expect(logs.texto()).not.toContain('no-es-un-puerto');
  });

  it('sin las variables obligatorias de los tokens, sale con 1', async () => {
    const { panel, salir, logs } = await arrancar({});

    expect(panel).toBeUndefined();
    expect(salir).toHaveBeenCalledWith(1);
    expect(logs.lineas().map((l) => l['variable']).sort()).toEqual(['M2_AUDIENCIA_TOKENS', 'M2_CLAVE_TOKENS', 'M2_EMISOR_TOKENS']);
  });

  it('si el puerto está ocupado, sale con 1 y lo registra sin dejar nada abierto', async () => {
    const env = await entorno();
    const primero = await arrancar(env);

    const segundo = await arrancar(env);

    expect(primero.panel).toBeDefined();
    expect(segundo.panel).toBeUndefined();
    expect(segundo.salir).toHaveBeenCalledWith(1);
    expect(segundo.logs.lineas().some((l) => l.level === 50 && l.msg === 'El panel no pudo arrancar')).toBe(true);
  });
});

describe('arrancarM6', () => {
  const entorno = async () => ({
    ...TOKENS,
    M2_AUDIENCIA_M6: CONFIG_M6.audienciaM6,
    M6_PUERTO: String(await puertoLibre()),
    M6_PUERTO_CONTROL: String(await puertoLibre()),
  });

  async function arrancar(env: Record<string, string | undefined>) {
    const logs = capturarLogs();
    const salir = vi.fn<(codigo: number) => void>();
    const m6: M6Andando | undefined = await arrancarM6(env, salir, { flujoLog: logs.flujo });
    if (m6 !== undefined) andando.push(m6);
    return { m6, salir, logs };
  }
  const configDe = (env: Record<string, string>) => ({
    ...CONFIG_M6,
    claveTokens: TOKENS.M2_CLAVE_TOKENS,
    emisorTokens: TOKENS.M2_EMISOR_TOKENS,
    puerto: Number(env.M6_PUERTO),
  });

  it('abre la API y el canal de control, cada uno en su puerto', async () => {
    const env = await entorno();

    const { m6, salir } = await arrancar(env);

    expect(m6).toBeDefined();
    expect(salir).not.toHaveBeenCalled();
    const control = `http://127.0.0.1:${env.M6_PUERTO_CONTROL}`;
    expect(await (await fetch(`${control}/control/estado`)).json()).toMatchObject({ modo: 'normal' });
    const token = await tokenDeServicio(configDe(env));
    const api = await fetch(`http://127.0.0.1:${env.M6_PUERTO}/api/v1/trips/3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b`, { headers: { authorization: `Bearer ${token}` } });
    expect(api.status).toBe(404);
  });

  it('el modo caído cierra solo la API y el canal sigue respondiendo (y vuelve a abrirla)', async () => {
    const env = await entorno();
    await arrancar(env);
    const control = `http://127.0.0.1:${env.M6_PUERTO_CONTROL}`;
    const modo = (valor: string) =>
      fetch(`${control}/control/modo`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modo: valor }) });

    expect((await modo('caido')).status).toBe(200);
    expect(await escucha(Number(env.M6_PUERTO))).toBe(false);
    expect(await escucha(Number(env.M6_PUERTO_CONTROL))).toBe(true);
    expect((await modo('normal')).status).toBe(200);
    expect(await escucha(Number(env.M6_PUERTO))).toBe(true);
  });

  it('detener cierra los dos puertos y sale con 0, también si estaba caído', async () => {
    const env = await entorno();
    const { m6, salir } = await arrancar(env);
    await fetch(`http://127.0.0.1:${env.M6_PUERTO_CONTROL}/control/modo`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modo: 'caido' }),
    });

    await m6?.detener();

    expect(await escucha(Number(env.M6_PUERTO))).toBe(false);
    expect(await escucha(Number(env.M6_PUERTO_CONTROL))).toBe(false);
    expect(salir).toHaveBeenCalledWith(0);
  });

  it('una configuración inválida sale con 1 (por ejemplo, los dos puertos iguales) y no repite valores', async () => {
    const { m6, salir, logs } = await arrancar({ ...TOKENS, M2_CLAVE_TOKENS: 'secreto-corto', M6_PUERTO: '4000', M6_PUERTO_CONTROL: '4000' });

    expect(m6).toBeUndefined();
    expect(salir).toHaveBeenCalledWith(1);
    expect(logs.lineas().map((l) => l['variable']).sort()).toEqual(['M2_CLAVE_TOKENS', 'M6_PUERTO_CONTROL']);
    expect(logs.texto()).not.toContain('secreto-corto');
  });

  it.each([
    ['el de la API', 'M6_PUERTO', 'M6_PUERTO_CONTROL'],
    ['el del canal de control', 'M6_PUERTO_CONTROL', 'M6_PUERTO'],
  ] as const)('si %s está ocupado, sale con 1 y no deja abierto el otro', async (_nombre, ocupada, otra) => {
    const env = await entorno();
    const primero = await arrancar(env);
    const libre = String(await puertoLibre());

    const segundo = await arrancar({ ...env, [otra]: libre });

    expect(primero.m6).toBeDefined();
    expect(segundo.m6).toBeUndefined();
    expect(segundo.salir).toHaveBeenCalledWith(1);
    expect(segundo.logs.lineas().some((l) => l.level === 50 && l.msg === 'El M6 simulado no pudo arrancar')).toBe(true);
    expect(await escucha(Number(libre))).toBe(false);
    expect(await escucha(Number(env[ocupada]))).toBe(true);
  });
});
