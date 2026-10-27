import axe from 'axe-core';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { cuerpoDeCalificacion } from '../../../panel/cliente/src/logica/calificacion.js';
import { CLIENTE_DE_EJEMPLO, cuerpoDeAlta, type CamposCliente } from '../../../panel/cliente/src/logica/campos-cliente.js';
import { cargarEjemplo } from '../../../panel/cliente/src/logica/ejemplo.js';
import type { Rol } from '../../../panel/cliente/src/rutas.js';
import type { PanelConM2 } from './panel-con-m2.js';

// Lo que necesita la prueba en navegador (T33, T34): el Chrome de la máquina con `playwright-core` (no descarga navegadores, plan,
// Decisiones), una página por caso con su ancho, su esquema de color y su sesión, y las comprobaciones que se miran adentro de la
// página: desplazamiento horizontal, tamaño de los controles, foco con teclado y `axe-core`.

// El cliente compilado por `npm run panel:build`, que `npm run panel:navegador` corre antes.
export const DIRECTORIO_CLIENTE = fileURLToPath(new URL('../../../panel/dist/cliente', import.meta.url));

// Los dos extremos de RNF-07.5 y los dos esquemas de color del panel.
export const ANCHOS = [360, 1280] as const;
export const ESQUEMAS = ['light', 'dark'] as const;
export type Esquema = (typeof ESQUEMAS)[number];

// RNF-15.1: el lado mínimo de un control táctil.
export const LADO_MINIMO = 44;

export const abrirChrome = (): Promise<Browser> => chromium.launch({ channel: 'chrome', headless: true });

export type Caso = { ancho: number; esquema: Esquema; sesion?: { rol: Rol; sub: string } | undefined; local?: Record<string, string> };

// Un contexto nuevo por caso: el almacenamiento de uno no se cuela en el siguiente. La sesión se escribe antes de que cargue el
// panel, como la dejaría la pantalla `ingresar`; `local` es lo que haya en el almacenamiento local (los clientes recordados).
export async function abrirContexto(navegador: Browser, { ancho, esquema, sesion, local = {} }: Caso): Promise<BrowserContext> {
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: 800 }, colorScheme: esquema, locale: 'es-AR' });
  // Menos que el tiempo de cada prueba: si algo no aparece, el error dice qué se esperaba en vez de «la prueba tardó demasiado».
  contexto.setDefaultTimeout(10_000);
  if (sesion !== undefined) {
    await contexto.addInitScript((guardada) => sessionStorage.setItem('panel.sesion', guardada), JSON.stringify(sesion));
  }
  await contexto.addInitScript((valores) => {
    for (const [clave, valor] of Object.entries(valores)) localStorage.setItem(clave, valor);
  }, local);
  return contexto;
}

// Los errores que la página escribe en la consola o que no atrapa (también una violación de la política de seguridad).
export function juntarErrores(pagina: Page): string[] {
  const errores: string[] = [];
  pagina.on('console', (mensaje) => {
    if (mensaje.type() === 'error') errores.push(mensaje.text());
  });
  pagina.on('pageerror', (error) => errores.push(error.message));
  return errores;
}

// Espera a que la pantalla termine de cargar: sin pedidos en vuelo y sin nada marcado `aria-busy`.
export async function esperarPantalla(pagina: Page): Promise<void> {
  await pagina.waitForLoadState('networkidle');
  await pagina.waitForFunction(() => document.querySelector('h1') !== null && document.querySelector('[aria-busy="true"]') === null);
}

export async function irA(pagina: Page, origen: string, hash: string): Promise<void> {
  await pagina.goto(`${origen}/${hash}`);
  await esperarPantalla(pagina);
}

// Cuánto se puede desplazar la página hacia el costado (RNF-15.1): tiene que ser 0.
export const desbordeHorizontal = (pagina: Page): Promise<number> =>
  pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// Lo que se puede tocar o enfocar con el teclado. Las casillas y opciones se miden por su etiqueta, que es lo que se toca.
