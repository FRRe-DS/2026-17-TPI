import { describe, expect, it, vi } from 'vitest';
import { ErrorDeApi, m2NoResponde } from '../../../panel/cliente/src/api/errores.js';
import { crearClaveDeIdempotencia } from '../../../panel/cliente/src/logica/clave-idempotencia.js';
import {
  crearAccion,
  type ContextoDeAccion,
  crearCarga,
  estaEsperando,
  reducirAccion,
  reducirCarga,
  type EstadoAccion,
  type EstadoCarga,
} from '../../../panel/cliente/src/logica/estados.js';

const problema = (estado = 503, extra: Partial<ConstructorParameters<typeof ErrorDeApi>[0]> = {}) =>
  new ErrorDeApi({ sinRespuesta: false, estado, type: 'about:blank', title: 'Servicio no disponible', ...extra });

// Una promesa que se resuelve o rechaza cuando el caso lo decide.
function diferida<T>() {
  let resolver!: (valor: T) => void;
  let rechazar!: (error: unknown) => void;
  const promesa = new Promise<T>((a, b) => ((resolver = a), (rechazar = b)));
  return { promesa, resolver, rechazar };
}
const pasar = () => new Promise((listo) => setTimeout(listo, 0));

describe('reducirCarga: cargando → listo | vacio | error (RNF-15)', () => {
  const inicial: EstadoCarga<string[]> = { fase: 'cargando', pedido: 0 };

  it('iniciar pasa a cargando con un pedido nuevo, también desde un error', () => {
    const conError: EstadoCarga<string[]> = { fase: 'error', error: problema(), pedido: 3 };

    expect(reducirCarga(conError, { tipo: 'iniciar' })).toEqual({ fase: 'cargando', pedido: 4 });
  });

  it('llegan datos: listo con los datos', () => {
    expect(reducirCarga(inicial, { tipo: 'llegaron', pedido: 0, datos: ['a'], vacio: false })).toEqual({ fase: 'listo', datos: ['a'], pedido: 0 });
  });

  it('llegan datos vacíos: vacio, que no es un error', () => {
    expect(reducirCarga(inicial, { tipo: 'llegaron', pedido: 0, datos: [], vacio: true })).toEqual({ fase: 'vacio', pedido: 0 });
  });

  it('falla: error con el error completo', () => {
    const error = problema(500, { detail: 'detalle', requestId: 'panel-1' });

    expect(reducirCarga(inicial, { tipo: 'fallo', pedido: 0, error })).toEqual({ fase: 'error', error, pedido: 0 });
  });

  it('el resultado de un pedido viejo no pisa al nuevo', () => {
    const nuevo = reducirCarga(inicial, { tipo: 'iniciar' });

    expect(reducirCarga(nuevo, { tipo: 'llegaron', pedido: 0, datos: ['viejo'], vacio: false })).toBe(nuevo);
    expect(reducirCarga(nuevo, { tipo: 'fallo', pedido: 0, error: problema() })).toBe(nuevo);
  });
});

