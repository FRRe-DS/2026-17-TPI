import { describe, expect, it, vi } from 'vitest';
import { ErrorDeApi } from '../../../panel/cliente/src/api/errores.js';
import type { ApiM2 } from '../../../panel/cliente/src/api/m2.js';
import type { FuenteDeViajes } from '../../../panel/cliente/src/fuentes/viajes-simulados.js';
import {
  cargarEjemplo,
  claveDeDireccionDeEjemplo,
  DIRECCIONES_DE_EJEMPLO,
  PASOS,
  pasosIniciales,
  PREFERENCIAS_DE_EJEMPLO,
  resumenDeFallo,
  type InformeDePaso,
} from '../../../panel/cliente/src/logica/ejemplo.js';

// «Cargar ejemplo» (T21, RF-2.1.10, RF-2.1.11): los pasos, sus claves fijas y qué pasa cuando uno falla. La comprobación contra M2
// real, en `pruebas/panel/integracion/pantalla-ejemplo.test.ts`.

const CLIENTE = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const OTRO = '9e8d7c6b-5a49-4382-9716-0f1e2d3c4b5a';
const ESCENARIOS = [{ nombre: 'completado' as const, viajeId: 'v-1', respuestaDeM2: 201 as const }];
const SIN_RESPUESTA = new ErrorDeApi({ sinRespuesta: false, estado: 502, type: '/panel/errores/m6-control-no-responde', title: 'Canal de control del M6 simulado no disponible' });
const RECHAZO = new ErrorDeApi({ sinRespuesta: false, estado: 400, type: 'about:blank', title: 'Solicitud inválida', detail: 'texto: demasiado largo' });

// Las llamadas de cada fuente, en el orden en que llegaron, para ver también el orden entre M2 y M6.
function entorno(fallos: { direccion?: number; preferencias?: boolean; viajes?: boolean } = {}) {
  const llamadas: string[] = [];
  const crearDireccion = vi.fn(async (_cliente: string, _cuerpo: unknown, clave: string) => {
    llamadas.push(`direccion:${clave}`);
    if (fallos.direccion !== undefined && clave.startsWith(`ejemplo-dir-${fallos.direccion}-`)) throw RECHAZO;
    return { direccionId: 'd', ...(_cuerpo as object) };
  });
  const guardarPreferencias = vi.fn(async (_cliente: string, cuerpo: unknown) => {
    llamadas.push('preferencias');
    if (fallos.preferencias) throw RECHAZO;
    return cuerpo;
  });
  const cargarEjemploDeViajes = vi.fn(async (cliente: string) => {
    llamadas.push(`viajes:${cliente}`);
    if (fallos.viajes) throw SIN_RESPUESTA;
    return { clienteId: cliente, escenarios: ESCENARIOS };
  });
  const api = { crearDireccion, guardarPreferencias } as unknown as ApiM2;
  const viajes = { etiqueta: 'simulado', cargarEjemplo: cargarEjemploDeViajes } as unknown as FuenteDeViajes;
  return { api, viajes, llamadas, crearDireccion, guardarPreferencias, cargarEjemploDeViajes };
}

const estados = (pasos: InformeDePaso[]) => pasos.map((paso) => `${paso.id}:${paso.estado}`);

