import { jwtVerify } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { construirApp } from '../../../panel/servidor/app.js';
import { ControlM6NoResponde, ESPERA_CONTROL_MS, pedirControlM6 } from '../../../panel/servidor/m6-control.js';
import { ESPERA_M2_DIRECTO_MS, idDePedido, m2Directo } from '../../../panel/servidor/demo/m2-directo.js';
import { puertoLibre } from '../../ayudas/arranque.js';
import { descartarLogs } from '../../ayudas/logs.js';
import { crearServidorModulo } from '../../ayudas/servidor-modulo.js';
import { CONFIG_PANEL, DESDE_EL_PANEL } from '../ayudas/app.js';

// Los pedidos directos del servidor del panel (spec 072, T4): a M2, para las pruebas simultáneas, y al canal de control del M6
// simulado. Un servidor de mentira hace de los dos y deja ver qué le llegó (RNF-08.2, RNF-08.4, RNF-12.10).
const CLIENTE_ID = '11111111-1111-4111-8111-111111111111';
const CLAVE = '22222222-2222-4222-8222-222222222222';

let modulo: ReturnType<typeof crearServidorModulo>;
let config: typeof CONFIG_PANEL;

beforeEach(async () => {
  modulo = crearServidorModulo();
  await modulo.levantar();
  config = { ...CONFIG_PANEL, urlM2: modulo.url, urlM6Control: modulo.url };
});
afterEach(() => modulo.cerrar());

describe('m2Directo (RNF-08.2, RNF-08.4)', () => {
  const pedido = {
    metodo: 'POST' as const,
    ruta: '/api/v1/clientes',
    identidad: { rol: 'CLIENTE' as const, sub: CLIENTE_ID },
    requestId: 'panel-demo-abc123-0',
    claveIdempotencia: CLAVE,
    cuerpo: { nombre: 'Ana', apellido: 'Pérez', telefono: '+5491122334455' },
  };

  it('firma el token con la clave del panel y el sub y el rol pedidos', async () => {
    await m2Directo(config, pedido);

    const autorizacion = modulo.autorizaciones[0] ?? '';
    expect(autorizacion).toMatch(/^Bearer /);
    const { payload } = await jwtVerify(autorizacion.slice('Bearer '.length), new TextEncoder().encode(config.claveTokens), {
      issuer: config.emisorTokens,
      audience: config.audienciaTokens,
    });
    expect(payload.sub).toBe(CLIENTE_ID);
    expect(payload[config.campoRoles]).toEqual(['CLIENTE']);
  });

  it('manda Idempotency-Key, Content-Type y el X-Request-Id con el prefijo de la corrida, al método y la ruta pedidos', async () => {
    await m2Directo(config, pedido);

    expect(modulo.metodoRecibido).toBe('POST');
    expect(modulo.rutaRecibida).toBe('/api/v1/clientes');
    expect(modulo.encabezadosRecibidos.get('idempotency-key')).toBe(CLAVE);
    expect(modulo.encabezadosRecibidos.get('content-type')).toBe('application/json');
    expect(modulo.encabezadosRecibidos.get('x-request-id')).toBe('panel-demo-abc123-0');
    expect(JSON.parse(modulo.cuerpoRecibido.toString('utf8'))).toEqual(pedido.cuerpo);
  });

  it('sin clave ni cuerpo no manda Idempotency-Key ni Content-Type', async () => {
    await m2Directo(config, { metodo: 'GET', ruta: `/api/v1/clientes/${CLIENTE_ID}`, identidad: pedido.identidad, requestId: 'panel-demo-abc123-1' });

    expect(modulo.encabezadosRecibidos.has('idempotency-key')).toBe(false);
    expect(modulo.encabezadosRecibidos.has('content-type')).toBe(false);
    expect(modulo.cuerpoRecibido.length).toBe(0);
  });

  it('devuelve el código y el cuerpo tal como llegaron, también en un error', async () => {
    modulo.responderCon({ tipo: 'ok', estado: 409, cuerpo: { type: '/errores/perfil-ya-existe' }, encabezados: { 'Content-Type': 'application/problem+json' } });

    const respuesta = await m2Directo(config, pedido);

    expect(respuesta.estado).toBe(409);
    expect(respuesta.tipoContenido).toBe('application/problem+json');
    expect(JSON.parse(respuesta.texto)).toEqual({ type: '/errores/perfil-ya-existe' });
    expect(respuesta.motivo).toBeUndefined();
  });

  it('el corte por defecto es de 10 s', () => {
    expect(ESPERA_M2_DIRECTO_MS).toBe(10_000);
  });

  it('si M2 no responde a tiempo devuelve el código 0 y el motivo, sin reintentar', async () => {
    modulo.responderCon({ tipo: 'cuelga' });

    const antes = Date.now();
    const respuesta = await m2Directo(config, pedido, 150);

    expect(respuesta).toMatchObject({ estado: 0, texto: '', motivo: 'TimeoutError' });
    expect(Date.now() - antes).toBeLessThan(1500);
    expect(modulo.llamadas).toBe(1);
  });

  it('el corte vale también si M2 contesta los encabezados y demora el cuerpo', async () => {
    modulo.responderCon({ tipo: 'demora-cuerpo', retardoMs: 2000 });

    const respuesta = await m2Directo(config, pedido, 150);

    expect(respuesta.estado).toBe(0);
  });

  it('si M2 rechaza la conexión devuelve 0 con el código de Node y sin la dirección', async () => {
    const puerto = await puertoLibre();

    const respuesta = await m2Directo({ ...config, urlM2: `http://127.0.0.1:${puerto}` }, pedido);

    expect(respuesta.estado).toBe(0);
    expect(respuesta.motivo).toBe('ECONNREFUSED');
    expect(JSON.stringify(respuesta)).not.toContain('127.0.0.1');
  });

  it('una identidad inválida no sale a la red', async () => {
    await expect(m2Directo(config, { ...pedido, identidad: { rol: 'ADMIN' as never, sub: CLIENTE_ID } })).rejects.toThrow(/roles/i);
    expect(modulo.llamadas).toBe(0);
  });

  it('no registra nada en el detalle técnico del panel, aunque hable con el mismo M2', async () => {
    const app = construirApp({ config, flujoLog: descartarLogs });
    try {
      await Promise.all([0, 1, 2].map((i) => m2Directo(config, { ...pedido, requestId: idDePedido('abc123', i) })));

      const respuesta = await app.inject({ method: 'GET', url: '/panel/pedidos', headers: DESDE_EL_PANEL });

      expect(respuesta.json()).toEqual({ pedidos: [] });
    } finally {
      await app.close();
    }
  });
});