describe('crearCarga: el hook de carga sin React', () => {
  it('empieza cargando, y al llegar los datos queda listo', async () => {
    const carga = crearCarga({ cargar: async () => ['a', 'b'] });
    expect(carga.estado().fase).toBe('cargando');

    carga.iniciar();
    expect(carga.estado().fase).toBe('cargando');
    await pasar();

    expect(carga.estado()).toMatchObject({ fase: 'listo', datos: ['a', 'b'] });
  });

  it('con esVacio, una lista sin elementos es vacio', async () => {
    const carga = crearCarga({ cargar: async () => ({ items: [] as string[] }), esVacio: (pagina) => pagina.items.length === 0 });

    carga.iniciar();
    await pasar();

    expect(carga.estado().fase).toBe('vacio');
  });

  it('sin esVacio nada es vacio: un perfil o una lista vacía se muestran como datos', async () => {
    const carga = crearCarga({ cargar: async () => [] as string[] });

    carga.iniciar();
    await pasar();

    expect(carga.estado().fase).toBe('listo');
  });

  it('si el pedido falla queda en error con el error de la API', async () => {
    const error = problema(409, { type: '/errores/algo' });
    const carga = crearCarga({ cargar: async () => Promise.reject(error) });

    carga.iniciar();
    await pasar();

    expect(carga.estado()).toMatchObject({ fase: 'error', error });
  });

  it('un error que no es de la API (un bug) también se muestra, como error', async () => {
    const carga = crearCarga({ cargar: async () => Promise.reject(new TypeError('x is undefined')) });

    carga.iniciar();
    await pasar();

    const estado = carga.estado();
    expect(estado.fase).toBe('error');
    expect(estado.fase === 'error' && estado.error).toBeInstanceOf(ErrorDeApi);
  });

  it('«M2 no responde» es un error más, con el mismo «Reintentar»', async () => {
    const carga = crearCarga({ cargar: async () => Promise.reject(m2NoResponde()) });

    carga.iniciar();
    await pasar();

    expect(carga.estado()).toMatchObject({ fase: 'error', error: { sinRespuesta: true } });
  });

  it('reintentar repite el mismo pedido: la misma función, otra vez', async () => {
    const cargar = vi.fn<(senal: AbortSignal) => Promise<string>>().mockRejectedValueOnce(problema()).mockResolvedValue('ok');
    const carga = crearCarga({ cargar });
    carga.iniciar();
    await pasar();
    expect(carga.estado().fase).toBe('error');

    carga.reintentar();
    expect(carga.estado().fase).toBe('cargando');
    await pasar();

    expect(cargar).toHaveBeenCalledTimes(2);
    expect(carga.estado()).toMatchObject({ fase: 'listo', datos: 'ok' });
  });

  it('reintentar cancela el pedido anterior y ignora lo que ese devuelva', async () => {
    const primero = diferida<string>();
    const segundo = diferida<string>();
    const senales: AbortSignal[] = [];
    const cargar = vi.fn((senal: AbortSignal) => (senales.push(senal), senales.length === 1 ? primero.promesa : segundo.promesa));
    const carga = crearCarga({ cargar });
    carga.iniciar();

    carga.reintentar();
    segundo.resolver('nuevo');
    primero.resolver('viejo');
    await pasar();

    expect(senales[0]!.aborted).toBe(true);
    expect(senales[1]!.aborted).toBe(false);
    expect(carga.estado()).toMatchObject({ fase: 'listo', datos: 'nuevo' });
  });

  it('detener cancela el pedido y no avisa a nadie después', async () => {
    const pendiente = diferida<string>();
    let senal!: AbortSignal;
    const carga = crearCarga({ cargar: (s) => ((senal = s), pendiente.promesa) });
    const oyente = vi.fn();
    carga.suscribir(oyente);
    carga.iniciar();
    oyente.mockClear();

    carga.detener();
    pendiente.resolver('tarde');
    await pasar();

    expect(senal.aborted).toBe(true);
    expect(oyente).not.toHaveBeenCalled();
    expect(carga.estado().fase).toBe('cargando');
  });

  it('detener y volver a iniciar (como hace React en desarrollo) deja la carga andando', async () => {
    const carga = crearCarga({ cargar: async () => 'ok' });

    carga.iniciar();
    carga.detener();
    carga.iniciar();
    await pasar();

    expect(carga.estado()).toMatchObject({ fase: 'listo', datos: 'ok' });
  });

  it('avisa a los suscriptos de cada cambio y deja de avisar al darse de baja', async () => {
    const carga = crearCarga({ cargar: async () => 'ok' });
    const oyente = vi.fn();
    const baja = carga.suscribir(oyente);

    carga.iniciar();
    await pasar();
    expect(oyente).toHaveBeenCalled();
    baja();
    oyente.mockClear();
    carga.reintentar();
    await pasar();

    expect(oyente).not.toHaveBeenCalled();
  });

  it('estado() devuelve el mismo objeto mientras nada cambia (lo necesita useSyncExternalStore)', async () => {
    const carga = crearCarga({ cargar: async () => 'ok' });
    carga.iniciar();
    await pasar();

    expect(carga.estado()).toBe(carga.estado());
  });
});