describe('los datos de ejemplo (RF-2.1.10)', () => {
  it('tres direcciones: una FAVORITA y dos RECIENTE, dentro de los límites del contrato', () => {
    expect(DIRECCIONES_DE_EJEMPLO.map((d) => d.tipo)).toEqual(['FAVORITA', 'RECIENTE', 'RECIENTE']);
    for (const d of DIRECCIONES_DE_EJEMPLO) {
      expect(d.texto.length).toBeGreaterThanOrEqual(1);
      expect(d.texto.length).toBeLessThanOrEqual(255);
      expect((d.alias ?? '').length).toBeLessThanOrEqual(50);
    }
  });

  it('unas preferencias con valores del contrato', () => {
    expect(PREFERENCIAS_DE_EJEMPLO).toMatchObject({ tiposVehiculo: ['AUTO'], canales: ['EMAIL', 'PUSH'], accesibilidad: [] });
  });

  it('la clave de cada dirección es fija por número y por cliente (RF-2.1.11)', () => {
    expect(claveDeDireccionDeEjemplo(1, CLIENTE)).toBe(`ejemplo-dir-1-${CLIENTE}`);
    expect(claveDeDireccionDeEjemplo(2, CLIENTE)).not.toBe(claveDeDireccionDeEjemplo(1, CLIENTE));
    expect(claveDeDireccionDeEjemplo(1, OTRO)).not.toBe(claveDeDireccionDeEjemplo(1, CLIENTE));
    for (const n of [1, 2, 3]) expect(claveDeDireccionDeEjemplo(n, CLIENTE).length).toBeLessThanOrEqual(128);
  });

  it('cinco pasos, en el orden de la pantalla, todos pendientes al empezar', () => {
    expect(PASOS.map((p) => p.id)).toEqual(['direccion-1', 'direccion-2', 'direccion-3', 'preferencias', 'viajes']);
    expect(estados(pasosIniciales())).toEqual(['direccion-1:pendiente', 'direccion-2:pendiente', 'direccion-3:pendiente', 'preferencias:pendiente', 'viajes:pendiente']);
  });
});

describe('cargarEjemplo: los pasos en orden (RF-2.1.10)', () => {
  it('tres direcciones con sus claves, las preferencias y los viajes del M6, en ese orden', async () => {
    const { api, viajes, llamadas, crearDireccion, guardarPreferencias } = entorno();

    const resultado = await cargarEjemplo({ api, viajes }, CLIENTE, () => undefined);

    expect(llamadas).toEqual([
      `direccion:ejemplo-dir-1-${CLIENTE}`,
      `direccion:ejemplo-dir-2-${CLIENTE}`,
      `direccion:ejemplo-dir-3-${CLIENTE}`,
      'preferencias',
      `viajes:${CLIENTE}`,
    ]);
    expect(crearDireccion.mock.calls.map(([cliente, cuerpo]) => [cliente, cuerpo])).toEqual(DIRECCIONES_DE_EJEMPLO.map((d) => [CLIENTE, d]));
    expect(guardarPreferencias).toHaveBeenCalledExactlyOnceWith(CLIENTE, PREFERENCIAS_DE_EJEMPLO, expect.anything());
    expect(resultado).toEqual({ escenarios: ESCENARIOS });
  });

  it('informa cada paso: en curso y hecho, de a uno', async () => {
    const { api, viajes } = entorno();
    const vistos: string[][] = [];

    await cargarEjemplo({ api, viajes }, CLIENTE, (pasos) => vistos.push(estados(pasos)));

    expect(vistos[0]).toEqual(['direccion-1:en-curso', 'direccion-2:pendiente', 'direccion-3:pendiente', 'preferencias:pendiente', 'viajes:pendiente']);
    expect(vistos[1]).toEqual(['direccion-1:hecho', 'direccion-2:pendiente', 'direccion-3:pendiente', 'preferencias:pendiente', 'viajes:pendiente']);
    expect(vistos.at(-1)).toEqual(['direccion-1:hecho', 'direccion-2:hecho', 'direccion-3:hecho', 'preferencias:hecho', 'viajes:hecho']);
    expect(vistos).toHaveLength(10);
  });

  it('pasa la señal a cada pedido', async () => {
    const { api, viajes, crearDireccion, cargarEjemploDeViajes } = entorno();
    const senal = new AbortController().signal;

    await cargarEjemplo({ api, viajes }, CLIENTE, () => undefined, senal);

    expect(crearDireccion.mock.calls.every((llamada) => llamada[3] && (llamada[3] as { senal: AbortSignal }).senal === senal)).toBe(true);
    expect(cargarEjemploDeViajes).toHaveBeenCalledWith(CLIENTE, senal);
  });
});

