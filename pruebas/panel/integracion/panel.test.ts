import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { construirApp as construirM2 } from '../../../src/app.js';
import { migrar } from '../../../src/bd/migraciones.js';
import { crearPool, type PoolBd } from '../../../src/bd/pool.js';
import type { Config } from '../../../src/config.js';
import { cargarContrato } from '../../../src/contrato/cargar.js';
import { manejadores } from '../../../src/operaciones/index.js';
import { construirAppControl } from '../../../panel/m6-simulado/app-control.js';
import { construirAppM6 } from '../../../panel/m6-simulado/app-m6.js';
import { crearEstadoM6 } from '../../../panel/m6-simulado/estado.js';
import { idsDeEjemplo } from '../../../panel/m6-simulado/ids.js';
import { crearPuertoApi, type PuertoApi } from '../../../panel/m6-simulado/puerto-api.js';
import { CONFIG } from '../../ayudas/app.js';
import { puertoLibre } from '../../ayudas/arranque.js';
import { type BaseDePrueba, crearBaseDePrueba } from '../../ayudas/bd.js';
import { descartarLogs } from '../../ayudas/logs.js';
import { escuchar } from '../../ayudas/socket.js';
import { CONFIG_PANEL, crearAppPanel, DESDE_EL_PANEL, DESDE_EL_PANEL_CON_ORIGEN } from '../ayudas/app.js';
import { CONFIG_M6 } from '../ayudas/m6.js';

// El panel de punta a punta (RNF-13.5, RNF-13.7): PostgreSQL real, M2 con el contrato y los manejadores del servicio, el M6
// simulado con su API y su canal de control, y el panel adelante. Todo pedido sale del panel como lo mandaría el navegador
// (Host y Origin propios, la identidad en X-Panel-Rol y X-Panel-Sub), así que lo que pasa acá es lo que ve la persona.

// M2 espera poco a M6 y el lento tarda más: con un reintento, M2 se rinde en menos de un segundo y responde 503.
const ESPERA_DE_M2_MS = 300;
const RETARDO_LENTO_MS = 1500;
const REINTENTAR_DESPUES_S = 7;
const PROBLEMA = /^application\/problem\+json/;

type Rol = 'CLIENTE' | 'OPERADOR' | 'SERVICIO' | 'CONDUCTOR';
type Pedido = { rol?: Rol; sub?: string; cuerpo?: unknown; clave?: string };

let base: BaseDePrueba;
let pool: PoolBd;
let m2: ReturnType<typeof construirM2>;
let api: PuertoApi;
let control: ReturnType<typeof construirAppControl>;
let panel: ReturnType<typeof crearAppPanel>;
const estadoM6 = crearEstadoM6();

beforeAll(async () => {
  base = await crearBaseDePrueba();
  await migrar({ urlBd: base.urlBd, tiempoBdMs: 2000 });
  pool = crearPool({ urlBd: base.urlBd, tiempoBdMs: 2000 });

  const puertoApi = await puertoLibre();
  const puertoControl = await puertoLibre();
  const configM6 = { ...CONFIG_M6, puerto: puertoApi, puertoControl, retardoLentoMs: RETARDO_LENTO_MS };
  api = crearPuertoApi({
    puerto: puertoApi,
    escucha: '127.0.0.1',
    construir: () => construirAppM6({ config: configM6, estado: estadoM6, flujoLog: descartarLogs }),
  });
  await api.abrir();
  control = construirAppControl({ config: configM6, estado: estadoM6, api, flujoLog: descartarLogs });
  await control.listen({ port: puertoControl, host: '127.0.0.1' });

  // M2 acepta los tokens que firma el panel (misma clave, emisor y audiencia) y se presenta ante M6 como lo verifica el
  // simulado (la audiencia de M6).
  const configM2: Config = {
    ...CONFIG,
    urlBd: base.urlBd,
    claveTokens: CONFIG_PANEL.claveTokens,
    emisorTokens: CONFIG_PANEL.emisorTokens,
    audienciaTokens: CONFIG_PANEL.audienciaTokens,
    campoRoles: CONFIG_PANEL.campoRoles,
    audienciaM6: CONFIG_M6.audienciaM6,
    urlM6: `http://127.0.0.1:${puertoApi}/api/v1`,
    tiempoModulosMs: ESPERA_DE_M2_MS,
    reintentosModulos: 1,
    reintentarDespuesS: REINTENTAR_DESPUES_S,
  };
  m2 = construirM2({ config: configM2, pool, contrato: cargarContrato(), manejadores, flujoLog: descartarLogs });
  const puertoM2 = await escuchar(m2);

  panel = crearAppPanel({ config: { urlM2: `http://127.0.0.1:${puertoM2}`, urlM6Control: `http://127.0.0.1:${puertoControl}` } });
});

