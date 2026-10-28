import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { construirApp as construirM2 } from '../../../src/app.js';
import { migrar } from '../../../src/bd/migraciones.js';
import { crearPool, type PoolBd } from '../../../src/bd/pool.js';
import type { Config } from '../../../src/config.js';
import { cargarContrato } from '../../../src/contrato/cargar.js';
import { manejadores } from '../../../src/operaciones/index.js';
import { ErrorDeApi } from '../../../panel/cliente/src/api/errores.js';
import { crearApiM2, type Identidad } from '../../../panel/cliente/src/api/m2.js';
import { crearSesionSimulada, CLAVE_DE_SESION } from '../../../panel/cliente/src/fuentes/sesion-simulada.js';
import { CLIENTE_DE_EJEMPLO, cuerpoDeAlta, validarCamposCliente, type CamposCliente } from '../../../panel/cliente/src/logica/campos-cliente.js';
import {
  CLAVE_DE_RECORDADOS,
  crearRecordadosGuardados,
  entrarComoNuevo,
  entrarConRol,
  volverAEntrar,
  type Ingreso,
} from '../../../panel/cliente/src/logica/ingresar.js';
import { resolver } from '../../../panel/cliente/src/rutas.js';
import { CONFIG } from '../../ayudas/app.js';
import { puertoLibre } from '../../ayudas/arranque.js';
import { type BaseDePrueba, crearBaseDePrueba } from '../../ayudas/bd.js';
import { descartarLogs } from '../../ayudas/logs.js';
import { escuchar } from '../../ayudas/socket.js';
import { CONFIG_PANEL, crearAppPanel } from '../ayudas/app.js';

// La pantalla `ingresar` (T19, RF-2.1.5 a RF-2.1.7, RNF-12.9) recorrida contra el panel de verdad: PostgreSQL real, M2 con el
// contrato y los manejadores del servicio, y el servidor del panel escuchando en un puerto. Lo que hace la pantalla está en
// `logica/ingresar.ts`, y acá se lo llama con lo mismo que le da `app.tsx`: la sesión simulada, los recordados del almacenamiento
// local y el cliente de M2 del navegador (`crearApiM2`), que pide al panel como lo pediría Chrome (con `Origin` en lo que no es
// consulta). Lo que se dibuja lo recorre la prueba en navegador (T33).

let base: BaseDePrueba;
let pool: PoolBd;
let m2: ReturnType<typeof construirM2>;
let panel: ReturnType<typeof crearAppPanel>;
let origen: string;

beforeAll(async () => {
  base = await crearBaseDePrueba();
  await migrar({ urlBd: base.urlBd, tiempoBdMs: 2000 });
  pool = crearPool({ urlBd: base.urlBd, tiempoBdMs: 2000 });

  const configM2: Config = {
    ...CONFIG,
    urlBd: base.urlBd,
    claveTokens: CONFIG_PANEL.claveTokens,
    emisorTokens: CONFIG_PANEL.emisorTokens,
    audienciaTokens: CONFIG_PANEL.audienciaTokens,
    campoRoles: CONFIG_PANEL.campoRoles,
  };
  m2 = construirM2({ config: configM2, pool, contrato: cargarContrato(), manejadores, flujoLog: descartarLogs });
  const puertoM2 = await escuchar(m2);

  // El panel solo acepta su propio Host, con el puerto configurado: escucha en el mismo que tiene en la configuración.
  const puerto = await puertoLibre();
  panel = crearAppPanel({ config: { puerto, urlM2: `http://127.0.0.1:${puertoM2}` } });
  await panel.listen({ port: puerto, host: '127.0.0.1' });
  origen = `http://127.0.0.1:${puerto}`;
});

afterAll(async () => {
  await panel?.close();
  await m2?.close();
  await pool?.end();
  await base?.borrar();
});

// El `fetch` del navegador en la página del panel: los caminos relativos van al panel, y lo que no es consulta lleva `Origin`.
const porElPanel: typeof fetch = (entrada, init = {}) => {
  const encabezados = new Headers(init.headers);
  if ((init.method ?? 'GET').toUpperCase() !== 'GET') encabezados.set('origin', origen);
  return fetch(new URL(String(entrada), origen), { ...init, headers: encabezados });
};

// Un almacenamiento de mentira (de sesión o local) que guarda en un mapa.
function almacenamiento() {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: (clave: string) => datos.get(clave) ?? null,
    setItem: (clave: string, valor: string) => void datos.set(clave, valor),
    removeItem: (clave: string) => void datos.delete(clave),
  };
}

