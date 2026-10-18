import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Una versión exacta es X.Y.Z, con prelanzamiento o build opcionales. Todo lo demás es un rango o una etiqueta:
// ^1.2.3, ~1.2.3, *, latest, >=1, 1.x, 1.2.3 - 2.0.0, 1.0.0 || 2.0.0, next.
const VERSION_EXACTA = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

const esRango = (version: string): boolean => !VERSION_EXACTA.test(version);

type Seccion = { [nombre: string]: string | Seccion };

// Devuelve cada versión de una sección de package.json con su ruta, por ejemplo ["devDependencies.vitest", "5.0.5"].
// Los overrides pueden anidarse.
function versionesDe(ruta: string, seccion: Seccion): [string, string][] {
  return Object.entries(seccion).flatMap(([nombre, valor]): [string, string][] =>
    typeof valor === 'string' ? [[`${ruta}.${nombre}`, valor]] : versionesDe(`${ruta}.${nombre}`, valor),
  );
}

const raiz = new URL('../../', import.meta.url);
const paquete = JSON.parse(readFileSync(new URL('package.json', raiz), 'utf8')) as Record<string, Seccion | undefined>;

const SECCIONES = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'overrides'];

describe('package.json (RNF-01.1)', () => {
  // "$typescript" en un override apunta a la dependencia directa de ese nombre: no es un rango.
  const declaradas = SECCIONES.flatMap((seccion) => versionesDe(seccion, paquete[seccion] ?? {})).filter(
    ([, version]) => !version.startsWith('$'),
  );

  it('declara dependencias', () => {
    expect(declaradas.length).toBeGreaterThan(0);
  });

  it('ninguna dependencia usa rangos ni etiquetas', () => {
    const rangos = declaradas.filter(([, version]) => esRango(version)).map(([ruta, version]) => `${ruta}: ${version}`);
    expect(rangos).toEqual([]);
  });
});

describe('esRango', () => {
  it.each(['^1.2.3', '~1.2.3', '*', 'latest', 'next', '>=1.2.3', '1.x', '1', '1.2', '1.2.3 - 2.0.0', '1.2.3 || 2.0.0'])(
    'reconoce %s como rango',
    (version) => {
      expect(esRango(version)).toBe(true);
    },
  );

  it.each(['1.2.3', '0.0.1', '10.20.30', '1.2.3-beta.1', '1.2.3+build.5'])('acepta %s como exacta', (version) => {
    expect(esRango(version)).toBe(false);
  });
});
