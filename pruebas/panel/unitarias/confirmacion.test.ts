import { describe, expect, it, vi } from 'vitest';
import { ErrorDeApi } from '../../../panel/cliente/src/api/errores.js';
import { crearConfirmacion } from '../../../panel/cliente/src/logica/confirmacion.js';

// La confirmación de lo que no se deshace (T23, RF-2.2.7): pedirla no llama a M2, «Cancelar» tampoco, y solo «Eliminar» hace el pedido.

const DIRECCION = { direccionId: 'd-1', texto: 'Calle 1' };
const OTRA = { direccionId: 'd-2', texto: 'Calle 2' };
const RECHAZO = new ErrorDeApi({ sinRespuesta: false, estado: 404, type: 'about:blank', title: 'No encontrado' });

function confirmacion(ejecutar = vi.fn().mockResolvedValue(undefined)) {
  const controlador = crearConfirmacion<typeof DIRECCION, void>({ ejecutar, aviso: 'Dirección eliminada.' });
  return { controlador, ejecutar };
}
// Una promesa que se resuelve o rechaza cuando se lo indica: para ver el estado «esperando».
function abierta<T = void>() {
  let resolver!: (valor: T) => void;
  let rechazar!: (error: unknown) => void;
  const promesa = new Promise<T>((a, b) => ((resolver = a), (rechazar = b)));
  return { promesa, resolver, rechazar };
}

describe('pedir y cancelar no llaman a M2', () => {
  it('al empezar no hay nada que confirmar', () => {
    const { controlador } = confirmacion();

    expect(controlador.estado()).toEqual({ objetivo: undefined, accion: { fase: 'inactiva' } });
  });

  it('pedir deja el objetivo a la vista y no hace ningún pedido', () => {
    const { controlador, ejecutar } = confirmacion();

    controlador.pedir(DIRECCION);

    expect(controlador.estado().objetivo).toBe(DIRECCION);
    expect(ejecutar).not.toHaveBeenCalled();
  });

  it('cancelar cierra sin hacer ningún pedido', () => {
    const { controlador, ejecutar } = confirmacion();
    controlador.pedir(DIRECCION);

    controlador.cancelar();

    expect(controlador.estado()).toEqual({ objetivo: undefined, accion: { fase: 'inactiva' } });
    expect(ejecutar).not.toHaveBeenCalled();
  });

  it('pedir otro objetivo reemplaza al anterior', () => {
    const { controlador } = confirmacion();
    controlador.pedir(DIRECCION);

    controlador.pedir(OTRA);

    expect(controlador.estado().objetivo).toBe(OTRA);
  });

  it('confirmar sin haber pedido nada no hace nada', async () => {
    const { controlador, ejecutar } = confirmacion();

    await controlador.confirmar();

    expect(ejecutar).not.toHaveBeenCalled();
  });
});

describe('confirmar hace un solo pedido', () => {
  it('llama con el objetivo y una señal; al terminar bien cierra y deja el aviso', async () => {
    const { controlador, ejecutar } = confirmacion();
    controlador.pedir(DIRECCION);

    await controlador.confirmar();

    expect(ejecutar).toHaveBeenCalledExactlyOnceWith(DIRECCION, expect.any(AbortSignal));
    expect(controlador.estado().objetivo).toBeUndefined();
    expect(controlador.estado().accion).toMatchObject({ fase: 'hecha', aviso: 'Dirección eliminada.' });
  });

  it('un doble clic manda un solo pedido', async () => {
    const pedido = abierta();
    const { controlador, ejecutar } = confirmacion(vi.fn().mockReturnValue(pedido.promesa));
    controlador.pedir(DIRECCION);

    const primero = controlador.confirmar();
    const segundo = controlador.confirmar();
    pedido.resolver();
    await Promise.all([primero, segundo]);

    expect(ejecutar).toHaveBeenCalledOnce();
  });

  it('mientras espera, queda abierto y esperando; cancelar y pedir otro se ignoran', async () => {
    const pedido = abierta();
    const { controlador } = confirmacion(vi.fn().mockReturnValue(pedido.promesa));
    controlador.pedir(DIRECCION);

    const enCurso = controlador.confirmar();
    controlador.cancelar();
    controlador.pedir(OTRA);

    expect(controlador.estado()).toEqual({ objetivo: DIRECCION, accion: { fase: 'esperando' } });
    pedido.resolver();
    await enCurso;
    expect(controlador.estado().objetivo).toBeUndefined();
  });
});

describe('si M2 rechaza', () => {
  it('queda abierto con el error tal cual, y confirmar de nuevo repite el pedido sobre el mismo objetivo', async () => {
    const ejecutar = vi.fn().mockRejectedValueOnce(RECHAZO).mockResolvedValueOnce(undefined);
    const { controlador } = confirmacion(ejecutar);
    controlador.pedir(DIRECCION);

    await controlador.confirmar();

    expect(controlador.estado()).toEqual({ objetivo: DIRECCION, accion: { fase: 'fallida', error: RECHAZO } });

    await controlador.confirmar();

    expect(ejecutar).toHaveBeenCalledTimes(2);
    expect(ejecutar.mock.calls.map(([objetivo]) => objetivo)).toEqual([DIRECCION, DIRECCION]);
    expect(controlador.estado().objetivo).toBeUndefined();
  });

  it('cancelar después del error cierra y limpia el error', async () => {
    const { controlador } = confirmacion(vi.fn().mockRejectedValue(RECHAZO));
    controlador.pedir(DIRECCION);
    await controlador.confirmar();

    controlador.cancelar();

    expect(controlador.estado()).toEqual({ objetivo: undefined, accion: { fase: 'inactiva' } });
  });

  it('pedir de nuevo después del error empieza limpio', async () => {
    const { controlador } = confirmacion(vi.fn().mockRejectedValue(RECHAZO));
    controlador.pedir(DIRECCION);
    await controlador.confirmar();

    controlador.pedir(OTRA);

    expect(controlador.estado()).toEqual({ objetivo: OTRA, accion: { fase: 'inactiva' } });
  });
});

describe('para React: suscripción y estado estable', () => {
  it('avisa a quien se suscribe en cada cambio y deja de avisar al darse de baja', () => {
    const { controlador } = confirmacion();
    const oyente = vi.fn();
    const baja = controlador.suscribir(oyente);

    controlador.pedir(DIRECCION);
    controlador.cancelar();
    baja();
    controlador.pedir(DIRECCION);

    expect(oyente).toHaveBeenCalledTimes(2);
  });

  it('el estado es el mismo objeto mientras no cambia nada (lo exige useSyncExternalStore)', () => {
    const { controlador } = confirmacion();
    controlador.pedir(DIRECCION);

    expect(controlador.estado()).toBe(controlador.estado());
  });

  it('al salir de la pantalla, detener cancela el pedido en curso y no avisa más', async () => {
    const pedido = abierta();
    let senal: AbortSignal | undefined;
    const { controlador } = confirmacion(vi.fn().mockImplementation((_objetivo, s: AbortSignal) => ((senal = s), pedido.promesa)));
    const oyente = vi.fn();
    controlador.pedir(DIRECCION);
    const enCurso = controlador.confirmar();
    controlador.suscribir(oyente);

    controlador.detener();
    pedido.resolver();
    await enCurso;

    expect(senal?.aborted).toBe(true);
    expect(oyente).not.toHaveBeenCalled();
  });
});