const CONTROLES = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';

// Los controles visibles que miden menos de 44×44 píxeles (RNF-15.1), con su texto y su tamaño, para leer el fallo.
export const controlesChicos = (pagina: Page): Promise<string[]> =>
  pagina.evaluate(
    ({ selector, minimo }) =>
      [...document.querySelectorAll<HTMLElement>(selector)]
        .filter((control) => control.checkVisibility({ visibilityProperty: true }))
        .map((control) => {
          const tocable = control instanceof HTMLInputElement && ['radio', 'checkbox'].includes(control.type) ? (control.closest('label') ?? control) : control;
          const { width, height } = tocable.getBoundingClientRect();
          return { texto: (control.getAttribute('aria-label') ?? control.textContent ?? control.outerHTML).trim().slice(0, 60), width, height };
        })
        // Medio píxel de tolerancia por el redondeo de las unidades `rem`.
        .filter(({ width, height }) => width < minimo - 0.5 || height < minimo - 0.5)
        .map(({ texto, width, height }) => `«${texto}» ${Math.round(width)}×${Math.round(height)}`),
    { selector: CONTROLES, minimo: LADO_MINIMO },
  );

export type Violacion = { id: string; ayuda: string; nodos: string[] };

// `axe-core` con las reglas de WCAG 2.1 A y AA (contraste, etiquetas, nombres, estructura). Se carga evaluando su código por el
// protocolo de depuración, que no pasa por la política de seguridad del panel: el panel no tiene que permitir scripts en línea.
export async function violacionesAxe(pagina: Page): Promise<Violacion[]> {
  await pagina.evaluate(axe.source);
  return pagina.evaluate(async () => {
    const { run } = (globalThis as unknown as { axe: typeof axe }).axe;
    const { violations } = await run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return violations.map((v) => ({ id: v.id, ayuda: v.help, nodos: v.nodes.map((n) => n.target.join(' ')) }));
  });
}

export type Recorrido = {
  // Los controles visibles que el tabulador no alcanzó.
  sinAlcanzar: string[];
  // Los que recibieron el foco sin un indicador visible (contorno o sombra, propia o de su etiqueta).
  sinFocoVisible: string[];
};

// Recorre la página con Tab desde el principio (RNF-15.3) y anota adónde llega el foco y si se ve. De cada grupo de opciones
// (radio) cuenta una sola parada, la marcada: entre ellas se pasa con las flechas.
export async function recorrerConTeclado(pagina: Page): Promise<Recorrido> {
  const total = await pagina.evaluate((selector) => {
    const vistos = new Set<string>();
    let n = 0;
    for (const control of document.querySelectorAll<HTMLElement>(selector)) {
      control.removeAttribute('data-parada');
      if (!control.checkVisibility({ visibilityProperty: true }) || control.matches(':disabled')) continue;
      if (control instanceof HTMLInputElement && control.type === 'radio') {
        const grupo = document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(control.name)}"]`);
        const parada = [...grupo].find((r) => r.checked) ?? grupo[0];
        if (control !== parada || vistos.has(control.name)) continue;
        vistos.add(control.name);
      }
      control.dataset.parada = String(n++);
    }
    (document.activeElement as HTMLElement | null)?.blur();
    return n;
  }, CONTROLES);

  const alcanzados = new Set<string>();
  const sinFocoVisible: string[] = [];
  let anterior: string | undefined;
  // Un campo de fecha recibe tres Tab (día, mes y año) sin dejar de ser el elemento activo; sobran paradas para eso y para lo que
  // no se pudo marcar. Termina al volver a una parada ya vista: el foco dio la vuelta.
  for (let i = 0; i < total * 3 + 5; i++) {
    await pagina.keyboard.press('Tab');
    const paso = await pagina.evaluate(() => {
      const activo = document.activeElement as HTMLElement | null;
      if (activo === null || activo === document.body) return undefined;
      const marcado = (elemento: Element) => {
        const estilo = getComputedStyle(elemento);
        return (estilo.outlineStyle !== 'none' && parseFloat(estilo.outlineWidth) > 0) || estilo.boxShadow !== 'none';
      };
      const etiqueta = activo.closest('label');
      return {
        parada: activo.dataset.parada,
        texto: (activo.getAttribute('aria-label') ?? (activo as HTMLInputElement).labels?.[0]?.textContent ?? (activo.textContent || activo.tagName)).trim().slice(0, 60),
        visible: marcado(activo) || (etiqueta !== null && marcado(etiqueta)),
      };
    });
    if (paso === undefined || paso.parada === anterior) continue;
    anterior = paso.parada;
    if (paso.parada !== undefined && alcanzados.has(paso.parada)) break;
    if (paso.parada !== undefined) alcanzados.add(paso.parada);
    if (!paso.visible) sinFocoVisible.push(paso.texto);
  }

  const sinAlcanzar = await pagina.evaluate(
    (vistos) =>
      [...document.querySelectorAll<HTMLElement>('[data-parada]')]
        .filter((c) => !vistos.includes(c.dataset.parada!))
        .map((c) => (c.getAttribute('aria-label') ?? (c as HTMLInputElement).labels?.[0]?.textContent ?? (c.textContent || c.tagName)).trim().slice(0, 60)),
    [...alcanzados],
  );
  return { sinAlcanzar, sinFocoVisible };
}

