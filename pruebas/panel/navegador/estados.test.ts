import { randomUUID } from 'node:crypto';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Rol } from '../../../panel/cliente/src/rutas.js';
import {
  abrirChrome,
  abrirContexto,
  ANCHOS,
  clienteConEjemplo,
  controlesDeshabilitados,
  demorarPedidos,
  desbordeHorizontal,
  DIRECTORIO_CLIENTE,
  esperarPantalla,
  irA,
  juntarErrores,
  prepararCliente,
  textoFueraDeLugar,
  verPedidosAM2,
  type DatosDeRecorrido,
} from '../ayudas/navegador.js';
import { levantarPanelConM2, type PanelConM2 } from '../ayudas/panel-con-m2.js';

// Prueba en navegador II (T34, RNF-15, RNF-15.2, RNF-15.4, RNF-15.5, RF-2.5.15): los estados de cada pantalla en Chrome real
// contra M2 de verdad. La espera se ve reteniendo los pedidos en el navegador; el error, deteniendo M2 (el panel responde
// «M2 no responde»); la recuperación, volviendo a levantarlo y tocando «Reintentar».

let panel: PanelConM2;
let chrome: Browser;
let datos: DatosDeRecorrido;
beforeAll(async () => {
  [panel, chrome] = await Promise.all([levantarPanelConM2({ directorioCliente: DIRECTORIO_CLIENTE }), abrirChrome()]);
  datos = await prepararCliente(panel);
}, 60_000);
afterAll(async () => {
  await chrome?.close();
  await panel?.cerrar();
});

let contexto: BrowserContext | undefined;
afterEach(async () => {
  await contexto?.close();
  contexto = undefined;
  // Una prueba que falló con M2 detenido no se lleva a M2 con ella.
  await panel.arrancarM2();
});

const SUB: Record<Exclude<Rol, 'CLIENTE'>, string> = { OPERADOR: 'operador-1', SERVICIO: 'm5-despacho', CONDUCTOR: 'conductor-1' };

type Apertura = { rol?: Rol | undefined; clienteId?: string; ancho?: number; local?: Record<string, string> };

async function abrir(hash: string, { rol, clienteId = datos.clienteId, ancho = 1280, local }: Apertura = {}): Promise<{ pagina: Page; errores: string[] }> {
  const sesion = rol === undefined ? undefined : { rol, sub: rol === 'CLIENTE' ? clienteId : SUB[rol] };
  contexto = await abrirContexto(chrome, { ancho, esquema: 'light', sesion, local });
  const pagina = await contexto.newPage();
  const errores = juntarErrores(pagina);
  await irA(pagina, panel.origen, hash);
  return { pagina, errores };
}

const boton = (pagina: Page, nombre: string) => pagina.getByRole('button', { name: nombre, exact: true });
// Por su nombre accesible: la etiqueta visible lleva además el número del casillero («02»), que el lector no lee.
const campo = (pagina: Page, nombre: string) => pagina.getByRole('textbox', { name: nombre, exact: true });

// El aviso de lo hecho (RNF-15.2): una región `status` con ese texto. Cada acción tiene la suya.
const esperarAviso = (pagina: Page, texto: string) => pagina.getByRole('status').filter({ hasText: texto }).first().waitFor();

// El error que el navegador ve con M2 detenido (RNF-15.4): el título, «Reintentar» y ningún control deshabilitado.
async function verM2NoResponde(pagina: Page): Promise<void> {
  await expect.poll(() => pagina.getByRole('alert').filter({ hasText: 'M2 no responde' }).count()).toBeGreaterThan(0);
  expect(await boton(pagina, 'Reintentar').first().isEnabled()).toBe(true);
  expect(await controlesDeshabilitados(pagina)).toEqual([]);
}

// La consola puede quejarse de los pedidos que fallaron mientras M2 estaba detenido (el 504 del panel): eso es lo esperado.
const sinErroresSalvo504 = (errores: string[]) => errores.filter((e) => !e.includes('504'));

type Cargable = { nombre: string; rol: Rol; hash: (d: DatosDeRecorrido) => string; buscar?: string };
const cliente = (nombre: string, hash: (d: DatosDeRecorrido) => string = () => `#/${nombre}`): Cargable => ({ nombre, rol: 'CLIENTE', hash });