afterAll(async () => {
  await panel?.close();
  await m2?.close();
  await control?.close();
  await api?.cerrar();
  await pool?.end();
  await base?.borrar();
});

// El modo del M6 simulado es de todos: cada prueba que lo cambia lo deja en normal.
afterEach(async () => {
  await ponerModo('normal');
});

// Un pedido como lo manda la pantalla: Origin propio en lo que no es consulta, y la identidad que eligió la persona.
function pedir(metodo: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, { rol, sub, cuerpo, clave }: Pedido = {}) {
  return panel.inject({
    method: metodo,
    url,
    headers: {
      ...(metodo === 'GET' ? DESDE_EL_PANEL : DESDE_EL_PANEL_CON_ORIGEN),
      ...(rol === undefined ? {} : { 'x-panel-rol': rol }),
      ...(sub === undefined ? {} : { 'x-panel-sub': sub }),
      ...(cuerpo === undefined ? {} : { 'content-type': 'application/json' }),
      ...(clave === undefined ? {} : { 'idempotency-key': clave }),
    },
    ...(cuerpo === undefined ? {} : { payload: JSON.stringify(cuerpo) }),
  });
}

const ponerModo = async (modo: 'normal' | 'lento' | 'caido') => {
  const respuesta = await pedir('PUT', '/panel/m6/modo', { cuerpo: { modo } });
  expect(respuesta.statusCode).toBe(200);
};

const PERFIL = { nombre: 'Ana', apellido: 'Gómez', telefono: '+5493624000000' };
const alta = (clienteId: string, clave = `alta-${clienteId}`) =>
  pedir('POST', '/api/v1/clientes', { rol: 'CLIENTE', sub: clienteId, cuerpo: PERFIL, clave });

// «Entrar como cliente nuevo»: un sub nuevo y su alta.
async function clienteNuevo(): Promise<string> {
  const clienteId = randomUUID();
  expect((await alta(clienteId)).statusCode).toBe(201);
  return clienteId;
}

// Los pasos de «Cargar ejemplo» del plan, con sus claves fijas (la lógica de la pantalla es de T21): tres direcciones, las
// preferencias y los viajes del M6 simulado.
const DIRECCIONES = [
  { tipo: 'FAVORITA', alias: 'Casa', texto: 'Av. Sarmiento 1500, Resistencia', coordenadas: { latitud: -27.45, longitud: -58.98 } },
  { tipo: 'RECIENTE', texto: 'Plaza 25 de Mayo, Resistencia' },
  { tipo: 'RECIENTE', texto: 'Terminal de Ómnibus, Resistencia' },
];
const PREFERENCIAS = { tiposVehiculo: ['AUTO'], canales: ['EMAIL', 'PUSH'], accesibilidad: [] };