describe('reducirAccion: espera → éxito con aviso | error (RNF-15.2)', () => {
  const inactiva: EstadoAccion<string> = { fase: 'inactiva' };

  it('enviar espera, y mientras espera el control está deshabilitado', () => {
    const esperando = reducirAccion(inactiva, { tipo: 'enviar' });

    expect(esperando).toEqual({ fase: 'esperando' });
    expect(estaEsperando(esperando)).toBe(true);
    expect(estaEsperando(inactiva)).toBe(false);
  });

  it('enviar de nuevo mientras espera no cambia nada (un doble clic envía un solo pedido)', () => {
    const esperando = reducirAccion(inactiva, { tipo: 'enviar' });

    expect(reducirAccion(esperando, { tipo: 'enviar' })).toBe(esperando);
  });

  it('el éxito trae el aviso y el resultado', () => {
    const esperando = reducirAccion(inactiva, { tipo: 'enviar' });

    expect(reducirAccion(esperando, { tipo: 'exito', aviso: 'Guardado', resultado: 'r' })).toEqual({ fase: 'hecha', aviso: 'Guardado', resultado: 'r' });
  });

  it('el fallo trae el error y el control vuelve a quedar habilitado, también si M2 no respondió (RNF-15.4)', () => {
    const esperando = reducirAccion(inactiva, { tipo: 'enviar' });

    for (const error of [problema(), m2NoResponde()]) {
      const fallida = reducirAccion(esperando, { tipo: 'fallo', error });
      expect(fallida).toEqual({ fase: 'fallida', error });
      expect(estaEsperando(fallida)).toBe(false);
    }
  });

  it('un éxito o un fallo que llega sin que se esté esperando se ignora', () => {
    expect(reducirAccion(inactiva, { tipo: 'exito', aviso: 'x', resultado: 'r' })).toBe(inactiva);
    expect(reducirAccion(inactiva, { tipo: 'fallo', error: problema() })).toBe(inactiva);
  });

  it('desde un error o un éxito se puede enviar otra vez; reiniciar vuelve a inactiva', () => {
    const fallida: EstadoAccion<string> = { fase: 'fallida', error: problema() };
    const hecha: EstadoAccion<string> = { fase: 'hecha', aviso: 'ok', resultado: 'r' };

    expect(reducirAccion(fallida, { tipo: 'enviar' })).toEqual({ fase: 'esperando' });
    expect(reducirAccion(hecha, { tipo: 'enviar' })).toEqual({ fase: 'esperando' });
    expect(reducirAccion(hecha, { tipo: 'reiniciar' })).toEqual({ fase: 'inactiva' });
    expect(reducirAccion(fallida, { tipo: 'reiniciar' })).toEqual({ fase: 'inactiva' });
  });
});

