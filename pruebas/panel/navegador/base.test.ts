import type { Browser, BrowserContext, Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Rol } from '../../../panel/cliente/src/rutas.js';
import {
  abrirChrome,
  abrirContexto,
  ANCHOS,
  controlesChicos,
  desbordeHorizontal,
  DIRECTORIO_CLIENTE,
  ESQUEMAS,
  esperarPantalla,
  irA,
  juntarErrores,
  prepararCliente,
  recorrerConTeclado,
  tabularHasta,
  violacionesAxe,
  type DatosDeRecorrido,
  type Esquema,
} from '../ayudas/navegador.js';
import { levantarPanelConM2, type PanelConM2 } from '../ayudas/panel-con-m2.js';

// Prueba en navegador I (T33, RNF-07.5, RNF-15.1, RNF-15.3): Chrome real contra el panel servido por su servidor, con M2 de
// verdad, su base en un contenedor y el M6 simulado. Cada pantalla, a 360 y a 1280 píxeles y en modo claro y oscuro: sin
// desplazamiento horizontal, controles de 44×44, todo alcanzable con Tab y con el foco a la vista, y `axe-core` sin violaciones.

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

type Recorrible = { nombre: string; rol?: Rol; hash: (d: DatosDeRecorrido) => string };
const fijo = (nombre: string, rol?: Rol): Recorrible => ({ nombre, rol, hash: () => `#/${nombre}` });

// Las trece pantallas (y las tres con id), cada una con el rol que la usa. `ingresar` va sin sesión. Los ids se resuelven al correr,
// cuando ya existen los datos.
const PANTALLAS: Recorrible[] = [
  fijo('ingresar'),
  fijo('perfil', 'CLIENTE'),
  fijo('direcciones', 'CLIENTE'),
  { nombre: 'direcciones/{direccionId}', rol: 'CLIENTE', hash: (d) => `#/direcciones/${d.direccionId}` },
  fijo('preferencias', 'CLIENTE'),
  fijo('historial', 'CLIENTE'),
  { nombre: 'calificar/{viajeId}', rol: 'CLIENTE', hash: (d) => `#/calificar/${d.viajes.enCurso}` },
  fijo('calificaciones', 'CLIENTE'),
  { nombre: 'calificaciones/{calificacionId}', rol: 'CLIENTE', hash: (d) => `#/calificaciones/${d.calificacionId}` },
  fijo('estado-cuenta', 'CLIENTE'),
  fijo('detalle-tecnico', 'CLIENTE'),
  fijo('m6-simulado', 'CLIENTE'),
  fijo('demostracion', 'CLIENTE'),
  fijo('operador', 'OPERADOR'),
  fijo('otro-modulo', 'SERVICIO'),
];

const SUB: Record<Exclude<Rol, 'CLIENTE'>, string> = { OPERADOR: 'operador-1', SERVICIO: 'm5-despacho', CONDUCTOR: 'conductor-1' };
const sesionDe = (rol: Rol | undefined) => (rol === undefined ? undefined : { rol, sub: rol === 'CLIENTE' ? datos.clienteId : SUB[rol] });

let contexto: BrowserContext | undefined;
afterEach(async () => {
  await contexto?.close();
  contexto = undefined;
});

async function abrir(ancho: number, esquema: Esquema, rol: Rol | undefined, hash: string): Promise<{ pagina: Page; errores: string[] }> {
  contexto = await abrirContexto(chrome, { ancho, esquema, sesion: sesionDe(rol) });
  const pagina = await contexto.newPage();
  const errores = juntarErrores(pagina);
  await irA(pagina, panel.origen, hash);
  return { pagina, errores };
}

describe.each(ANCHOS.flatMap((ancho) => ESQUEMAS.map((esquema) => ({ ancho, esquema }))))('a $ancho px en modo $esquema', ({ ancho, esquema }) => {
  it.each(PANTALLAS)('$nombre: sin desborde, controles de 44 px, teclado y axe', async ({ rol, hash: armar }) => {
    const hash = armar(datos);
    const { pagina, errores } = await abrir(ancho, esquema, rol, hash);

    expect(await pagina.locator('h1').textContent(), hash).not.toBe('Pantalla no encontrada');
    expect(await desbordeHorizontal(pagina), `${hash}: desplazamiento horizontal`).toBe(0);
    expect(await controlesChicos(pagina), `${hash}: controles de menos de 44×44`).toEqual([]);
    expect(await violacionesAxe(pagina), `${hash}: axe-core`).toEqual([]);
    expect(await recorrerConTeclado(pagina), `${hash}: teclado`).toEqual({ sinAlcanzar: [], sinFocoVisible: [] });
    expect(errores, `${hash}: errores en la consola`).toEqual([]);
  });
});

describe.each(ANCHOS)('solo con teclado a %i px (RNF-15.3)', (ancho) => {
  it('entra como cliente nuevo y pasa a sus direcciones por el menú', async () => {
    const { pagina, errores } = await abrir(ancho, 'light', undefined, '#/ingresar');

    await tabularHasta(pagina, 'Entrar como cliente nuevo');
    await pagina.keyboard.press('Enter');
    await pagina.waitForURL(/#\/perfil$/);
    await esperarPantalla(pagina);
    // Al cambiar de pantalla, el foco va al título (RNF-15.3).
    expect(await pagina.evaluate(() => document.activeElement?.textContent)).toBe('Mi perfil');

    // Debajo de 960 px el menú está plegado detrás de «Menú»: se abre con Enter.
    if (ancho < 960) {
      await tabularHasta(pagina, 'Menú');
      await pagina.keyboard.press('Enter');
    }
    await tabularHasta(pagina, 'Direcciones frecuentes');
    await pagina.keyboard.press('Enter');
    await pagina.waitForURL(/#\/direcciones$/);
    await esperarPantalla(pagina);
    expect(await pagina.evaluate(() => document.activeElement?.textContent)).toBe('Direcciones frecuentes');
    expect(errores).toEqual([]);
  });
});

// Las comprobaciones mismas, sobre una página armada para que fallen: si alguna dejara de detectar lo suyo, las de arriba pasarían
// sin mirar nada.
describe('las comprobaciones detectan lo que buscan', () => {
  it('desborde, control chico, contraste, campo sin etiqueta y foco invisible', async () => {
    contexto = await abrirContexto(chrome, { ancho: 360, esquema: 'light' });
    const pagina = await contexto.newPage();
    await pagina.setContent(`<!doctype html><html lang="es"><head><title>Prueba</title></head><body>
      <main><h1>Prueba</h1>
        <div style="width: 600px">ancho</div>
        <button style="width: 30px; height: 30px">x</button>
        <p style="color: #ddd; background: #fff">poco contraste</p>
        <input type="text">
        <button style="width: 60px; height: 60px; outline: none">sin foco</button>
      </main></body></html>`);

    expect(await desbordeHorizontal(pagina)).toBeGreaterThan(0);
    // El botón de 30 px y el campo de texto con el alto que trae el navegador.
    expect(await controlesChicos(pagina)).toEqual(['«x» 30×30', expect.stringMatching(/^«» \d+×2\d$/)]);
    expect((await violacionesAxe(pagina)).map((v) => v.id).sort()).toEqual(expect.arrayContaining(['color-contrast', 'label']));
    const recorrido = await recorrerConTeclado(pagina);
    expect(recorrido.sinFocoVisible).toContain('sin foco');
  });
});