// Las pantallas que cargan algo de M2 al abrirse; las del operador y de otro módulo, después de buscar al cliente.
const CARGABLES: Cargable[] = [
  cliente('perfil'),
  cliente('direcciones'),
  cliente('direcciones/{direccionId}', (d) => `#/direcciones/${d.direccionId}`),
  cliente('preferencias'),
  cliente('historial'),
  cliente('calificaciones'),
  cliente('calificaciones/{calificacionId}', (d) => `#/calificaciones/${d.calificacionId}`),
  cliente('estado-cuenta'),
  { nombre: 'operador', rol: 'OPERADOR', hash: () => '#/operador', buscar: 'Buscar' },
  { nombre: 'otro-modulo', rol: 'SERVICIO', hash: () => '#/otro-modulo', buscar: 'Consultar' },
];

async function buscarCliente(pagina: Page, textoBoton: string): Promise<void> {
  await campo(pagina, 'UUID del cliente').fill(datos.clienteId);
  await boton(pagina, textoBoton).click();
}

describe('al cargar cada pantalla: espera, error y recuperación (RNF-15, RNF-15.2, RNF-15.4)', () => {
  it.each(CARGABLES)('$nombre', async ({ rol, hash: armar, buscar }) => {
    const hash = armar(datos);
    // Abre sin pedidos pendientes; los del operador y de otro módulo salen al buscar.
    const { pagina, errores } = await abrir(buscar === undefined ? '#/ingresar' : hash, { rol });

    // Espera: mientras M2 no contesta, «Cargando…» marcado `aria-busy`.
    const quitarDemora = await demorarPedidos(pagina, 1500);
    if (buscar === undefined) await pagina.goto(`${panel.origen}/${hash}`);
    else await buscarCliente(pagina, buscar);
    await pagina.locator('[aria-busy="true"]', { hasText: 'Cargando…' }).first().waitFor();
    await quitarDemora();
    await esperarPantalla(pagina);
    expect(await pagina.getByRole('alert').count()).toBe(0);

    // Error: con M2 detenido, «M2 no responde» con «Reintentar», nada deshabilitado.
    await panel.detenerM2();
    await pagina.reload();
    await esperarPantalla(pagina);
    if (buscar !== undefined) await buscarCliente(pagina, buscar);
    await verM2NoResponde(pagina);

    // Recuperación: con M2 de vuelta, «Reintentar» repite los pedidos y la pantalla se dibuja sin el error.
    await panel.arrancarM2();
    // Puede haber más de una carga con su «Reintentar» (el operador carga la cuenta y los bloqueos): se tocan de a uno.
    for (let i = 0; i < 5 && (await boton(pagina, 'Reintentar').count()) > 0; i++) {
      await boton(pagina, 'Reintentar').first().click();
      await esperarPantalla(pagina);
    }
    await expect.poll(() => pagina.getByRole('alert').filter({ hasText: 'M2 no responde' }).count()).toBe(0);
    expect(sinErroresSalvo504(errores)).toEqual([]);
  });
});

describe('perfil: espera, confirmación, cancelación, error y recuperación', () => {
  it('guardar: el botón espera deshabilitado y después avisa «Perfil guardado.»', async () => {
    const { pagina } = await abrir('#/perfil', { rol: 'CLIENTE' });
    await campo(pagina, 'Apellido').fill('Gómez Paz');

    await demorarPedidos(pagina, 1000, 'PATCH');
    await boton(pagina, 'Guardar cambios').click();
    const enEspera = pagina.getByRole('button', { name: 'Guardando…' });
    expect(await enEspera.isDisabled()).toBe(true);
    expect(await enEspera.getAttribute('aria-busy')).toBe('true');

    await esperarAviso(pagina, 'Perfil guardado.');
    expect(await boton(pagina, 'Guardar cambios').isEnabled()).toBe(true);
  });

  it('descartar los cambios no le pide nada a M2 y deja lo que había', async () => {
    const { pagina } = await abrir('#/perfil', { rol: 'CLIENTE' });
    const pedidos = verPedidosAM2(pagina);
    const apellido = campo(pagina, 'Apellido');
    const antes = await apellido.inputValue();
    await apellido.fill('Otro');

    await boton(pagina, 'Descartar cambios').click();

    expect(await apellido.inputValue()).toBe(antes);
    expect(pedidos.filter((p) => p.metodo !== 'GET')).toEqual([]);
  });

  it('con M2 detenido al guardar: «M2 no responde»; al volver, «Reintentar» guarda', async () => {
    const { pagina, errores } = await abrir('#/perfil', { rol: 'CLIENTE' });
    await campo(pagina, 'Apellido').fill('Gómez Recuperado');

    await panel.detenerM2();
    await boton(pagina, 'Guardar cambios').click();
    await verM2NoResponde(pagina);

    await panel.arrancarM2();
    await boton(pagina, 'Reintentar').click();
    await esperarAviso(pagina, 'Perfil guardado.');
    expect(sinErroresSalvo504(errores)).toEqual([]);
  });
});

