import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorDeApi } from '../../../panel/cliente/src/api/errores.js';
import type { ApiM2 } from '../../../panel/cliente/src/api/m2.js';
import { CLIENTE_DE_EJEMPLO, cuerpoDeAlta } from '../../../panel/cliente/src/logica/campos-cliente.js';
import {
  camposDeDireccion,
  cuerpoDeDireccion,
  DIRECCION_NUEVA,
  guardarDireccion,
  validarDireccion,
  type CamposDireccion,
} from '../../../panel/cliente/src/logica/direcciones.js';
import { levantarPanelConM2, type PanelConM2 } from '../ayudas/panel-con-m2.js';

// La pantalla `direcciones` (T22, RF-2.2.6) contra el panel de verdad: PostgreSQL real, M2 y el servidor del panel. Lo que hace la
// pantalla está en `logica/direcciones.ts`; lo que se dibuja lo recorre la prueba en navegador (T33).

let panel: PanelConM2;
beforeAll(async () => {
  panel = await levantarPanelConM2();
});
afterAll(async () => {
  await panel?.cerrar();
});

async function clienteNuevo(): Promise<{ clienteId: string; api: ApiM2 }> {
  const clienteId = randomUUID();
  const api = panel.api(() => ({ rol: 'CLIENTE', sub: clienteId }));
  await api.crearCliente(cuerpoDeAlta(CLIENTE_DE_EJEMPLO), randomUUID());
  return { clienteId, api };
}

const CASA: CamposDireccion = { tipo: 'FAVORITA', alias: 'Casa', texto: 'Av. Sarmiento 1500, Resistencia', latitud: '-27.45', longitud: '-58.98' };
const crear = (api: ApiM2, clienteId: string, campos: CamposDireccion, clave = randomUUID()) =>
  api.crearDireccion(clienteId, cuerpoDeDireccion(campos), clave);

describe('crear una dirección (RF-2.2.6)', () => {
  it('con todos los campos: M2 la guarda y la lista la trae primero', async () => {
    const { clienteId, api } = await clienteNuevo();

    const creada = await crear(api, clienteId, CASA);

    expect(creada).toMatchObject({ tipo: 'FAVORITA', alias: 'Casa', texto: CASA.texto, coordenadas: { latitud: -27.45, longitud: -58.98 } });
    expect((await api.listarDirecciones(clienteId)).items[0]).toEqual(creada);
  });

  it('solo con el tipo y el texto', async () => {
    const { clienteId, api } = await clienteNuevo();

    const creada = await crear(api, clienteId, { ...DIRECCION_NUEVA, tipo: 'RECIENTE', texto: 'Plaza 25 de Mayo' });

    expect(creada).toMatchObject({ tipo: 'RECIENTE', texto: 'Plaza 25 de Mayo' });
    expect(creada).not.toHaveProperty('coordenadas');
  });

  it('la misma Idempotency-Key dos veces deja una sola dirección', async () => {
    const { clienteId, api } = await clienteNuevo();
    const clave = randomUUID();

    const primera = await crear(api, clienteId, CASA, clave);
    const segunda = await crear(api, clienteId, CASA, clave);

    expect(segunda).toEqual(primera);
    expect((await api.listarDirecciones(clienteId)).totalElementos).toBe(1);
  });

  it('los límites del panel son los de M2: lo que acepta uno, lo acepta el otro', async () => {
    const { clienteId, api } = await clienteNuevo();
    const casos: [string, Partial<CamposDireccion>, boolean][] = [
      ['texto de 255', { texto: 't'.repeat(255) }, true],
      ['texto de 256', { texto: 't'.repeat(256) }, false],
      ['alias de 50', { alias: 'a'.repeat(50) }, true],
      ['alias de 51', { alias: 'a'.repeat(51) }, false],
      ['latitud en el límite', { latitud: '90', longitud: '180' }, true],
      ['latitud fuera', { latitud: '90.5', longitud: '0' }, false],
      ['longitud fuera', { latitud: '0', longitud: '-180.5' }, false],
    ];
    for (const [nombre, cambios, valido] of casos) {
      const campos = { ...DIRECCION_NUEVA, texto: 'Calle 1', ...cambios };
      expect(Object.keys(validarDireccion(campos)).length === 0, `el panel con ${nombre}`).toBe(valido);

      const estado = await crear(api, clienteId, campos).then(() => 201, (error: ErrorDeApi) => error.estado);

      expect(estado, `M2 con ${nombre}`).toBe(valido ? 201 : 400);
    }
  });

  it('un 400 de M2 trae el detail del problema', async () => {
    const { clienteId, api } = await clienteNuevo();

    const error = await crear(api, clienteId, { ...DIRECCION_NUEVA, texto: 't'.repeat(256) }).catch((e: ErrorDeApi) => e);

    expect(error).toBeInstanceOf(ErrorDeApi);
    expect(error).toMatchObject({ estado: 400, sinRespuesta: false });
    expect((error as ErrorDeApi).detail).toBeTruthy();
  });
});