describe('crearAccion: el hook de acción sin React', () => {
  it('manda el pedido, espera, y al terminar bien avisa con el texto', async () => {
    const pedido = diferida<{ id: string }>();
    const accion = crearAccion({ ejecutar: () => pedido.promesa, aviso: (r) => `Creado ${r.id}` });

    void accion.enviar();
    expect(accion.estado()).toEqual({ fase: 'esperando' });
    pedido.resolver({ id: 'x' });
    await pasar();

    expect(accion.estado()).toEqual({ fase: 'hecha', aviso: 'Creado x', resultado: { id: 'x' } });
  });

  it('el aviso puede ser un texto fijo', async () => {
    const accion = crearAccion({ ejecutar: async () => undefined, aviso: 'Dirección eliminada' });

    await accion.enviar();

    expect(accion.estado()).toMatchObject({ fase: 'hecha', aviso: 'Dirección eliminada' });
  });

  it('un doble clic manda un solo pedido', async () => {
    const pedido = diferida<string>();
    const ejecutar = vi.fn(() => pedido.promesa);
    const accion = crearAccion({ ejecutar, aviso: 'ok' });

    void accion.enviar();
    void accion.enviar();
    void accion.enviar();
    pedido.resolver('r');
    await pasar();

    expect(ejecutar).toHaveBeenCalledTimes(1);
  });

  it('le pasa a la función los argumentos de enviar', async () => {
    const ejecutar = vi.fn(async (_contexto: unknown, id: string, cuerpo: { motivo: string }) => `${id}:${cuerpo.motivo}`);
    const accion = crearAccion({ ejecutar, aviso: 'ok' });

    await accion.enviar('b-1', { motivo: 'fraude' });

    expect(ejecutar.mock.calls[0]!.slice(1)).toEqual(['b-1', { motivo: 'fraude' }]);
    expect(accion.estado()).toMatchObject({ resultado: 'b-1:fraude' });
  });

  it('si falla, queda en error con el error completo y «Reintentar» repite el mismo pedido con los mismos argumentos', async () => {
    const ejecutar = vi.fn(async (_contexto: unknown, cuerpo: { n: number }) => `ok${cuerpo.n}`).mockRejectedValueOnce(problema(409));
    const accion = crearAccion({ ejecutar, aviso: 'ok' });

    await accion.enviar({ n: 1 });
    expect(accion.estado()).toMatchObject({ fase: 'fallida', error: { estado: 409 } });
    await accion.reintentar();

    expect(ejecutar).toHaveBeenCalledTimes(2);
    expect(ejecutar.mock.calls[1]!.slice(1)).toEqual([{ n: 1 }]);
    expect(accion.estado()).toMatchObject({ fase: 'hecha' });
  });

  it('reintentar sin haber enviado nunca no hace nada', async () => {
    const ejecutar = vi.fn<(contexto: ContextoDeAccion) => Promise<string>>().mockResolvedValue('ok');
    const accion = crearAccion({ ejecutar, aviso: 'ok' });

    await accion.reintentar();

    expect(ejecutar).not.toHaveBeenCalled();
  });

  it('reiniciar saca el aviso o el error de la pantalla', async () => {
    const accion = crearAccion({ ejecutar: async () => 'ok', aviso: 'Listo' });
    await accion.enviar();

    accion.reiniciar();

    expect(accion.estado()).toEqual({ fase: 'inactiva' });
  });

  it('una acción que termina después de detener no cambia el estado ni avisa', async () => {
    const pedido = diferida<string>();
    const accion = crearAccion({ ejecutar: () => pedido.promesa, aviso: 'ok' });
    const oyente = vi.fn();
    void accion.enviar();
    accion.suscribir(oyente);

    accion.detener();
    pedido.resolver('tarde');
    await pasar();

    expect(oyente).not.toHaveBeenCalled();
  });

  it('estado() devuelve el mismo objeto mientras nada cambia', async () => {
    const accion = crearAccion({ ejecutar: async () => 'ok', aviso: 'ok' });
    await accion.enviar();

    expect(accion.estado()).toBe(accion.estado());
  });
});

describe('logica/clave-idempotencia.ts (RF-2.5.15)', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('sin abrir no hay clave', () => {
    expect(crearClaveDeIdempotencia().actual()).toBeUndefined();
  });

  it('abrir genera una clave (un UUID v4) y actual() devuelve la misma mientras no se descarte', () => {
    const clave = crearClaveDeIdempotencia();

    const generada = clave.abrir();

    expect(generada).toMatch(UUID);
    expect(clave.actual()).toBe(generada);
    expect(clave.actual()).toBe(generada);
  });

  it('abrir otra vez, como el formulario que se abre de nuevo, genera una clave distinta', () => {
    const clave = crearClaveDeIdempotencia();

    expect(clave.abrir()).not.toBe(clave.abrir());
  });

  it('descartar la saca: después de un éxito o al cerrar, la clave no sirve más', () => {
    const clave = crearClaveDeIdempotencia();
    clave.abrir();

    clave.descartar();

    expect(clave.actual()).toBeUndefined();
  });

  it('obtener devuelve la clave abierta, o abre una si no hay (el envío siguiente a un éxito no reusa la vieja)', () => {
    const clave = crearClaveDeIdempotencia();
    const primera = clave.obtener();
    expect(clave.obtener()).toBe(primera);

    clave.descartar();
    const segunda = clave.obtener();

    expect(segunda).toMatch(UUID);
    expect(segunda).not.toBe(primera);
  });

  it('el generador es el que se le pasa, para probar con claves conocidas', () => {
    const claves = ['k1', 'k2'];
    const clave = crearClaveDeIdempotencia(() => claves.shift()!);

    expect(clave.abrir()).toBe('k1');
    expect(clave.abrir()).toBe('k2');
  });
});

