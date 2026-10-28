import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Las variables de color del panel (T17), leídas del CSS que se entrega: el contraste se calcula sobre los valores reales, en modo
// claro (`:root`) y oscuro (`:root` dentro de `prefers-color-scheme: dark`). RNF-15.3 pide 4,5:1 en el texto; los bordes de los
// campos y el foco se piden a 3:1 (WCAG 1.4.11).
const CSS = readFileSync(new URL('../../../panel/cliente/src/estilos/variables.css', import.meta.url), 'utf8');

const HEX = /^#[0-9a-f]{6}$/i;

function colores(bloque: string): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const [, nombre, valor] of bloque.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    if (valor!.trim().startsWith('#')) mapa.set(nombre!, valor!.trim());
  }
  return mapa;
}

// El primer `:root { … }` del archivo es el modo claro; el que está dentro de la consulta de modo oscuro, el oscuro.
function modos(css: string): { claro: Map<string, string>; oscuro: Map<string, string> } {
  const claro = /^:root\s*\{([^}]*)\}/m.exec(css);
  const oscuro = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css);
  if (claro === null || oscuro === null) throw new Error('Faltan los bloques :root de modo claro u oscuro en variables.css');
  return { claro: colores(claro[1]!), oscuro: colores(oscuro[1]!) };
}

function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contraste(a: string, b: string): number {
  const [clara, oscura] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (clara! + 0.05) / (oscura! + 0.05);
}

// Cada color de texto con cada fondo sobre el que aparece.
const TEXTO: [string, string[]][] = [
  ['--tinta', ['--papel', '--hoja', '--campo', '--seleccion', '--ok-fondo', '--mal-fondo', '--aviso-fondo']],
  ['--tinta-suave', ['--papel', '--hoja', '--campo']],
  ['--acento', ['--papel', '--hoja', '--campo', '--etiqueta-fondo', '--acento-tenue']],
  ['--sobre-acento', ['--acento']],
  ['--hoja', ['--tinta', '--mal']],
  ['--lateral-texto', ['--lateral', '--lateral-hover']],
  ['--lateral-suave', ['--lateral']],
  ['--lateral', ['--lateral-texto']],
  ['--franja-texto', ['--franja']],
  ['--franja-metodo', ['--franja']],
  ['--franja-ok', ['--franja']],
  ['--franja-mal', ['--franja']],
  ['--ok', ['--papel', '--hoja', '--ok-fondo']],
  ['--mal', ['--papel', '--hoja', '--campo', '--mal-fondo']],
  ['--aviso', ['--papel', '--hoja', '--aviso-fondo']],
];

// Lo que no es texto pero hay que distinguir: el borde de un campo y el anillo de foco.
const COMPONENTES: [string, string[]][] = [
  ['--borde-campo', ['--campo', '--hoja']],
  ['--foco', ['--papel', '--hoja', '--campo']],
  ['--lateral-texto', ['--lateral']],
];

// Colores que solo dibujan líneas o rellenos sin texto encima.
const DECORATIVOS = ['--regla', '--lateral-regla', '--franja-pista'];

const { claro, oscuro } = modos(CSS);

describe('variables de color del panel (RNF-15.3)', () => {
  it('los dos modos definen los mismos colores, todos en #rrggbb', () => {
    expect([...oscuro.keys()].sort()).toEqual([...claro.keys()].sort());
    for (const valor of [...claro.values(), ...oscuro.values()]) expect(valor).toMatch(HEX);
  });

  it('cada color está clasificado como texto, componente o decorativo', () => {
    const clasificados = new Set([...TEXTO, ...COMPONENTES].flatMap(([frente, fondos]) => [frente, ...fondos]).concat(DECORATIVOS));

    expect([...claro.keys()].filter((nombre) => !clasificados.has(nombre))).toEqual([]);
    expect([...clasificados].filter((nombre) => !claro.has(nombre))).toEqual([]);
  });

  for (const [modo, colores] of [['claro', claro], ['oscuro', oscuro]] as const) {
    describe(`modo ${modo}`, () => {
      it.each(TEXTO.flatMap(([frente, fondos]) => fondos.map((fondo) => [frente, fondo] as const)))(
        'texto %s sobre %s: al menos 4,5:1',
        (frente, fondo) => {
          expect(contraste(colores.get(frente)!, colores.get(fondo)!)).toBeGreaterThanOrEqual(4.5);
        },
      );

      it.each(COMPONENTES.flatMap(([frente, fondos]) => fondos.map((fondo) => [frente, fondo] as const)))(
        'borde o foco %s sobre %s: al menos 3:1',
        (frente, fondo) => {
          expect(contraste(colores.get(frente)!, colores.get(fondo)!)).toBeGreaterThanOrEqual(3);
        },
      );
    });
  }
});

describe('contraste (la fórmula de WCAG)', () => {
  it('negro sobre blanco es 21:1 y un color consigo mismo, 1:1', () => {
    expect(contraste('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contraste('#6b4a2e', '#6b4a2e')).toBe(1);
  });

  it('da lo mismo el orden', () => {
    expect(contraste('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contraste('#ffffff', '#777777')).toBeCloseTo(4.48, 2);
  });
});

describe('sin recursos de terceros (RNF-15, plan, Diseño visual)', () => {
  it('las variables no traen fuentes, imágenes ni direcciones de afuera', () => {
    expect(CSS).not.toMatch(/@import|@font-face|url\(/i);
  });
});