describe('direcciones: confirmación, cancelación y rechazo', () => {
  it('alta: espera «Guardando…» deshabilitado y avisa «Dirección guardada.»', async () => {
    const { pagina } = await abrir('#/direcciones', { rol: 'CLIENTE' });
    await boton(pagina, 'Agregar una dirección').click();
    await campo(pagina, 'Dirección').fill('Av. 9 de Julio 1200, Resistencia');

    await demorarPedidos(pagina, 1000, 'POST');
    await boton(pagina, 'Guardar dirección').click();
    expect(await pagina.getByRole('button', { name: 'Guardando…' }).isDisabled()).toBe(true);
    await esperarAviso(pagina, 'Dirección guardada.');
  });

  it('eliminar y «Cancelar» en la confirmación: el diálogo se cierra sin pedir nada a M2 (RF-2.2.7)', async () => {
    const { clienteId } = await clienteConEjemplo(panel);
    const { pagina } = await abrir('#/direcciones', { rol: 'CLIENTE', clienteId });
    const pedidos = verPedidosAM2(pagina);
    const filas = await pagina.getByRole('listitem').filter({ has: pagina.getByRole('button', { name: /^Eliminar/ }) }).count();

    await pagina.getByRole('button', { name: /^Eliminar/ }).first().click();
    const dialogo = pagina.getByRole('dialog');
    await dialogo.waitFor();
    await dialogo.getByRole('button', { name: 'Cancelar' }).click();

    await dialogo.waitFor({ state: 'hidden' });
    expect(pedidos.filter((p) => p.metodo === 'DELETE')).toEqual([]);
    expect(await pagina.getByRole('listitem').filter({ has: pagina.getByRole('button', { name: /^Eliminar/ }) }).count()).toBe(filas);
  });

  it('eliminar y confirmar: un solo DELETE y «Dirección eliminada.»', async () => {
    const { clienteId } = await clienteConEjemplo(panel);
    const { pagina } = await abrir('#/direcciones', { rol: 'CLIENTE', clienteId });
    const pedidos = verPedidosAM2(pagina);

    await pagina.getByRole('button', { name: /^Eliminar/ }).first().click();
    await pagina.getByRole('dialog').getByRole('button', { name: 'Eliminar', exact: true }).click();

    await esperarAviso(pagina, 'Dirección eliminada.');
    expect(pedidos.filter((p) => p.metodo === 'DELETE')).toHaveLength(1);
  });

  it('rechazo: guardar una dirección que ya no existe muestra el 404 de M2 tal cual', async () => {
    const { clienteId } = await clienteConEjemplo(panel);
    const api = panel.api(() => ({ rol: 'CLIENTE', sub: clienteId }));
    const { items } = await api.listarDirecciones(clienteId);
    const { pagina } = await abrir(`#/direcciones/${items[0]!.direccionId}`, { rol: 'CLIENTE', clienteId });
    await api.eliminarDireccion(clienteId, items[0]!.direccionId);

    await campo(pagina, 'Dirección').fill('Otra calle 123');
    await boton(pagina, 'Guardar cambios').click();

    const error = pagina.getByRole('alert');
    await error.waitFor();
    expect(await error.textContent()).toContain('404');
    expect(await controlesDeshabilitados(pagina)).toEqual([]);
  });
});

describe('preferencias: espera y confirmación', () => {
  it('guardar: «Guardando…» deshabilitado y después «Preferencias guardadas.»', async () => {
    const { pagina } = await abrir('#/preferencias', { rol: 'CLIENTE' });
    await campo(pagina, 'Observaciones de accesibilidad (opcional)').fill('Necesito ayuda con el equipaje');

    await demorarPedidos(pagina, 1000, 'PUT');
    await boton(pagina, 'Guardar preferencias').click();
    expect(await pagina.getByRole('button', { name: 'Guardando…' }).isDisabled()).toBe(true);
    await esperarAviso(pagina, 'Preferencias guardadas.');
  });
});