describe('idDePedido', () => {
  it('arma panel-demo-{corrida}-{i}, para buscarlo en los logs de M2', () => {
    expect(idDePedido('abc123', 0)).toBe('panel-demo-abc123-0');
    expect(idDePedido('abc123', 49)).toBe('panel-demo-abc123-49');
  });
});

describe('pedirControlM6, separado de las rutas del panel (RNF-13.5)', () => {
  it('pide al canal de control y devuelve el código, el tipo y el contenido', async () => {
    modulo.responderCon({ tipo: 'ok', cuerpo: { modo: 'normal' } });

    const respuesta = await pedirControlM6(config, { metodo: 'GET', ruta: '/control/estado', requestId: 'panel-demo-abc123-x' });

    expect(respuesta.estado).toBe(200);
    expect(respuesta.tipoContenido).toContain('application/json');
    expect(JSON.parse(respuesta.contenido.toString('utf8'))).toEqual({ modo: 'normal' });
    expect(modulo.rutaRecibida).toBe('/control/estado');
    expect(modulo.encabezadosRecibidos.get('x-request-id')).toBe('panel-demo-abc123-x');
  });

  it('manda el cuerpo y su tipo, y nada que identifique al navegador', async () => {
    await pedirControlM6(config, {
      metodo: 'PUT',
      ruta: '/control/modo',
      requestId: 'r-1',
      tipoContenido: 'application/json',
      cuerpo: new TextEncoder().encode('{"modo":"caido"}'),
    });

    expect(modulo.metodoRecibido).toBe('PUT');
    expect(modulo.cuerpoRecibido.toString('utf8')).toBe('{"modo":"caido"}');
    expect(modulo.encabezadosRecibidos.get('content-type')).toBe('application/json');
    for (const encabezado of ['authorization', 'origin', 'cookie']) expect(modulo.encabezadosRecibidos.has(encabezado)).toBe(false);
  });

  it('espera 3 s por defecto y, si el canal no contesta, lanza ControlM6NoResponde con la causa', async () => {
    expect(ESPERA_CONTROL_MS).toBe(3000);
    modulo.responderCon({ tipo: 'cuelga' });

    const error = await pedirControlM6(config, { metodo: 'GET', ruta: '/control/estado', requestId: 'r-2' }, 150).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ControlM6NoResponde);
    expect((error as ControlM6NoResponde).causa).toBeInstanceOf(Error);
    expect(modulo.llamadas).toBe(1);
  });
});
