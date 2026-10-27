import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ErrorDeApi } from '../../../panel/cliente/src/api/errores.js';
import type { ApiM2 } from '../../../panel/cliente/src/api/m2.js';
import { cuerpoDeBloqueo, cuerpoDeLevantamiento, mensajeDeBloqueo } from '../../../panel/cliente/src/logica/bloqueos.js';
import { CLIENTE_DE_EJEMPLO, cuerpoDeAlta } from '../../../panel/cliente/src/logica/campos-cliente.js';
import { crearClaveDeIdempotencia } from '../../../panel/cliente/src/logica/clave-idempotencia.js';
import { estadoDeBloqueo } from '../../../panel/cliente/src/logica/cuenta.js';
import { crearAccion } from '../../../panel/cliente/src/logica/estados.js';
import { levantarPanelConM2, type PanelConM2 } from '../ayudas/panel-con-m2.js';

// La vista del operador (T29, RF-2.6.6) contra el panel de verdad: PostgreSQL, M2 y el servidor del panel, con el cliente de M2 que
// usa la pantalla pidiendo como OPERADOR.

let panel: PanelConM2;
beforeAll(async () => {
  panel = await levantarPanelConM2();
});
afterAll(async () => {
  await panel?.cerrar();
});

const SUB_OPERADOR = 'operador-1';
const operador = () => panel.api(() => ({ rol: 'OPERADOR', sub: SUB_OPERADOR }));

async function clienteNuevo(): Promise<{ clienteId: string; api: ApiM2 }> {
  const clienteId = randomUUID();
  const api = panel.api(() => ({ rol: 'CLIENTE', sub: clienteId }));
  await api.crearCliente(cuerpoDeAlta(CLIENTE_DE_EJEMPLO), randomUUID());
  return { clienteId, api };
}

const rechazo = async (promesa: Promise<unknown>): Promise<ErrorDeApi> => {
  const error = await promesa.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ErrorDeApi);
  return error as ErrorDeApi;
};

describe('buscar un cliente y ver su cuenta (RF-2.6.6)', () => {
  it('por su UUID: el estado de cuenta y el historial de bloqueos, vacío al principio', async () => {
    const { clienteId } = await clienteNuevo();
    const op = operador();

    expect(await op.obtenerEstadoCuenta(clienteId)).toEqual({ clienteId, estado: 'ACTIVO', bloqueosVigentes: [] });
    expect(await op.listarBloqueos(clienteId)).toMatchObject({ items: [], totalElementos: 0 });
  });

  it('un UUID que no existe da 404', async () => {
    const error = await rechazo(operador().obtenerEstadoCuenta(randomUUID()));

    expect(error.estado).toBe(404);
  });

  it('un cliente no puede listar bloqueos (403): es del operador', async () => {
    const { clienteId, api } = await clienteNuevo();

    await expect(api.listarBloqueos(clienteId)).rejects.toMatchObject({ estado: 403 });
  });
});