describe('calificar: rechazo, doble clic, error y recuperación (RF-2.5.15)', () => {
  const calificaciones = async (clienteId: string) => {
    const { rows } = await panel.pool.query('SELECT count(*)::int AS n FROM calificaciones WHERE cliente_id = $1', [clienteId]);
    return (rows[0] as { n: number }).n;
  };

  it('un viaje en curso: M2 lo rechaza y la pantalla lo dice con sus palabras', async () => {
    const { pagina } = await abrir(`#/calificar/${datos.viajes.enCurso}`, { rol: 'CLIENTE' });
    await pagina.getByRole('radio', { name: '5' }).check();
    await boton(pagina, 'Enviar calificación').click();

    const error = pagina.getByRole('alert');
    await error.waitFor();
    expect(await error.textContent()).toContain('El viaje todavía no está completado.');
  });

  it('un viaje ya calificado: «Ya calificaste este viaje.»', async () => {
    const { pagina } = await abrir(`#/calificar/${datos.viajes.completado}`, { rol: 'CLIENTE' });
    await pagina.getByRole('radio', { name: '3' }).check();
    await boton(pagina, 'Enviar calificación').click();

    const error = pagina.getByRole('alert');
    await error.waitFor();
    expect(await error.textContent()).toContain('Ya calificaste este viaje.');
  });

  it('doble clic al enviar: un solo pedido y una sola calificación', async () => {
    const { clienteId, viajes } = await clienteConEjemplo(panel);
    const { pagina } = await abrir(`#/calificar/${viajes.completado}`, { rol: 'CLIENTE', clienteId });
    const pedidos = verPedidosAM2(pagina);
    await pagina.getByRole('radio', { name: '4' }).check();

    await demorarPedidos(pagina, 500, 'POST');
    await boton(pagina, 'Enviar calificación').dblclick();

    await esperarAviso(pagina, 'Calificación enviada.');
    expect(pedidos.filter((p) => p.metodo === 'POST')).toHaveLength(1);
    expect(await calificaciones(clienteId)).toBe(1);
  });

  it('con M2 detenido: «M2 no responde»; «Reintentar» manda la misma clave y queda una sola calificación', async () => {
    const { clienteId, viajes } = await clienteConEjemplo(panel);
    const { pagina } = await abrir(`#/calificar/${viajes.completado}`, { rol: 'CLIENTE', clienteId });
    const pedidos = verPedidosAM2(pagina);
    await pagina.getByRole('radio', { name: '2' }).check();

    await panel.detenerM2();
    await boton(pagina, 'Enviar calificación').click();
    await verM2NoResponde(pagina);

    await panel.arrancarM2();
    await boton(pagina, 'Reintentar').click();
    await esperarAviso(pagina, 'Calificación enviada.');
    const envios = pedidos.filter((p) => p.metodo === 'POST');
    expect(envios).toHaveLength(2);
    expect(envios[1]!.clave).toBe(envios[0]!.clave);
    expect(await calificaciones(clienteId)).toBe(1);
  });
});

describe('operador: confirmación y cancelación', () => {
  it('bloquear avisa «Bloqueo registrado.»; «Cancelar» al levantar no pide nada a M2', async () => {
    const { clienteId } = await clienteConEjemplo(panel);
    const { pagina } = await abrir('#/operador', { rol: 'OPERADOR' });
    await campo(pagina, 'UUID del cliente').fill(clienteId);
    await boton(pagina, 'Buscar').click();
    await esperarPantalla(pagina);

    await campo(pagina, 'Motivo').fill('Revisión de pagos');
    await demorarPedidos(pagina, 1000, 'POST');
    await boton(pagina, 'Bloquear cliente').click();
    expect(await pagina.getByRole('button', { name: 'Bloqueando…' }).isDisabled()).toBe(true);
    await esperarAviso(pagina, 'Bloqueo registrado.');
    await esperarPantalla(pagina);

    const pedidos = verPedidosAM2(pagina);
    await pagina.getByRole('button', { name: /^Levantar el bloqueo/ }).first().click();
    await boton(pagina, 'Cancelar').click();
    expect(pedidos.filter((p) => p.metodo === 'PATCH')).toEqual([]);
    expect(await pagina.getByRole('button', { name: /^Levantar el bloqueo/ }).count()).toBe(1);
  });
});