export type DatosDeRecorrido = {
  clienteId: string;
  direccionId: string;
  calificacionId: string;
  viajes: { completado: string; enCurso: string };
};

export type ClienteDeEjemplo = { clienteId: string; viajes: { completado: string; enCurso: string } };

// Un cliente recién creado con «Cargar ejemplo»: tres direcciones, preferencias y dos viajes en el M6 simulado (uno completado y
// otro en curso), sin calificar. Los campos del alta se pueden cambiar (los valores máximos).
export async function clienteConEjemplo(panel: PanelConM2, cambios: Partial<CamposCliente> = {}): Promise<ClienteDeEjemplo> {
  const clienteId = randomUUID();
  const api = panel.api(() => ({ rol: 'CLIENTE', sub: clienteId }));
  await api.crearCliente(cuerpoDeAlta({ ...CLIENTE_DE_EJEMPLO, ...cambios }), randomUUID());
  const { escenarios } = await cargarEjemplo({ api, viajes: panel.viajes }, clienteId, () => undefined);
  const viaje = (nombre: string) => escenarios.find((e) => e.nombre === nombre)!.viajeId;
  return { clienteId, viajes: { completado: viaje('completado'), enCurso: viaje('enCurso') } };
}

// Un cliente con todo lo que muestran sus pantallas: el del ejemplo, una calificación del viaje completado y un bloqueo vigente,
// para que ninguna pantalla se recorra vacía.
export async function prepararCliente(panel: PanelConM2): Promise<DatosDeRecorrido> {
  const { clienteId, viajes } = await clienteConEjemplo(panel);
  const api = panel.api(() => ({ rol: 'CLIENTE', sub: clienteId }));
  const calificacion = await api.calificarConductor(clienteId, cuerpoDeCalificacion(viajes.completado, { puntaje: '4', comentario: 'Puntual' }), randomUUID());
  const operador = panel.api(() => ({ rol: 'OPERADOR', sub: 'operador-de-prueba' }));
  await operador.crearBloqueo(clienteId, { motivo: 'Pagos pendientes' }, randomUUID());
  const { items } = await api.listarDirecciones(clienteId);
  return { clienteId, direccionId: items[0]!.direccionId, calificacionId: calificacion.calificacionId, viajes };
}

// Pulsa Tab hasta que el foco llegue a un control con ese nombre visible (texto o `aria-label`), sin usar el ratón. Falla si da la
// vuelta entera sin encontrarlo.
export async function tabularHasta(pagina: Page, nombre: string, maximo = 60): Promise<void> {
  for (let i = 0; i < maximo; i++) {
    await pagina.keyboard.press('Tab');
    const actual = await pagina.evaluate(() => {
      const activo = document.activeElement as HTMLElement | null;
      return (activo?.getAttribute('aria-label') ?? activo?.textContent ?? '').trim();
    });
    if (actual === nombre) return;
  }
  throw new Error(`El tabulador no llegó a «${nombre}» en ${maximo} pasos`);
}