async function cargarEjemplo(clienteId: string) {
  const como = { rol: 'CLIENTE' as const, sub: clienteId };
  const direcciones = [];
  for (const [n, cuerpo] of DIRECCIONES.entries()) {
    direcciones.push(await pedir('POST', `/api/v1/clientes/${clienteId}/direcciones`, { ...como, cuerpo, clave: `ejemplo-dir-${n + 1}-${clienteId}` }));
  }
  const preferencias = await pedir('PUT', `/api/v1/clientes/${clienteId}/preferencias`, { ...como, cuerpo: PREFERENCIAS });
  const viajes = await pedir('POST', `/panel/m6/clientes/${clienteId}/ejemplo`);
  return { direcciones, preferencias, viajes };
}

type Escenarios = { escenarios: { nombre: string; viajeId: string; respuestaDeM2: number }[] };
const idDe = (respuesta: Awaited<ReturnType<typeof pedir>>, nombre: string) => {
  const escenario = respuesta.json<Escenarios>().escenarios.find((e) => e.nombre === nombre);
  if (escenario === undefined) throw new Error(`no vino el escenario ${nombre}`);
  return escenario.viajeId;
};

const historial = (clienteId: string) => pedir('GET', `/api/v1/clientes/${clienteId}/viajes`, { rol: 'CLIENTE', sub: clienteId });
const calificar = (clienteId: string, viajeId: string, clave: string = randomUUID()) =>
  pedir('POST', `/api/v1/clientes/${clienteId}/calificaciones`, {
    rol: 'CLIENTE',
    sub: clienteId,
    cuerpo: { viajeId, puntaje: 5, comentario: 'Muy amable' },
    clave,
  });

describe('alta (RF-2.1.5)', () => {
  it('la misma Idempotency-Key dos veces deja un solo cliente y repite la respuesta', async () => {
    const clienteId = randomUUID();

    const primera = await alta(clienteId, 'alta-repetida');
    const segunda = await alta(clienteId, 'alta-repetida');

    expect(primera.statusCode).toBe(201);
    expect(segunda.statusCode).toBe(201);
    expect(segunda.json()).toEqual(primera.json());
    expect(segunda.headers['location']).toBe(`/api/v1/clientes/${clienteId}`);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM clientes WHERE cliente_id = $1', [clienteId]);
    expect(rows[0]).toEqual({ n: 1 });
    const perfil = await pedir('GET', `/api/v1/clientes/${clienteId}`, { rol: 'CLIENTE', sub: clienteId });
    expect(perfil.json()).toMatchObject({ clienteId, ...PERFIL, estado: 'ACTIVO' });
  });
});

describe('«Cargar ejemplo» (RF-2.1.10, RF-2.1.11)', () => {
  it('dos veces deja tres direcciones, las preferencias y dos viajes, sin duplicar nada', async () => {
    const clienteId = await clienteNuevo();

    const primera = await cargarEjemplo(clienteId);
    const segunda = await cargarEjemplo(clienteId);

    expect(primera.direcciones.map((r) => r.statusCode)).toEqual([201, 201, 201]);
    expect(segunda.direcciones.map((r) => r.statusCode)).toEqual([201, 201, 201]);
    // La misma clave devuelve la dirección que ya se había creado.
    expect(segunda.direcciones.map((r) => r.json())).toEqual(primera.direcciones.map((r) => r.json()));
    expect([primera.preferencias.statusCode, segunda.preferencias.statusCode]).toEqual([200, 200]);
    expect([primera.viajes.statusCode, segunda.viajes.statusCode]).toEqual([200, 200]);
    expect(segunda.viajes.json()).toEqual(primera.viajes.json());

    const direcciones = await pedir('GET', `/api/v1/clientes/${clienteId}/direcciones`, { rol: 'CLIENTE', sub: clienteId });
    const lista = direcciones.json<{ items: { tipo: string }[]; totalElementos: number }>();
    expect(lista.totalElementos).toBe(3);
    expect(lista.items.map((d) => d.tipo).sort()).toEqual(['FAVORITA', 'RECIENTE', 'RECIENTE']);
    const preferencias = await pedir('GET', `/api/v1/clientes/${clienteId}/preferencias`, { rol: 'CLIENTE', sub: clienteId });
    expect(preferencias.json()).toMatchObject(PREFERENCIAS);
    expect(estadoM6.listar({ clientId: clienteId })).toHaveLength(2);
  });

  it('el historial muestra los dos viajes de ejemplo, sin calificar', async () => {
    const clienteId = await clienteNuevo();
    await cargarEjemplo(clienteId);

    const respuesta = await historial(clienteId);

    expect(respuesta.statusCode).toBe(200);
    const { items } = respuesta.json<{ items: { viajeId: string; estado: string; calificado?: boolean }[] }>();
    const ids = idsDeEjemplo(clienteId);
    expect(items.map((v) => [v.viajeId, v.estado, v.calificado]).sort()).toEqual(
      [
        [ids.completado, 'COMPLETED', false],
        [ids.enCurso, 'IN_PROGRESS', false],
      ].sort(),
    );
  });
});