describe('la acción con clave de idempotencia (RF-2.5.15, RNF-15.2)', () => {
  const clavesEnviadas = (ejecutar: { mock: { calls: unknown[][] } }) =>
    ejecutar.mock.calls.map((llamada) => (llamada[0] as ContextoDeAccion).clave);
  const crear = (ejecutar: (contexto: ContextoDeAccion) => Promise<string>) => {
    let n = 0;
    const clave = crearClaveDeIdempotencia(() => `clave-${++n}`);
    const accion = crearAccion({ ejecutar, aviso: 'Enviado', clave });
    return { clave, accion };
  };

  it('el envío usa la clave abierta al abrir el formulario', async () => {
    const ejecutar = vi.fn<(contexto: ContextoDeAccion) => Promise<string>>().mockResolvedValue('ok');
    const { clave, accion } = crear(ejecutar);
    clave.abrir();

    await accion.enviar();

    expect(ejecutar.mock.calls[0]![0]).toMatchObject({ clave: 'clave-1' });
  });

  it('ante un error se conserva y «Reintentar» manda la misma clave', async () => {
    const ejecutar = vi.fn<(contexto: ContextoDeAccion) => Promise<string>>().mockResolvedValue('ok').mockRejectedValueOnce(problema());
    const { clave, accion } = crear(ejecutar);
    clave.abrir();

    await accion.enviar();
    expect(clave.actual()).toBe('clave-1');
    await accion.reintentar();

    expect(clavesEnviadas(ejecutar)).toEqual(['clave-1', 'clave-1']);
  });

  it('ante «M2 no responde» (tiempo agotado) también se conserva: M2 pudo haber guardado el envío', async () => {
    const ejecutar = vi.fn<(contexto: ContextoDeAccion) => Promise<string>>().mockResolvedValue('ok').mockRejectedValueOnce(m2NoResponde());
    const { clave, accion } = crear(ejecutar);
    clave.abrir();

    await accion.enviar();
    await accion.reintentar();

    expect(clave.actual()).toBeUndefined();
    expect(clavesEnviadas(ejecutar)).toEqual(['clave-1', 'clave-1']);
  });

  it('tras un éxito se descarta, y el envío siguiente usa una clave nueva', async () => {
    const ejecutar = vi.fn<(contexto: ContextoDeAccion) => Promise<string>>().mockResolvedValue('ok');
    const { clave, accion } = crear(ejecutar);
    clave.abrir();

    await accion.enviar();
    expect(clave.actual()).toBeUndefined();
    await accion.enviar();

    expect(clavesEnviadas(ejecutar)).toEqual(['clave-1', 'clave-2']);
  });

  it('al cerrar el formulario se descarta aunque el último envío haya fallado', async () => {
    const ejecutar = vi.fn<(contexto: ContextoDeAccion) => Promise<string>>().mockResolvedValue('ok').mockRejectedValueOnce(problema());
    const { clave, accion } = crear(ejecutar);
    clave.abrir();
    await accion.enviar();

    clave.descartar();
    await accion.enviar();

    expect(ejecutar.mock.calls[1]![0]).toMatchObject({ clave: 'clave-2' });
  });

  it('una acción sin clave (las que no son altas) le pasa clave indefinida', async () => {
    const ejecutar = vi.fn<(contexto: ContextoDeAccion) => Promise<string>>().mockResolvedValue('ok');
    const accion = crearAccion({ ejecutar, aviso: 'ok' });

    await accion.enviar();

    expect(clavesEnviadas(ejecutar)).toEqual([undefined]);
  });
});