// Lo que `app.tsx` le da a la pantalla, armado de cero para cada prueba: como abrir el panel en un navegador limpio.
let sesionGuardada: ReturnType<typeof almacenamiento>;
let local: ReturnType<typeof almacenamiento>;
let ingreso: Ingreso;
beforeEach(() => {
  sesionGuardada = almacenamiento();
  local = almacenamiento();
  ingreso = {
    sesion: crearSesionSimulada(sesionGuardada),
    recordados: crearRecordadosGuardados(local),
    apiPara: (identidad: Identidad) => crearApiM2({ identidad: () => identidad, fetch: porElPanel }),
  };
});

// El cliente de M2 de las demás pantallas: pide con la sesión que haya en ese momento.
const apiDeLaSesion = () => crearApiM2({ identidad: () => ingreso.sesion.actual(), fetch: porElPanel });

const filasDe = async (clienteId: string) =>
  (await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM clientes WHERE cliente_id = $1', [clienteId])).rows[0]?.n;

describe('«Entrar como cliente nuevo» (RF-2.1.5)', () => {
  it('crea el perfil con los valores de ejemplo, abre la sesión como ese cliente y lo recuerda', async () => {
    const clienteId = randomUUID();

    const sesion = await entrarComoNuevo(ingreso, { clienteId, campos: CLIENTE_DE_EJEMPLO, clave: randomUUID() });

    expect(sesion).toEqual({ rol: 'CLIENTE', sub: clienteId });
    expect(ingreso.sesion.actual()).toEqual(sesion);
    expect(await filasDe(clienteId)).toBe(1);
    expect(ingreso.recordados.lista()).toEqual([{ id: clienteId, nombre: 'Ana Gómez' }]);
    // Del cliente se guarda solo su UUID y su nombre; de la sesión, el rol y el identificador.
    expect(JSON.parse(local.datos.get(CLAVE_DE_RECORDADOS)!)).toEqual([{ id: clienteId, nombre: 'Ana Gómez' }]);
    expect(JSON.parse(sesionGuardada.datos.get(CLAVE_DE_SESION)!)).toEqual({ rol: 'CLIENTE', sub: clienteId });

    // Las pantallas del cliente ya piden como él: su perfil es el que se creó.
    expect(await apiDeLaSesion().obtenerCliente(clienteId)).toMatchObject({ clienteId, ...cuerpoDeAlta(CLIENTE_DE_EJEMPLO), estado: 'ACTIVO' });
    expect(resolver('', ingreso.sesion.actual())).toMatchObject({ redirigirA: '#/perfil' });
  });

  it('con lo escrito en el formulario: sin fecha y con espacios de más', async () => {
    const clienteId = randomUUID();
    const campos: CamposCliente = { nombre: '  Beto ', apellido: 'Ruiz', telefono: '+5491100000000', fechaNacimiento: '' };

    await entrarComoNuevo(ingreso, { clienteId, campos, clave: randomUUID() });

    const perfil = await apiDeLaSesion().obtenerCliente(clienteId);
    expect(perfil).toMatchObject({ nombre: 'Beto', apellido: 'Ruiz', telefono: '+5491100000000' });
    expect(perfil).not.toHaveProperty('fechaNacimiento');
    expect(ingreso.recordados.lista()[0]).toEqual({ id: clienteId, nombre: 'Beto Ruiz' });
  });

  it('«Reintentar» con el mismo identificador y la misma clave no duplica: M2 devuelve el mismo cliente', async () => {
    const clienteId = randomUUID();
    const clave = randomUUID();

    await entrarComoNuevo(ingreso, { clienteId, campos: CLIENTE_DE_EJEMPLO, clave });
    const otraVez = await entrarComoNuevo(ingreso, { clienteId, campos: CLIENTE_DE_EJEMPLO, clave });

    expect(otraVez).toEqual({ rol: 'CLIENTE', sub: clienteId });
    expect(await filasDe(clienteId)).toBe(1);
    expect(ingreso.recordados.lista()).toHaveLength(1);
  });

  it('si M2 rechaza el alta, no hay sesión ni recordado, y el error es el de M2', async () => {
    const clienteId = randomUUID();
    // `0000` cumple el formato `date` del contrato y M2 lo rechaza (RF-2.1.4); el panel también lo marca.
    const campos = { ...CLIENTE_DE_EJEMPLO, fechaNacimiento: '0000-06-15' };
    expect(validarCamposCliente(campos)).toHaveProperty('fechaNacimiento');

    const fallo = entrarComoNuevo(ingreso, { clienteId, campos, clave: randomUUID() });

    await expect(fallo).rejects.toBeInstanceOf(ErrorDeApi);
    await expect(fallo).rejects.toMatchObject({ estado: 400, sinRespuesta: false });
    expect(ingreso.sesion.actual()).toBeUndefined();
    expect(ingreso.recordados.lista()).toEqual([]);
    expect(await filasDe(clienteId)).toBe(0);
  });
});

describe('las validaciones del formulario son las del contrato: lo que el panel rechaza, M2 también (RF-2.1.5)', () => {
  const casos: [string, Partial<CamposCliente>, boolean][] = [
    ['nombre y apellido de 100', { nombre: 'n'.repeat(100), apellido: 'a'.repeat(100) }, true],
    ['nombre de 101', { nombre: 'n'.repeat(101) }, false],
    ['teléfono de 15 dígitos', { telefono: '+123456789012345' }, true],
    ['teléfono de 16 dígitos', { telefono: '+1234567890123456' }, false],
    ['teléfono sin +', { telefono: '5493624000000' }, false],
    ['teléfono que empieza en 0', { telefono: '+0123456789' }, false],
    ['fecha del año 0001', { fechaNacimiento: '0001-01-01' }, true],
    ['fecha que no existe', { fechaNacimiento: '2001-02-29' }, false],
  ];

  it.each(casos)('%s', async (_, cambios, valido) => {
    const campos = { ...CLIENTE_DE_EJEMPLO, ...cambios };
    const clienteId = randomUUID();
    expect(Object.keys(validarCamposCliente(campos)).length === 0).toBe(valido);

    const alta = crearApiM2({ identidad: () => ({ rol: 'CLIENTE', sub: clienteId }), fetch: porElPanel })
      .crearCliente(cuerpoDeAlta(campos), randomUUID())
      .then(() => 201, (error: ErrorDeApi) => error.estado);

    expect(await alta).toBe(valido ? 201 : 400);
  });
});

describe('clientes recordados (RF-2.1.6, RF-2.1.7)', () => {
  it('con un clic se vuelve a entrar como un cliente recordado, y sube primero', async () => {
    const ana = randomUUID();
    const beto = randomUUID();
    await entrarComoNuevo(ingreso, { clienteId: ana, campos: CLIENTE_DE_EJEMPLO, clave: randomUUID() });
    await entrarComoNuevo(ingreso, { clienteId: beto, campos: { ...CLIENTE_DE_EJEMPLO, nombre: 'Beto' }, clave: randomUUID() });
    ingreso.sesion.cerrar();

    const anaRecordada = ingreso.recordados.lista().find((cliente) => cliente.id === ana)!;
    const reingreso = await volverAEntrar(ingreso, anaRecordada);

    expect(reingreso).toEqual({ tipo: 'entro', sesion: { rol: 'CLIENTE', sub: ana } });
    expect(ingreso.sesion.actual()).toEqual({ rol: 'CLIENTE', sub: ana });
    expect(ingreso.recordados.lista().map((cliente) => cliente.id)).toEqual([ana, beto]);
  });

  it('el nombre recordado se actualiza con el del perfil', async () => {
    const clienteId = randomUUID();
    await entrarComoNuevo(ingreso, { clienteId, campos: CLIENTE_DE_EJEMPLO, clave: randomUUID() });
    await apiDeLaSesion().actualizarCliente(clienteId, { apellido: 'Gómez Paz' });
    ingreso.sesion.cerrar();

    await volverAEntrar(ingreso, ingreso.recordados.lista()[0]!);

    expect(ingreso.recordados.lista()[0]).toEqual({ id: clienteId, nombre: 'Ana Gómez Paz' });
  });

  it('si M2 responde 404 (la base se borró), queda marcado «ya no existe», sin sesión, hasta que se lo quita', async () => {
    const clienteId = randomUUID();
    await entrarComoNuevo(ingreso, { clienteId, campos: CLIENTE_DE_EJEMPLO, clave: randomUUID() });
    ingreso.sesion.cerrar();
    // Lo mismo que deja `docker compose down -v`: el navegador lo recuerda y M2 ya no lo tiene.
    await pool.query('DELETE FROM clientes WHERE cliente_id = $1', [clienteId]);

    const reingreso = await volverAEntrar(ingreso, ingreso.recordados.lista()[0]!);

    expect(reingreso).toEqual({ tipo: 'ya-no-existe', id: clienteId });
    expect(ingreso.sesion.actual()).toBeUndefined();
    expect(ingreso.recordados.lista()).toHaveLength(1);

    expect(ingreso.recordados.quitar(clienteId)).toEqual([]);
    expect(JSON.parse(local.datos.get(CLAVE_DE_RECORDADOS)!)).toEqual([]);
  });

  it('otro error de M2 no lo marca «ya no existe»: llega el error tal cual y la sesión no cambia', async () => {
    const recordado = { id: randomUUID(), nombre: 'Ana Gómez' };
    // Un panel sin M2 detrás: el reenvío no llega y el panel responde 504, «M2 no responde».
    const puerto = await puertoLibre();
    const sinM2 = crearAppPanel({ config: { puerto, urlM2: `http://127.0.0.1:${await puertoLibre()}` } });
    await sinM2.listen({ port: puerto, host: '127.0.0.1' });
    try {
      const otro: Ingreso = {
        ...ingreso,
        apiPara: (identidad) => crearApiM2({ identidad: () => identidad, fetch: (entrada, init) => fetch(new URL(String(entrada), `http://127.0.0.1:${puerto}`), init) }),
      };

      await expect(volverAEntrar(otro, recordado)).rejects.toMatchObject({ sinRespuesta: true, estado: 504 });
      expect(ingreso.sesion.actual()).toBeUndefined();
    } finally {
      await sinM2.close();
    }
  });
});

describe('elegir rol e identificador, y cerrar sesión (RNF-12.9)', () => {
  it('un OPERADOR entra con su identificador y ya pide como operador', async () => {
    const cliente = randomUUID();
    await entrarComoNuevo(ingreso, { clienteId: cliente, campos: CLIENTE_DE_EJEMPLO, clave: randomUUID() });

    expect(entrarConRol(ingreso, 'OPERADOR', ' operador-1 ')).toEqual({ rol: 'OPERADOR', sub: 'operador-1' });

    expect(await apiDeLaSesion().listarBloqueos(cliente)).toMatchObject({ items: [] });
    expect(resolver('', ingreso.sesion.actual())).toMatchObject({ redirigirA: '#/operador' });
    // Entrar con otro rol no toca los recordados: solo los clientes se recuerdan.
    expect(ingreso.recordados.lista()).toHaveLength(1);
  });

  it('un CLIENTE entra con el UUID de un cliente existente', async () => {
    const clienteId = randomUUID();
    await entrarComoNuevo(ingreso, { clienteId, campos: CLIENTE_DE_EJEMPLO, clave: randomUUID() });
    ingreso.sesion.cerrar();

    entrarConRol(ingreso, 'CLIENTE', clienteId);

    expect(await apiDeLaSesion().obtenerCliente(clienteId)).toMatchObject({ clienteId });
  });

  it('con un identificador inválido no entra y no cambia la sesión', () => {
    entrarConRol(ingreso, 'OPERADOR', 'operador-1');

    expect(() => entrarConRol(ingreso, 'CLIENTE', 'cliente-1')).toThrow(/UUID/);
    expect(() => entrarConRol(ingreso, 'SERVICIO', '')).toThrow('Escribí un identificador.');
    expect(ingreso.sesion.actual()).toEqual({ rol: 'OPERADOR', sub: 'operador-1' });
  });

  it('«Cerrar sesión» olvida el rol y el cliente, vuelve a ingresar y los recordados quedan', async () => {
    const clienteId = randomUUID();
    await entrarComoNuevo(ingreso, { clienteId, campos: CLIENTE_DE_EJEMPLO, clave: randomUUID() });

    ingreso.sesion.cerrar();

    expect(ingreso.sesion.actual()).toBeUndefined();
    expect(sesionGuardada.datos.has(CLAVE_DE_SESION)).toBe(false);
    expect(resolver('#/perfil', ingreso.sesion.actual())).toMatchObject({ redirigirA: '#/ingresar' });
    expect(ingreso.recordados.lista()).toEqual([{ id: clienteId, nombre: 'Ana Gómez' }]);
    // Sin sesión, el panel manda el pedido sin token y M2 responde 401.
    await expect(apiDeLaSesion().obtenerCliente(clienteId)).rejects.toMatchObject({ estado: 401 });
  });
});
