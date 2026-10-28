import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { arrancarM6, type M6Andando } from '../../../panel/m6-simulado/arranque.js';
import { arrancarPanel, type PanelAndando } from '../../../panel/servidor/arranque.js';
import { puertoLibre } from '../../ayudas/arranque.js';
import { descartarLogs } from '../../ayudas/logs.js';
import { crearServidorModulo } from '../../ayudas/servidor-modulo.js';
import { CONFIG_M6 } from '../ayudas/m6.js';

// El script de humo (T13) se corre como lo corre la persona: `node scripts/panel-humo.mjs --panel <url>`, contra un panel de
// verdad que escucha en un puerto, con un M2 de mentira y el canal de control del M6 simulado real.
const SCRIPT = fileURLToPath(new URL('../../../scripts/panel-humo.mjs', import.meta.url));
const ejecutar = promisify(execFile);

const TOKENS = {
  M2_CLAVE_TOKENS: 'clave-de-prueba-de-32-caracteres!',
  M2_EMISOR_TOKENS: 'm1-identidad',
  M2_AUDIENCIA_TOKENS: 'm2-clientes',
};

const m2 = crearServidorModulo();
let m6: M6Andando;
let puertoControl: number;
beforeAll(async () => {
  await m2.levantar();
  puertoControl = await puertoLibre();
  m6 = (await arrancarM6(
    { ...TOKENS, M2_AUDIENCIA_M6: CONFIG_M6.audienciaM6, M6_PUERTO: String(await puertoLibre()), M6_PUERTO_CONTROL: String(puertoControl) },
    () => undefined,
    { flujoLog: descartarLogs },
  ))!;
});
afterAll(async () => {
  await m6.detener();
  await m2.cerrar();
});

const abiertos: { detener: () => Promise<void> }[] = [];
const ajenos: Server[] = [];
afterEach(async () => {
  await Promise.all(abiertos.splice(0).map((servicio) => servicio.detener()));
  await Promise.all(ajenos.splice(0).map((servidor) => new Promise<void>((listo) => servidor.close(() => listo()))));
  m2.responderCon({ tipo: 'ok' });
});

async function levantarPanel(cambios: Record<string, string> = {}): Promise<{ url: string; panel: PanelAndando }> {
  const puerto = await puertoLibre();
  const panel = await arrancarPanel(
    {
      ...TOKENS,
      PANEL_PUERTO: String(puerto),
      PANEL_ESCUCHA: '127.0.0.1',
      PANEL_URL_M2: m2.url,
      PANEL_URL_M6_CONTROL: `http://127.0.0.1:${puertoControl}`,
      ...cambios,
    },
    () => undefined,
    { flujoLog: descartarLogs },
  );
  abiertos.push(panel!);
  return { url: `http://127.0.0.1:${puerto}`, panel: panel! };
}

async function correr(url: string): Promise<{ codigo: number; salida: string }> {
  try {
    const { stdout, stderr } = await ejecutar('node', [SCRIPT, '--panel', url], { env: { ...process.env, NO_COLOR: '1' } });
    return { codigo: 0, salida: stdout + stderr };
  } catch (error) {
    const { code, stdout, stderr } = error as { code: number; stdout: string; stderr: string };
    return { codigo: code, salida: stdout + stderr };
  }
}

const estadoDelCanal = async () => (await (await fetch(`http://127.0.0.1:${puertoControl}/control/estado`)).json()) as { modo: string };

describe('scripts/panel-humo.mjs (RNF-04.7, RNF-06.4)', () => {
  it('con el panel, M2 y el M6 simulado sanos termina en verde y comprueba las cinco cosas', async () => {
    m2.responderCon({ tipo: 'ok', cuerpo: { estado: 'ok' } });
    const { url } = await levantarPanel();

    const { codigo, salida } = await correr(url);

    expect(salida).toContain('✔ El panel está sano');
    expect(salida).toContain('✔ GET /health llega a M2');
    expect(salida).toContain('✔ El M6 simulado responde');
    expect(salida).toContain('✔ Un Origin ajeno recibe 403');
    expect(salida).toContain('✔ Un Host ajeno recibe 403');
    expect(salida).not.toContain('✘');
    expect(codigo).toBe(0);
  });

  it('el pedido con Origin ajeno no cambia nada en el M6 simulado', async () => {
    const { url } = await levantarPanel();

    await correr(url);

    expect((await estadoDelCanal()).modo).toBe('normal');
  });

  it('si M2 no responde, marca la línea de /health y las demás siguen en verde, con código 1', async () => {
    m2.responderCon({ tipo: '5xx', estado: 503 });
    const { url } = await levantarPanel();

    const { codigo, salida } = await correr(url);

    expect(salida).toMatch(/✘ GET \/health llega a M2/);
    expect(salida).toContain('✔ El panel está sano');
    expect(salida).toContain('✔ El M6 simulado responde');
    expect(codigo).toBe(1);
  });

  it('si el canal de control del M6 no responde, marca la línea del M6 y termina con código 1', async () => {
    const { url } = await levantarPanel({ PANEL_URL_M6_CONTROL: `http://127.0.0.1:${await puertoLibre()}` });

    const { codigo, salida } = await correr(url);

    expect(salida).toMatch(/✘ El M6 simulado responde/);
    expect(salida).toContain('✔ El panel está sano');
    expect(codigo).toBe(1);
  });

  it('si el panel no escucha, lo dice y cómo levantarlo, con código 1', async () => {
    const { codigo, salida } = await correr(`http://127.0.0.1:${await puertoLibre()}`);

    expect(salida).toContain('npm run panel');
    expect(salida).toContain('docker compose --profile panel');
    expect(codigo).toBe(1);
  });

  it('un panel que acepta el Origin o el Host ajeno hace fallar el script', async () => {
    // Un "panel" sin defensas: responde 200 a todo.
    const permisivo = createServer((_pedido, respuesta) => {
      respuesta.setHeader('content-type', 'application/json');
      respuesta.end(JSON.stringify({ estado: 'ok', modo: 'normal', retardoLentoMs: 0 }));
    });
    ajenos.push(permisivo);
    await new Promise<void>((listo) => permisivo.listen(0, '127.0.0.1', listo));
    const { port } = permisivo.address() as { port: number };

    const { codigo, salida } = await correr(`http://127.0.0.1:${port}`);

    expect(salida).toMatch(/✘ Un Origin ajeno recibe 403/);
    expect(salida).toMatch(/✘ Un Host ajeno recibe 403/);
    expect(codigo).toBe(1);
  });

  it('el valor que dice «ok» no alcanza si la respuesta de /health no es JSON de M2', async () => {
    m2.responderCon({ tipo: 'no-json', contenido: '<html>no soy M2</html>' });
    const { url } = await levantarPanel();

    const { codigo, salida } = await correr(url);

    expect(salida).toMatch(/✘ GET \/health llega a M2/);
    expect(codigo).toBe(1);
  });
});