// Los pedidos a M2 que salen del navegador (por el panel), con su método, su camino y su `Idempotency-Key`: cuántas veces se mandó
// algo y con qué clave.
export type PedidoVisto = { metodo: string; camino: string; clave: string | undefined };
export function verPedidosAM2(pagina: Page): PedidoVisto[] {
  const vistos: PedidoVisto[] = [];
  pagina.on('request', (pedido) => {
    const { pathname } = new URL(pedido.url());
    if (pathname.startsWith('/api/v1/')) vistos.push({ metodo: pedido.method(), camino: pathname, clave: pedido.headers()['idempotency-key'] });
  });
  return vistos;
}

// Demora los pedidos a M2 que cumplan con `metodo` (todos, sin él) para ver la espera: el navegador los retiene antes de mandarlos.
export async function demorarPedidos(pagina: Page, ms: number, metodo?: string): Promise<() => Promise<void>> {
  const patron = (url: URL) => url.pathname.startsWith('/api/v1/');
  await pagina.route(patron, async (ruta) => {
    if (metodo === undefined || ruta.request().method() === metodo) await new Promise((listo) => setTimeout(listo, ms));
    await ruta.fallback();
  });
  return () => pagina.unroute(patron);
}

// Los controles visibles deshabilitados: después de «M2 no responde» no tiene que quedar ninguno (RNF-15.4).
export const controlesDeshabilitados = (pagina: Page): Promise<string[]> =>
  pagina.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button, input, select, textarea')]
      .filter((control) => control.matches(':disabled') && control.checkVisibility({ visibilityProperty: true }))
      .map((control) => (control.getAttribute('aria-label') ?? (control.textContent || control.tagName)).trim().slice(0, 60)),
  );

// Los trozos de `texto` que se dibujan fuera de la vista o recortados por su caja (RNF-15.5): cada nodo de texto que lo contiene
// tiene que quedar entre el borde izquierdo y el derecho de la ventana, y entero dentro de su elemento si este recorta.
export const textoFueraDeLugar = (pagina: Page, texto: string): Promise<string[]> =>
  pagina.evaluate((buscado) => {
    const problemas: string[] = [];
    const recorrido = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let encontrados = 0;
    for (let nodo = recorrido.nextNode(); nodo !== null; nodo = recorrido.nextNode()) {
      if (!nodo.textContent?.includes(buscado)) continue;
      const padre = nodo.parentElement!;
      // Lo que solo lee el lector de pantalla (una caja de 1×1 que recorta) no se dibuja.
      const { width, height } = padre.getBoundingClientRect();
      if (!padre.checkVisibility({ visibilityProperty: true }) || (width <= 1 && height <= 1)) continue;
      encontrados++;
      const rango = document.createRange();
      rango.selectNodeContents(nodo);
      const caja = rango.getBoundingClientRect();
      const etiqueta = `<${padre.tagName.toLowerCase()} class="${padre.className}">`;
      if (caja.left < -0.5 || caja.right > document.documentElement.clientWidth + 0.5) {
        problemas.push(`${etiqueta} se sale de la ventana: ${Math.round(caja.left)} a ${Math.round(caja.right)}`);
      }
      const estilo = getComputedStyle(padre);
      if (estilo.overflowX !== 'visible' && padre.scrollWidth > padre.clientWidth + 1 && estilo.textOverflow !== 'ellipsis') {
        problemas.push(`${etiqueta} recorta el texto: ${padre.scrollWidth} de ancho en ${padre.clientWidth}`);
      }
    }
    if (encontrados === 0) problemas.push('el texto no está en la pantalla');
    return problemas;
  }, texto);