describe('un fallo deja lo demás hecho y se puede reintentar (RF-2.1.11)', () => {
  it('si falla el M6, direcciones y preferencias quedan hechas, el paso de viajes queda fallido y el error llega tal cual', async () => {
    const { api, viajes } = entorno({ viajes: true });
    let ultimo: InformeDePaso[] = [];

    await expect(cargarEjemplo({ api, viajes }, CLIENTE, (pasos) => (ultimo = pasos))).rejects.toBe(SIN_RESPUESTA);

    expect(estados(ultimo)).toEqual(['direccion-1:hecho', 'direccion-2:hecho', 'direccion-3:hecho', 'preferencias:hecho', 'viajes:fallido']);
  });

  it('reintentar repite todos los pasos con las mismas claves y completa los viajes', async () => {
    const primero = entorno({ viajes: true });
    await cargarEjemplo({ api: primero.api, viajes: primero.viajes }, CLIENTE, () => undefined).catch(() => undefined);
    const segundo = entorno();

    await cargarEjemplo({ api: segundo.api, viajes: segundo.viajes }, CLIENTE, () => undefined);

    const clavesDe = (llamadas: string[]) => llamadas.filter((l) => l.startsWith('direccion:'));
    expect(clavesDe(segundo.llamadas)).toEqual(clavesDe(primero.llamadas));
    expect(segundo.cargarEjemploDeViajes).toHaveBeenCalledOnce();
  });

  it('si falla una dirección, se detiene ahí: lo que sigue queda pendiente y no se llama al M6', async () => {
    const { api, viajes, llamadas, cargarEjemploDeViajes } = entorno({ direccion: 2 });
    let ultimo: InformeDePaso[] = [];

    await expect(cargarEjemplo({ api, viajes }, CLIENTE, (pasos) => (ultimo = pasos))).rejects.toBe(RECHAZO);

    expect(estados(ultimo)).toEqual(['direccion-1:hecho', 'direccion-2:fallido', 'direccion-3:pendiente', 'preferencias:pendiente', 'viajes:pendiente']);
    expect(llamadas).toHaveLength(2);
    expect(cargarEjemploDeViajes).not.toHaveBeenCalled();
  });

  it('si fallan las preferencias, las direcciones quedan hechas y no se llama al M6', async () => {
    const { api, viajes, cargarEjemploDeViajes } = entorno({ preferencias: true });
    let ultimo: InformeDePaso[] = [];

    await expect(cargarEjemplo({ api, viajes }, CLIENTE, (pasos) => (ultimo = pasos))).rejects.toBe(RECHAZO);

    expect(estados(ultimo)).toEqual(['direccion-1:hecho', 'direccion-2:hecho', 'direccion-3:hecho', 'preferencias:fallido', 'viajes:pendiente']);
    expect(cargarEjemploDeViajes).not.toHaveBeenCalled();
  });
});

describe('resumenDeFallo: lo que se le dice a la persona si la carga se cortó', () => {
  const con = (...estados: InformeDePaso['estado'][]): InformeDePaso[] => PASOS.map(({ id }, i) => ({ id, estado: estados[i] ?? 'pendiente' }));

  it('sin fallo no hay mensaje', () => {
    expect(resumenDeFallo(con('hecho', 'hecho', 'hecho', 'hecho', 'hecho'))).toBeUndefined();
  });

  it('si falló el M6, lo dice, cuenta lo hecho y aclara que reintentar no repite', () => {
    const mensaje = resumenDeFallo(con('hecho', 'hecho', 'hecho', 'hecho', 'fallido'));

    expect(mensaje).toContain('Los viajes no se pudieron registrar en el M6 simulado.');
    expect(mensaje).toContain('Quedaron cargados 4 de 5 pasos.');
    expect(mensaje).toContain('Reintentar es seguro');
  });

  it('si falló el primer paso, no quedó nada', () => {
    expect(resumenDeFallo(con('fallido'))).toContain('No quedó cargado nada.');
  });
});
