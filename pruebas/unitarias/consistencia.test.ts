import { existsSync, globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import configuracionDeVitest from '../../vitest.config.js';

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
const bloqueo = JSON.parse(readFileSync(new URL('package-lock.json', raiz), 'utf8')) as {
  packages: { [ruta: string]: { engines?: { node?: string } } | undefined };
};

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

// El comando de tokens usa import.meta.main, que existe desde Node 24.2.0 (plan, Versiones a fijar). Con `^24`, en
// Node 24.0 o 24.1 no imprime nada y sale con 0.
const ENGINES_NODE = '^24.2.0';

describe('engines.node (RNF-01.1)', () => {
  it('package.json pide Node 24.2.0 o más nuevo de la serie 24', () => {
    expect(paquete.engines?.node).toBe(ENGINES_NODE);
  });

  // npm install y npm ci copian engines de package.json al paquete raíz del lock, que es la entrada "".
  it('package-lock.json lo repite en el paquete raíz', () => {
    expect(bloqueo.packages['']?.engines?.node).toBe(ENGINES_NODE);
  });
});

// Los dos proyectos de Vitest (RNF-07.1), tal como los declara vitest.config.ts: `include` dice qué pruebas son de cada uno
// y `globalSetup`, qué corre antes de ellas.
type Proyecto = { test: { name: string; include: string[]; globalSetup?: string[] } };

const proyectos = (configuracionDeVitest.test?.projects ?? []).filter(
  (proyecto): proyecto is Proyecto => typeof proyecto === 'object' && 'test' in proyecto,
);
const raizEnDisco = fileURLToPath(raiz);
const archivosDe = (proyecto: Proyecto) => globSync(proyecto.test.include, { cwd: raizEnDisco });
const todasLasPruebas = globSync('pruebas/**/*.test.ts', { cwd: raizEnDisco });

describe('vitest.config.ts: unitarias e integracion (RNF-07.1)', () => {
  it('declara los dos proyectos, en ese orden', () => {
    expect(proyectos.map((proyecto) => proyecto.test.name)).toEqual(['unitarias', 'integracion']);
  });

  // Sin Docker se corre `vitest run --project unitarias`: por eso solo integracion levanta la base.
  it('solo integracion tiene un globalSetup, el que levanta la base', () => {
    const [unitarias, integracion] = proyectos;
    expect(unitarias?.test.globalSetup).toBeUndefined();
    expect(integracion?.test.globalSetup).toEqual(['pruebas/ayudas/global.ts']);
    expect(existsSync(new URL('pruebas/ayudas/global.ts', raiz))).toBe(true);
  });

  it('hay pruebas en los dos proyectos', () => {
    for (const proyecto of proyectos) expect(archivosDe(proyecto).length, proyecto.test.name).toBeGreaterThan(0);
  });

  // Un archivo fuera de los dos `include` no correría nunca y la suite seguiría en verde.
  it('toda prueba de pruebas/ cae en un proyecto', () => {
    const cubiertas = new Set(proyectos.flatMap(archivosDe));
    expect(todasLasPruebas.filter((archivo) => !cubiertas.has(archivo))).toEqual([]);
  });

  it('ninguna prueba cae en los dos proyectos', () => {
    const repetidas = proyectos.flatMap(archivosDe).filter((archivo, i, todas) => todas.indexOf(archivo) !== i);
    expect(repetidas).toEqual([]);
  });

  it('las de pruebas/integracion/ son de integracion, y las demás, de unitarias', () => {
    const [unitarias, integracion] = proyectos;
    const deIntegracion = new Set(integracion ? archivosDe(integracion) : []);
    const deUnitarias = new Set(unitarias ? archivosDe(unitarias) : []);
    const alReves = todasLasPruebas.filter((archivo) =>
      archivo.startsWith('pruebas/integracion/') ? !deIntegracion.has(archivo) : !deUnitarias.has(archivo),
    );
    expect(alReves).toEqual([]);
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
