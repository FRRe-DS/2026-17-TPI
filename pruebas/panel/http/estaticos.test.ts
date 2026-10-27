import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PANTALLAS } from '../../../panel/cliente/src/rutas.js';
import { construirApp } from '../../../panel/servidor/app.js';
import { RUTAS_DEL_CLIENTE } from '../../../panel/servidor/estaticos.js';
import { descartarLogs } from '../../ayudas/logs.js';
import { escuchar, leerRespuesta, porSocket } from '../../ayudas/socket.js';
import { CONFIG_PANEL, DESDE_EL_PANEL, PUERTO_PANEL } from '../ayudas/app.js';

// El cliente se compila de verdad (con la configuración de Vite del repo) en una carpeta temporal y el servidor lo sirve de
// ahí: lo que se prueba es el `index.html` que sale de Vite, no uno escrito a mano.
const ID = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const PROBLEMA = 'application/problem+json';
let carpeta: string;
let indexHtml: string;

beforeAll(async () => {
  carpeta = mkdtempSync(join(tmpdir(), 'panel-cliente-'));
  await build({ configFile: new URL('../../../panel/vite.config.ts', import.meta.url).pathname, logLevel: 'silent', build: { outDir: carpeta } });
  indexHtml = readFileSync(join(carpeta, 'index.html'), 'utf8');
  // Un archivo de un tipo que se sirve, justo afuera de /assets/: si una ruta pudiera subir un nivel, lo encontraría.
  writeFileSync(join(carpeta, 'secreto.js'), 'export const secreto = 1;');
}, 60_000);
afterAll(() => rmSync(carpeta, { recursive: true, force: true }));

const abiertas: ReturnType<typeof construirApp>[] = [];
function panel(directorioCliente: string | undefined = carpeta) {
  const app = construirApp({ config: CONFIG_PANEL, flujoLog: descartarLogs, directorioCliente });
  abiertas.push(app);
  return app;
}
afterEach(async () => {
  await Promise.all(abiertas.splice(0).map((app) => app.close()));
});
const pedir = (url: string, headers: Record<string, string> = DESDE_EL_PANEL) => panel().inject({ method: 'GET', url, headers });

describe('el index.html que compila Vite (RNF-19.3)', () => {
  it('no tiene scripts ni estilos en línea, ni atributos de eventos ni de estilo', () => {
    const scripts = [...indexHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, atributos, contenido] of scripts) {
      expect(atributos).toMatch(/\bsrc="\/assets\/[^"]+"/);
      expect((contenido ?? '').trim()).toBe('');
    }
    expect(indexHtml).not.toMatch(/<style\b/i);
    expect(indexHtml).not.toMatch(/\sstyle\s*=/i);
    expect(indexHtml).not.toMatch(/\son[a-z]+\s*=/i);
    expect(indexHtml).not.toMatch(/javascript:/i);
  });

  it('no trae nada de terceros ni datos incrustados: todo lo que carga es de /assets/', () => {
    const direcciones = [...indexHtml.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    expect(direcciones.length).toBeGreaterThan(0);
    for (const direccion of direcciones) expect(direccion, direccion).toMatch(/^\/assets\//);
  });

  it('declara el idioma, la codificación y la vista adaptable (RNF-15.1)', () => {
    expect(indexHtml).toMatch(/<html[^>]*\slang="es"/i);
    expect(indexHtml).toMatch(/<meta\s+charset="utf-8"/i);
    expect(indexHtml).toMatch(/<meta\s+name="viewport"\s+content="width=device-width, initial-scale=1"/i);
  });
});

describe('GET / (RNF-04.6, RNF-19.3)', () => {
  it('sirve el index.html con la política de seguridad, nosniff y Referrer-Policy', async () => {
    const respuesta = await pedir('/');

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(respuesta.body).toBe(indexHtml);
    expect(respuesta.headers['content-security-policy']).toContain("default-src 'self'");
    expect(respuesta.headers['x-content-type-options']).toBe('nosniff');
    expect(respuesta.headers['referrer-policy']).toBe('no-referrer');
    expect(respuesta.headers['cache-control']).toBe('no-cache');
  });

  it('la política no permite scripts ni estilos en línea, ni eval, ni embeber el panel, ni cambiar la base', async () => {
    const politica = (await pedir('/')).headers['content-security-policy'] as string;

    expect(politica).not.toMatch(/unsafe-inline|unsafe-eval|data:|blob:|https?:|\*/);
    expect(politica).toContain("frame-ancestors 'none'");
    expect(politica).toContain("object-src 'none'");
    expect(politica).toContain("base-uri 'none'");
    expect(politica).toContain("form-action 'self'");
  });

  it('los mismos encabezados salen en el resto de las respuestas del panel', async () => {
    const salud = await pedir('/salud-panel');
    const noExiste = await pedir('/no-existe');

    for (const respuesta of [salud, noExiste]) {
      expect(respuesta.headers['content-security-policy']).toContain("default-src 'self'");
      expect(respuesta.headers['x-content-type-options']).toBe('nosniff');
      expect(respuesta.headers['referrer-policy']).toBe('no-referrer');
    }
  });

  it('un Host ajeno sigue dando 403: la seguridad del panel va antes que los archivos', async () => {
    const respuesta = await pedir('/', { host: 'evil.test' });

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.body).not.toContain('<script');
  });

  it('sin carpeta del cliente, no sirve nada y / es un 404 del panel', async () => {
    const app = construirApp({ config: CONFIG_PANEL, flujoLog: descartarLogs });
    abiertas.push(app);

    const respuesta = await app.inject({ method: 'GET', url: '/', headers: DESDE_EL_PANEL });

    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.headers['content-type']).toContain(PROBLEMA);
  });

  it('si la carpeta no tiene index.html, / da 404 y no un error del servidor', async () => {
    const respuesta = await panel(join(carpeta, 'no-existe')).inject({ method: 'GET', url: '/', headers: DESDE_EL_PANEL });

    expect(respuesta.statusCode).toBe(404);
  });
});