describe('ingresar: error y recuperación sin duplicar', () => {
  it('con M2 detenido, «Reintentar» crea al cliente una sola vez y entra a su perfil', async () => {
    const { pagina, errores } = await abrir('#/ingresar');
    const pedidos = verPedidosAM2(pagina);

    await panel.detenerM2();
    await boton(pagina, 'Entrar como cliente nuevo').click();
    await verM2NoResponde(pagina);

    await panel.arrancarM2();
    await boton(pagina, 'Reintentar').click();
    await pagina.waitForURL(/#\/perfil$/);
    const altas = pedidos.filter((p) => p.metodo === 'POST');
    expect(altas).toHaveLength(2);
    expect(altas[1]).toEqual(altas[0]);
    expect(sinErroresSalvo504(errores)).toEqual([]);
  });
});

// Los valores máximos del contrato, sin espacios para que no se puedan partir entre palabras: el peor caso.
const NOMBRE = 'Bartolomeo'.repeat(10);
const TEXTO_DIRECCION = 'Calle'.repeat(51);
const COMENTARIO = 'Excelente'.repeat(55) + 'Bien!';
const MOTIVO = 'Morosidad'.repeat(55) + 'Final';

describe.each(ANCHOS)('valores máximos a %i px (RNF-15.5)', (ancho) => {
  let largos: { clienteId: string; direccionId: string; calificacionId: string };
  beforeAll(async () => {
    const { clienteId, viajes } = await clienteConEjemplo(panel, { nombre: NOMBRE, apellido: NOMBRE });
    const api = panel.api(() => ({ rol: 'CLIENTE', sub: clienteId }));
    const direccion = await api.crearDireccion(clienteId, { tipo: 'FAVORITA', alias: 'A'.repeat(50), texto: TEXTO_DIRECCION }, randomUUID());
    const calificacion = await api.calificarConductor(clienteId, { viajeId: viajes.completado, puntaje: 5, comentario: COMENTARIO }, randomUUID());
    await panel.api(() => ({ rol: 'OPERADOR', sub: 'operador-1' })).crearBloqueo(clienteId, { motivo: MOTIVO }, randomUUID());
    largos = { clienteId, direccionId: direccion.direccionId, calificacionId: calificacion.calificacionId };
  });

  const casos: { pantalla: string; que: string; hash: (l: typeof largos) => string; texto: string; rol?: Rol; buscar?: string }[] = [
    { pantalla: 'ingresar', que: 'nombre recordado de 100', hash: () => '#/ingresar', texto: NOMBRE },
    { pantalla: 'direcciones', que: 'dirección de 255', hash: () => '#/direcciones', texto: TEXTO_DIRECCION, rol: 'CLIENTE' },
    { pantalla: 'calificaciones', que: 'comentario de 500', hash: () => '#/calificaciones', texto: COMENTARIO.slice(0, 40), rol: 'CLIENTE' },
    { pantalla: 'calificaciones/{calificacionId}', que: 'comentario de 500', hash: (l) => `#/calificaciones/${l.calificacionId}`, texto: COMENTARIO, rol: 'CLIENTE' },
    { pantalla: 'estado-cuenta', que: 'motivo de 500', hash: () => '#/estado-cuenta', texto: MOTIVO, rol: 'CLIENTE' },
    { pantalla: 'operador', que: 'motivo de 500', hash: () => '#/operador', texto: MOTIVO, rol: 'OPERADOR', buscar: 'Buscar' },
  ];

  it.each(casos)('$pantalla con $que caracteres', async ({ hash: armar, texto, rol, buscar }) => {
    const local = { 'panel.clientes': JSON.stringify([{ id: largos.clienteId, nombre: NOMBRE }]) };
    const { pagina } = await abrir(armar(largos), { rol, clienteId: largos.clienteId, ancho, local });
    if (buscar !== undefined) {
      await campo(pagina, 'UUID del cliente').fill(largos.clienteId);
      await boton(pagina, buscar).click();
      await esperarPantalla(pagina);
    }

    expect(await desbordeHorizontal(pagina)).toBe(0);
    expect(await textoFueraDeLugar(pagina, texto)).toEqual([]);
  });

  it.each(['#/perfil', '#/direcciones/{direccionId}'])('los campos con el valor máximo en %s', async (hash) => {
    const { pagina } = await abrir(hash.replace('{direccionId}', largos.direccionId), { rol: 'CLIENTE', clienteId: largos.clienteId, ancho });
    expect(await desbordeHorizontal(pagina)).toBe(0);
    // Los campos quedan dentro de la ventana: el valor largo se desplaza adentro del campo, no lo estira.
    const fuera = await pagina.evaluate(() =>
      [...document.querySelectorAll('input, textarea')]
        .map((campo) => campo.getBoundingClientRect())
        .filter((caja) => caja.width > 0 && caja.right > document.documentElement.clientWidth + 0.5),
    );
    expect(fuera).toEqual([]);
  });
});