describe('calificar con los escenarios del M6 simulado (RF-2.5.15, RNF-13.5)', () => {
  it('completado 201 (y su clave repite la respuesta), repetirlo 409, en curso 422, ajeno e inexistente 404', async () => {
    const clienteId = await clienteNuevo();
    const { viajes } = await cargarEjemplo(clienteId);
    // Lo que el canal dice que va a responder M2, para comparar con lo que responde de verdad.
    const esperado = Object.fromEntries(viajes.json<Escenarios>().escenarios.map((e) => [e.nombre, e.respuestaDeM2]));

    const completado = await calificar(clienteId, idDe(viajes, 'completado'), 'calificar-completado');
    const mismaClave = await calificar(clienteId, idDe(viajes, 'completado'), 'calificar-completado');
    const repetido = await calificar(clienteId, idDe(viajes, 'completado'));
    const enCurso = await calificar(clienteId, idDe(viajes, 'enCurso'));
    const ajeno = await calificar(clienteId, idDe(viajes, 'ajeno'));
    const inexistente = await calificar(clienteId, idDe(viajes, 'inexistente'));

    expect(completado.statusCode).toBe(201);
    expect(mismaClave.statusCode).toBe(201);
    expect(mismaClave.json()).toEqual(completado.json());
    expect(repetido.statusCode).toBe(409);
    expect(
      Object.fromEntries([
        ['completado', completado.statusCode],
        ['enCurso', enCurso.statusCode],
        ['ajeno', ajeno.statusCode],
        ['inexistente', inexistente.statusCode],
      ]),
    ).toEqual(esperado);
    expect(esperado).toEqual({ completado: 201, enCurso: 422, ajeno: 404, inexistente: 404 });
    for (const error of [repetido, enCurso, ajeno, inexistente]) expect(error.headers['content-type']).toMatch(PROBLEMA);
  });

  it('después de calificar, el historial marca el completado como calificado', async () => {
    const clienteId = await clienteNuevo();
    const { viajes } = await cargarEjemplo(clienteId);
    expect((await calificar(clienteId, idDe(viajes, 'completado'))).statusCode).toBe(201);

    const { items } = (await historial(clienteId)).json<{ items: { viajeId: string; calificado?: boolean }[] }>();

    expect(Object.fromEntries(items.map((v) => [v.viajeId, v.calificado]))).toEqual({
      [idDe(viajes, 'completado')]: true,
      [idDe(viajes, 'enCurso')]: false,
    });
  });
});