describe('/assets/ (lo que referencia el index.html)', () => {
  it('cada script, hoja de estilos e ícono que carga el index.html se sirve con su tipo, nosniff y caché larga', async () => {
    const archivos = [...indexHtml.matchAll(/\b(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1] as string);
    const tipo = (archivo: string) =>
      archivo.endsWith('.css') ? 'text/css; charset=utf-8' : archivo.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript; charset=utf-8';

    expect(archivos.some((archivo) => archivo.endsWith('.svg'))).toBe(true);
    for (const archivo of archivos) {
      const respuesta = await pedir(archivo);
      expect(respuesta.statusCode, archivo).toBe(200);
      expect(respuesta.headers['content-type'], archivo).toBe(tipo(archivo));
      expect(respuesta.headers['x-content-type-options']).toBe('nosniff');
      expect(respuesta.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(respuesta.rawPayload.equals(readFileSync(join(carpeta, archivo)))).toBe(true);
    }
  });

  it.each([
    ['uno que no existe', '/assets/no-existe.js'],
    ['la carpeta', '/assets/'],
    ['sin nombre', '/assets'],
    ['un archivo oculto', '/assets/.env'],
    ['una subcarpeta', '/assets/sub/otro.js'],
    ['subir con ..', '/assets/..%2Findex.html'],
    ['subir con .. a un archivo que existe', '/assets/..%2Fsecreto.js'],
    ['subir con %2e%2e a un archivo que existe', '/assets/%2e%2e%2Fsecreto.js'],
    ['subir con %2e%2e', '/assets/%2e%2e/index.html'],
    ['una barra invertida', '/assets/..%5Cindex.html'],
    ['un nombre con espacios', '/assets/a%20b.js'],
    ['un byte nulo', '/assets/a%00.js'],
  ])('%s: 404', async (_nombre, url) => {
    const respuesta = await pedir(url);

    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.headers['content-type']).toContain(PROBLEMA);
  });

  it('subir con .. sin codificar tampoco sale de la carpeta (por socket, que inject normaliza)', async () => {
    const puerto = await escuchar(panel());

    for (const ruta of ['/assets/../index.html', '/assets/../secreto.js', '/assets/./../secreto.js', '/assets/sub/../../secreto.js']) {
      const cruda = await porSocket(puerto, `GET ${ruta} HTTP/1.1\r\nHost: 127.0.0.1:${PUERTO_PANEL}\r\nConnection: close\r\n\r\n`);
      const { estado, resto } = leerRespuesta(cruda);
      expect(estado, ruta).toContain(' 404 ');
      expect(resto, ruta).not.toContain('<script');
      expect(resto, ruta).not.toContain('secreto = 1');
    }
  });

  it('solo se piden con GET', async () => {
    const archivo = (indexHtml.match(/\b(?:src|href)="(\/assets\/[^"]+)"/) as RegExpMatchArray)[1] as string;

    const respuesta = await panel().inject({ method: 'POST', url: archivo, headers: { ...DESDE_EL_PANEL, origin: `http://127.0.0.1:${PUERTO_PANEL}` } });

    expect(respuesta.statusCode).toBe(404);
  });
});

describe('las rutas del cliente devuelven el index.html', () => {
  it('la lista del servidor es la de las pantallas del cliente', () => {
    expect([...RUTAS_DEL_CLIENTE].sort()).toEqual([...PANTALLAS].sort());
  });

  it.each([...PANTALLAS])('/%s', async (pantalla) => {
    const respuesta = await pedir(`/${pantalla}`);

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body).toBe(indexHtml);
    expect(respuesta.headers['content-security-policy']).toContain("default-src 'self'");
  });

  it('con un id detrás (/calificar/{id})', async () => {
    expect((await pedir(`/calificar/${ID}`)).body).toBe(indexHtml);
  });

  it.each([
    ['una pantalla que no existe', '/nada'],
    ['mucho camino', `/perfil/${ID}/otra/cosa`],
    ['index.html', '/index.html'],
    ['una ruta de M2 sin reenvío (no la sirve el cliente)', '/panel/otra'],
  ])('%s: 404 del panel', async (_nombre, url) => {
    const respuesta = await pedir(url);

    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.headers['content-type']).toContain(PROBLEMA);
  });
});