describe('bloquear y levantar, con el estado actualizado tras cada acción (RF-2.6.6)', () => {
  it('bloquear pasa el cliente a BLOQUEADO y el bloqueo queda en el historial como vigente', async () => {
    const { clienteId } = await clienteNuevo();
    const op = operador();

    const creado = await op.crearBloqueo(clienteId, cuerpoDeBloqueo({ motivo: ' Fraude ', hasta: '' }), randomUUID());

    expect(creado).toMatchObject({ motivo: 'Fraude', vigente: true, creadoPor: SUB_OPERADOR });
    expect(creado).not.toHaveProperty('hasta');
    expect((await op.obtenerEstadoCuenta(clienteId)).estado).toBe('BLOQUEADO');
    const { items } = await op.listarBloqueos(clienteId);
    expect(items.map((b) => [b.bloqueoId, estadoDeBloqueo(b)])).toEqual([[creado.bloqueoId, 'vigente']]);
  });

  it('con fin: lo guarda como instante', async () => {
    const { clienteId } = await clienteNuevo();
    const cuerpo = cuerpoDeBloqueo({ motivo: 'Revisión', hasta: '2099-06-01T10:30' });

    const creado = await operador().crearBloqueo(clienteId, cuerpo, randomUUID());

    expect(Date.parse(creado.hasta!)).toBe(Date.parse(cuerpo.hasta!));
  });

  it('levantar vuelve al cliente a ACTIVO y el bloqueo queda en el historial como levantado, con quién, cuándo y por qué', async () => {
    const { clienteId } = await clienteNuevo();
    const op = operador();
    const creado = await op.crearBloqueo(clienteId, { motivo: 'Fraude' }, randomUUID());

    const levantado = await op.levantarBloqueo(clienteId, creado.bloqueoId, cuerpoDeLevantamiento({ motivo: ' Resuelto ' }));

    expect(levantado).toMatchObject({ vigente: false, levantadoPor: SUB_OPERADOR, motivoLevantamiento: 'Resuelto' });
    expect(levantado.levantadoEn).toBeTruthy();
    expect(await op.obtenerEstadoCuenta(clienteId)).toEqual({ clienteId, estado: 'ACTIVO', bloqueosVigentes: [] });
    expect((await op.listarBloqueos(clienteId)).items.map(estadoDeBloqueo)).toEqual(['levantado']);
  });

  it('el historial se pagina y trae vigentes y levantados', async () => {
    const { clienteId } = await clienteNuevo();
    const op = operador();
    const primero = await op.crearBloqueo(clienteId, { motivo: 'Uno' }, randomUUID());
    await op.crearBloqueo(clienteId, { motivo: 'Dos' }, randomUUID());
    await op.crearBloqueo(clienteId, { motivo: 'Tres' }, randomUUID());
    await op.levantarBloqueo(clienteId, primero.bloqueoId, { motivo: 'Listo' });

    const uno = await op.listarBloqueos(clienteId, { page: 0, size: 2 });
    const dos = await op.listarBloqueos(clienteId, { page: 1, size: 2 });

    expect([uno.totalElementos, uno.totalPaginas, uno.items.length, dos.items.length]).toEqual([3, 2, 2, 1]);
    expect([...uno.items, ...dos.items].map(estadoDeBloqueo).sort()).toEqual(['levantado', 'vigente', 'vigente']);
  });

  it('un bloqueo con fecha que ya pasó figura como vencido y no se puede levantar (409)', async () => {
    const { clienteId } = await clienteNuevo();
    const op = operador();
    const creado = await op.crearBloqueo(clienteId, { motivo: 'Breve', hasta: new Date(Date.now() + 700).toISOString() }, randomUUID());
    await new Promise((resolver) => setTimeout(resolver, 900));

    const { items } = await op.listarBloqueos(clienteId);
    const error = await rechazo(op.levantarBloqueo(clienteId, creado.bloqueoId, { motivo: 'Tarde' }));

    expect(items.map(estadoDeBloqueo)).toEqual(['vencido']);
    expect(error).toMatchObject({ estado: 409, type: '/errores/bloqueo-no-vigente' });
    expect(mensajeDeBloqueo(error)).toContain('ya venció');
    expect((await op.obtenerEstadoCuenta(clienteId)).estado).toBe('ACTIVO');
  });
});