describe('modos del M6 simulado: M2 responde 503 con Retry-After (RNF-13.5, RF-2.4.13)', () => {
  it.each([['lento' as const], ['caido' as const]])('en modo %s, historial y calificar dan 503 y no se guarda nada', async (modo) => {
    const clienteId = await clienteNuevo();
    const { viajes } = await cargarEjemplo(clienteId);
    await ponerModo(modo);

    const inicio = performance.now();
    const enHistorial = await historial(clienteId);
    const alCalificar = await calificar(clienteId, idDe(viajes, 'completado'));
    const duracionMs = performance.now() - inicio;

    for (const respuesta of [enHistorial, alCalificar]) {
      expect(respuesta.statusCode).toBe(503);
      expect(respuesta.headers['content-type']).toMatch(PROBLEMA);
      expect(respuesta.headers['retry-after']).toBe(String(REINTENTAR_DESPUES_S));
    }
    // M2 corta por su espera y no espera al lento: los dos pedidos terminan antes de un solo retardo cada uno.
    expect(duracionMs).toBeLessThan(2 * RETARDO_LENTO_MS);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM calificaciones WHERE cliente_id = $1', [clienteId]);
    expect(rows[0]).toEqual({ n: 0 });

    // De vuelta en normal, el mismo viaje se califica: el 503 no dejó nada a medias.
    await ponerModo('normal');
    expect((await calificar(clienteId, idDe(viajes, 'completado'))).statusCode).toBe(201);
  });

  it('el estado del canal dice en qué modo está', async () => {
    await ponerModo('caido');

    const respuesta = await pedir('GET', '/panel/m6/estado');

    expect(respuesta.json()).toEqual({ modo: 'caido', retardoLentoMs: RETARDO_LENTO_MS });
  });
});

describe('bloqueos y estado de cuenta (RF-2.6.5 a RF-2.6.7)', () => {
  it('un OPERADOR bloquea, y el estado de cuenta lo muestra al cliente y a otro módulo', async () => {
    const clienteId = await clienteNuevo();
    const operador = randomUUID();

    const bloqueo = await pedir('POST', `/api/v1/clientes/${clienteId}/bloqueos`, {
      rol: 'OPERADOR',
      sub: operador,
      cuerpo: { motivo: 'Prueba del panel' },
      clave: `bloqueo-${clienteId}`,
    });
    const paraOtroModulo = await pedir('GET', `/api/v1/clientes/${clienteId}/estado-cuenta`, { rol: 'SERVICIO', sub: 'm5-pagos' });
    const paraElCliente = await pedir('GET', `/api/v1/clientes/${clienteId}/estado-cuenta`, { rol: 'CLIENTE', sub: clienteId });

    expect(bloqueo.statusCode).toBe(201);
    const { bloqueoId } = bloqueo.json<{ bloqueoId: string }>();
    for (const respuesta of [paraOtroModulo, paraElCliente]) {
      expect(respuesta.statusCode).toBe(200);
      const cuenta = respuesta.json<{ clienteId: string; estado: string; bloqueosVigentes: { bloqueoId: string }[] }>();
      expect(cuenta.clienteId).toBe(clienteId);
      expect(cuenta.estado).toBe('BLOQUEADO');
      expect(cuenta.bloqueosVigentes.map((b) => b.bloqueoId)).toEqual([bloqueoId]);
    }
  });
});

describe('permisos (RNF-12)', () => {
  it('un CONDUCTOR recibe 403 problem+json en una operación de clientes', async () => {
    const clienteId = await clienteNuevo();

    const respuestas = [
      await pedir('GET', `/api/v1/clientes/${clienteId}`, { rol: 'CONDUCTOR', sub: randomUUID() }),
      await pedir('GET', `/api/v1/clientes/${clienteId}/estado-cuenta`, { rol: 'CONDUCTOR', sub: randomUUID() }),
    ];

    for (const respuesta of respuestas) {
      expect(respuesta.statusCode).toBe(403);
      expect(respuesta.headers['content-type']).toMatch(PROBLEMA);
    }
  });

  it('otro CLIENTE no ve el perfil ajeno', async () => {
    const clienteId = await clienteNuevo();

    const respuesta = await pedir('GET', `/api/v1/clientes/${clienteId}`, { rol: 'CLIENTE', sub: randomUUID() });

    expect(respuesta.statusCode).toBe(403);
  });
});