describe('editar una dirección: se precarga con obtenerDireccion (RF-2.2.6)', () => {
  it('la edición abre con lo que se creó, tal cual', async () => {
    const { clienteId, api } = await clienteNuevo();
    const creada = await crear(api, clienteId, CASA);

    const precargada = camposDeDireccion(await api.obtenerDireccion(clienteId, creada.direccionId));

    expect(precargada).toEqual(CASA);
  });

  it('cambiar un campo guarda solo ese y deja los demás; M2 devuelve la dirección nueva', async () => {
    const { clienteId, api } = await clienteNuevo();
    const creada = await crear(api, clienteId, CASA);

    const resultado = await guardarDireccion(api, clienteId, creada, { ...CASA, alias: 'Trabajo' });

    expect(resultado).toMatchObject({ tipo: 'guardada', direccion: { alias: 'Trabajo', texto: CASA.texto, tipo: 'FAVORITA', coordenadas: { latitud: -27.45, longitud: -58.98 } } });
    expect(await api.obtenerDireccion(clienteId, creada.direccionId)).toEqual((resultado as { direccion: unknown }).direccion);
  });

  it('pasar de favorita a reciente, y cambiar las coordenadas', async () => {
    const { clienteId, api } = await clienteNuevo();
    const creada = await crear(api, clienteId, CASA);

    await guardarDireccion(api, clienteId, creada, { ...CASA, tipo: 'RECIENTE', latitud: '-27,5', longitud: '-59' });

    expect(await api.obtenerDireccion(clienteId, creada.direccionId)).toMatchObject({ tipo: 'RECIENTE', coordenadas: { latitud: -27.5, longitud: -59 } });
  });

  it('agregar coordenadas a una dirección que no las tenía', async () => {
    const { clienteId, api } = await clienteNuevo();
    const creada = await crear(api, clienteId, { ...DIRECCION_NUEVA, texto: 'Calle 1' });

    await guardarDireccion(api, clienteId, creada, { ...camposDeDireccion(creada), latitud: '-27.45', longitud: '-58.98' });

    expect(await api.obtenerDireccion(clienteId, creada.direccionId)).toMatchObject({ coordenadas: { latitud: -27.45, longitud: -58.98 } });
  });

  it('sin cambios no hay pedido: la dirección queda igual', async () => {
    const { clienteId, api } = await clienteNuevo();
    const creada = await crear(api, clienteId, CASA);

    expect(await guardarDireccion(api, clienteId, creada, camposDeDireccion(creada))).toEqual({ tipo: 'sin-cambios' });

    expect(await api.obtenerDireccion(clienteId, creada.direccionId)).toEqual(creada);
  });

  it('un 400 de M2 al guardar trae el detail y no cambia lo guardado', async () => {
    const { clienteId, api } = await clienteNuevo();
    const creada = await crear(api, clienteId, CASA);

    const error = await guardarDireccion(api, clienteId, creada, { ...CASA, texto: 't'.repeat(256) }).catch((e: ErrorDeApi) => e);

    expect(error).toMatchObject({ estado: 400 });
    expect((error as ErrorDeApi).detail).toBeTruthy();
    expect(await api.obtenerDireccion(clienteId, creada.direccionId)).toEqual(creada);
  });

  it('una dirección que no existe, o de otro cliente, es un 404', async () => {
    const { clienteId, api } = await clienteNuevo();
    const ajena = await clienteNuevo();
    const deOtro = await crear(ajena.api, ajena.clienteId, CASA);

    await expect(api.obtenerDireccion(clienteId, randomUUID())).rejects.toMatchObject({ estado: 404 });
    await expect(api.obtenerDireccion(clienteId, deOtro.direccionId)).rejects.toMatchObject({ estado: 404 });
  });
});

describe('listar paginado (RF-2.2.6)', () => {
  it('12 direcciones en páginas de 5: tres páginas, la más nueva primero y sin repetir', async () => {
    const { clienteId, api } = await clienteNuevo();
    for (let n = 1; n <= 12; n++) await crear(api, clienteId, { ...DIRECCION_NUEVA, texto: `Calle ${n}` });

    const paginas = [await api.listarDirecciones(clienteId, { page: 0, size: 5 }), await api.listarDirecciones(clienteId, { page: 1, size: 5 }), await api.listarDirecciones(clienteId, { page: 2, size: 5 })];

    expect(paginas.map((p) => p.items.length)).toEqual([5, 5, 2]);
    expect(paginas.map((p) => [p.page, p.size, p.totalElementos, p.totalPaginas])).toEqual([[0, 5, 12, 3], [1, 5, 12, 3], [2, 5, 12, 3]]);
    const textos = paginas.flatMap((p) => p.items.map((d) => d.texto));
    expect(textos).toEqual(Array.from({ length: 12 }, (_, i) => `Calle ${12 - i}`));
  });

  it('un cliente sin direcciones trae la lista vacía', async () => {
    const { clienteId, api } = await clienteNuevo();

    expect(await api.listarDirecciones(clienteId)).toMatchObject({ items: [], totalElementos: 0, totalPaginas: 0 });
  });

  it('una página más allá de la última trae la lista vacía pero con los totales', async () => {
    const { clienteId, api } = await clienteNuevo();
    await crear(api, clienteId, CASA);

    expect(await api.listarDirecciones(clienteId, { page: 5, size: 5 })).toMatchObject({ items: [], totalElementos: 1, totalPaginas: 1 });
  });
});