describe('lo que M2 rechaza, con su texto', () => {
  it('409: levantar dos veces el mismo bloqueo', async () => {
    const { clienteId } = await clienteNuevo();
    const op = operador();
    const creado = await op.crearBloqueo(clienteId, { motivo: 'Fraude' }, randomUUID());
    await op.levantarBloqueo(clienteId, creado.bloqueoId, { motivo: 'Uno' });

    const error = await rechazo(op.levantarBloqueo(clienteId, creado.bloqueoId, { motivo: 'Dos' }));

    expect(error).toMatchObject({ estado: 409, type: '/errores/bloqueo-ya-levantado' });
    expect(mensajeDeBloqueo(error)).toBe('Ese bloqueo ya estaba levantado.');
  });

  it('422: un fin que ya pasó', async () => {
    const { clienteId } = await clienteNuevo();

    const error = await rechazo(operador().crearBloqueo(clienteId, { motivo: 'X', hasta: '2001-01-01T00:00:00.000Z' }, randomUUID()));

    expect(error).toMatchObject({ estado: 422, type: '/errores/bloqueo-vencido' });
    expect(mensajeDeBloqueo(error)).toBe('El fin del bloqueo tiene que ser posterior a ahora.');
  });

  it('404: bloquear o levantar sobre algo que no existe', async () => {
    const { clienteId } = await clienteNuevo();
    const op = operador();

    const sinCliente = await rechazo(op.crearBloqueo(randomUUID(), { motivo: 'X' }, randomUUID()));
    const sinBloqueo = await rechazo(op.levantarBloqueo(clienteId, randomUUID(), { motivo: 'X' }));

    expect([sinCliente.estado, sinBloqueo.estado]).toEqual([404, 404]);
    expect(mensajeDeBloqueo(sinBloqueo)).toBe('No se encontró el cliente o el bloqueo.');
  });

  it('403: un cliente no puede bloquear', async () => {
    const { clienteId, api } = await clienteNuevo();

    await expect(api.crearBloqueo(clienteId, { motivo: 'X' }, randomUUID())).rejects.toMatchObject({ estado: 403 });
  });
});

// Lo que hace el formulario de bloqueo al enviar: la acción con la clave que genera al abrirse, como la arma `pantallas/operador.tsx`.
function formulario(api: ApiM2, clienteId: string) {
  const claves: (string | undefined)[] = [];
  const clave = crearClaveDeIdempotencia();
  clave.abrir();
  const accion = crearAccion({
    ejecutar: ({ clave: idempotencia, senal }, motivo: string) => {
      claves.push(idempotencia);
      return api.crearBloqueo(clienteId, cuerpoDeBloqueo({ motivo, hasta: '' }), idempotencia!, { senal });
    },
    aviso: 'Bloqueo registrado.',
    clave,
  });
  return { accion, claves, clave };
}

describe('la Idempotency-Key del formulario de bloqueo (RF-2.6.6)', () => {
  it('un envío que llegó a M2 pero cuya respuesta se perdió se reintenta con la misma clave: queda un solo bloqueo', async () => {
    const { clienteId } = await clienteNuevo();
    const op = operador();
    const { accion, claves, clave } = formulario(op, clienteId);
    const original = op.crearBloqueo.bind(op);
    vi.spyOn(op, 'crearBloqueo').mockImplementationOnce(async (...argumentos) => {
      await original(...argumentos);
      throw new ErrorDeApi({ sinRespuesta: true, estado: 504, type: '/panel/errores/m2-no-responde', title: 'M2 no responde' });
    });

    await accion.enviar('Fraude');
    expect(accion.estado()).toMatchObject({ fase: 'fallida', error: { sinRespuesta: true } });
    expect(clave.actual()).toBe(claves[0]);
    await accion.reintentar();

    expect(accion.estado()).toMatchObject({ fase: 'hecha' });
    expect(claves[1]).toBe(claves[0]);
    expect((await op.listarBloqueos(clienteId)).totalElementos).toBe(1);
    expect(clave.actual()).toBeUndefined();
  });

  it('dos toques seguidos mandan un solo pedido', async () => {
    const { clienteId } = await clienteNuevo();
    const op = operador();
    const { accion } = formulario(op, clienteId);
    const pedido = vi.spyOn(op, 'crearBloqueo');

    await Promise.all([accion.enviar('Fraude'), accion.enviar('Fraude')]);

    expect(pedido).toHaveBeenCalledTimes(1);
    expect((await op.listarBloqueos(clienteId)).totalElementos).toBe(1);
  });

  it('la misma clave con otro motivo es una clave reutilizada (422)', async () => {
    const { clienteId } = await clienteNuevo();
    const op = operador();
    const clave = randomUUID();
    await op.crearBloqueo(clienteId, { motivo: 'Uno' }, clave);

    const error = await rechazo(op.crearBloqueo(clienteId, { motivo: 'Otro' }, clave));

    expect(error).toMatchObject({ estado: 422, type: '/errores/idempotencia-reutilizada' });
    expect(mensajeDeBloqueo(error)).toContain('ya se registró con otros datos');
    expect((await op.listarBloqueos(clienteId)).totalElementos).toBe(1);
  });
});
