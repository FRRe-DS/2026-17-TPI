import { existsSync, globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { IMAGEN_POSTGRES } from '../ayudas/global.js';
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

// Los proyectos de Vitest (RNF-07.1, RNF-07.5), tal como los declara vitest.config.ts: `include` dice qué pruebas son de cada uno
// y `globalSetup`, qué corre antes de ellas.
type Proyecto = { test: { name: string; include: string[]; globalSetup?: string[] } };

const proyectos = (configuracionDeVitest.test?.projects ?? []).filter(
  (proyecto): proyecto is Proyecto => typeof proyecto === 'object' && 'test' in proyecto,
);
const raizEnDisco = fileURLToPath(raiz);
// globSync devuelve las rutas con el separador de la plataforma («\» en Windows), y acá se comparan con prefijos escritos con «/».
const conBarras = (ruta: string) => ruta.replaceAll('\\', '/');
const archivosDe = (proyecto: Proyecto) => globSync(proyecto.test.include, { cwd: raizEnDisco }).map(conBarras);
const todasLasPruebas = globSync('pruebas/**/*.test.ts', { cwd: raizEnDisco }).map(conBarras);

describe('vitest.config.ts: unitarias, integracion y navegador (RNF-07.1, RNF-07.5)', () => {
  it('declara los tres proyectos, en ese orden', () => {
    expect(proyectos.map((proyecto) => proyecto.test.name)).toEqual(['unitarias', 'integracion', 'navegador']);
  });

  // Sin Docker se corre `vitest run --project unitarias`: por eso solo integracion levanta la base.
  it('solo integracion tiene un globalSetup, el que levanta la base', () => {
    const [unitarias, integracion] = proyectos;
    expect(unitarias?.test.globalSetup).toBeUndefined();
    expect(integracion?.test.globalSetup).toEqual(['pruebas/ayudas/global.ts']);
    expect(existsSync(new URL('pruebas/ayudas/global.ts', raiz))).toBe(true);
  });

  // `navegador` queda fuera: sus pruebas llegan en las últimas tareas de la spec 071 (corren con `npm run panel:navegador`, no con `npm test`).
  it('hay pruebas en unitarias y en integracion', () => {
    for (const proyecto of proyectos.filter((candidato) => candidato.test.name !== 'navegador')) {
      expect(archivosDe(proyecto).length, proyecto.test.name).toBeGreaterThan(0);
    }
  });

  // Un archivo fuera de los `include` no correría nunca y la suite seguiría en verde.
  it('toda prueba de pruebas/ cae en un proyecto', () => {
    const cubiertas = new Set(proyectos.flatMap(archivosDe));
    expect(todasLasPruebas.filter((archivo) => !cubiertas.has(archivo))).toEqual([]);
  });

  it('ninguna prueba cae en dos proyectos', () => {
    const repetidas = proyectos.flatMap(archivosDe).filter((archivo, i, todas) => todas.indexOf(archivo) !== i);
    expect(repetidas).toEqual([]);
  });

  it('las de integracion/ son de integracion, las de panel/navegador/ de navegador, y las demás, de unitarias', () => {
    const [unitarias, integracion, navegador] = proyectos;
    const deUnitarias = new Set(unitarias ? archivosDe(unitarias) : []);
    const deIntegracion = new Set(integracion ? archivosDe(integracion) : []);
    const deNavegador = new Set(navegador ? archivosDe(navegador) : []);
    const alReves = todasLasPruebas.filter((archivo) => {
      if (/^pruebas\/(panel\/)?integracion\//.test(archivo)) return !deIntegracion.has(archivo);
      if (archivo.startsWith('pruebas/panel/navegador/')) return !deNavegador.has(archivo);
      return !deUnitarias.has(archivo);
    });
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

// El nombre de una imagen con su etiqueta, como «node:24.22.0-trixie-slim». La versión exacta es la completa del producto:
// X.Y.Z para Node y X.Y para PostgreSQL (`partes`). Sin etiqueta o con una incompleta (latest, 24, 24-slim, 24.22) no lo es
// (RNF-04.1).
const imagenExacta = (imagen: string, partes = 3): boolean =>
  new RegExp(`^[^:@\\s]+:\\d+(\\.\\d+){${partes - 1}}(-[0-9A-Za-z.-]+)?$`).test(imagen);

describe('imagenExacta', () => {
  it.each(['node:24.22.0-trixie-slim', 'postgres:18.6.0', 'registro.local/node:1.2.3'])('acepta %s', (imagen) => {
    expect(imagenExacta(imagen)).toBe(true);
  });

  it.each(['node', 'node:latest', 'node:24', 'node:24-trixie-slim', 'node:24.22', 'node:24.22-slim', 'node@sha256:abc'])(
    'rechaza %s',
    (imagen) => {
      expect(imagenExacta(imagen)).toBe(false);
    },
  );

  it('con dos partes acepta postgres:18.6 y rechaza postgres:18 y postgres:latest', () => {
    expect(imagenExacta('postgres:18.6', 2)).toBe(true);
    expect(imagenExacta('postgres:18', 2)).toBe(false);
    expect(imagenExacta('postgres:latest', 2)).toBe(false);
  });
});

// Las instrucciones de un Dockerfile, sin comentarios y con las líneas continuadas con «\» unidas.
const instruccionesDe = (texto: string): string[] =>
  texto
    .replaceAll('\r\n', '\n')
    .replace(/\\\n/g, ' ')
    .split('\n')
    .map((linea) => linea.trim())
    .filter((linea) => linea !== '' && !linea.startsWith('#'));

describe('Dockerfile (RNF-04.1, RNF-04.2)', () => {
  const dockerfile = instruccionesDe(readFileSync(new URL('Dockerfile', raiz), 'utf8'));
  const etapas = dockerfile.filter((linea) => /^FROM\s/i.test(linea));
  // «FROM imagen AS nombre»: la imagen es el primer argumento que no es una opción (--platform=…).
  const imagenDe = (linea: string) => linea.split(/\s+/).slice(1).find((parte) => !parte.startsWith('--')) ?? '';

  it('tiene dos etapas, construcción y ejecución', () => {
    expect(etapas).toHaveLength(2);
  });

  it('las dos parten de una imagen con versión exacta, nunca latest', () => {
    expect(etapas.map(imagenDe).filter((imagen) => !imagenExacta(imagen))).toEqual([]);
  });

  it('las dos parten de la misma imagen', () => {
    expect(new Set(etapas.map(imagenDe)).size).toBe(1);
  });

  it('instala con npm ci en las dos etapas y nunca con npm install', () => {
    const instalaciones = dockerfile.filter((linea) => /^RUN\s.*\bnpm\s+(ci|install|i|add)\b/i.test(linea));
    expect(instalaciones).toHaveLength(2);
    expect(instalaciones.filter((linea) => !/\bnpm\s+ci\b/.test(linea))).toEqual([]);
  });

  it('la etapa de ejecución instala solo lo de producción', () => {
    const ejecucion = dockerfile.slice(dockerfile.indexOf(etapas[1] ?? ''));
    expect(ejecucion.some((linea) => /^RUN\s.*\bnpm\s+ci\b.*--omit=dev\b/.test(linea))).toBe(true);
  });

  it('corre con el usuario node y arranca con node dist/servidor.js en forma exec', () => {
    expect(dockerfile.filter((linea) => /^USER\s/i.test(linea))).toEqual(['USER node']);
    expect(dockerfile.at(-1)).toBe('CMD ["node", "dist/servidor.js"]');
  });

  it('la imagen de ejecución lleva dist, contrato y migraciones', () => {
    const ejecucion = dockerfile.slice(dockerfile.indexOf(etapas[1] ?? ''));
    const copias = ejecucion.filter((linea) => /^COPY\s/i.test(linea)).join('\n');
    for (const carpeta of ['dist', 'contrato', 'migraciones']) expect(copias, carpeta).toMatch(new RegExp(`(^|[/\\s])${carpeta} `));
  });
});

describe('.dockerignore (RNF-04.2)', () => {
  const ignorados = readFileSync(new URL('.dockerignore', raiz), 'utf8')
    .split('\n')
    .map((linea) => linea.trim())
    .filter((linea) => linea !== '' && !linea.startsWith('#'));

  it.each(['node_modules', 'dist', '.git', 'specs', 'docs', 'pruebas', 'ejemplo.env', '.env', 'EN-CURSO.local.md'])(
    'deja afuera %s',
    (ruta) => {
      expect(ignorados).toContain(ruta);
    },
  );

  // Lo que la construcción necesita no puede quedar afuera.
  it.each(['src', 'contrato', 'migraciones', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'])(
    'no deja afuera %s',
    (ruta) => {
      expect(ignorados.filter((linea) => linea === ruta || linea === `${ruta}/` || linea === '*')).toEqual([]);
    },
  );
});

type ServicioCompose = {
  build?: string;
  image?: string;
  env_file?: string | string[];
  init?: boolean;
  ports?: string[];
  depends_on?: { [servicio: string]: { condition?: string } };
  healthcheck?: { test?: string[]; interval?: string; timeout?: string; retries?: number; start_period?: string };
  volumes?: string[];
};
type Compose = { services?: { [nombre: string]: ServicioCompose | undefined }; volumes?: { [nombre: string]: unknown } };

describe('docker-compose.yml (RNF-04.1, RNF-04.3, RNF-04.4)', () => {
  const compose = parseYaml(readFileSync(new URL('docker-compose.yml', raiz), 'utf8')) as Compose;
  const m2 = compose.services?.['m2'];
  const bd = compose.services?.['bd'];

  it('declara solo los servicios m2 y bd', () => {
    expect(Object.keys(compose.services ?? {}).sort()).toEqual(['bd', 'm2']);
  });

  it('las imágenes tienen versión exacta, nunca latest', () => {
    expect(imagenExacta(m2?.image ?? '')).toBe(true);
    expect(imagenExacta(bd?.image ?? '', 2)).toBe(true);
  });

  it('la imagen de la base es la misma que levantan las pruebas de integración', () => {
    expect(bd?.image).toBe(IMAGEN_POSTGRES);
  });

  it('la etiqueta de la imagen de m2 es la versión de package.json', () => {
    expect(m2?.image).toBe(`m2-clientes:${String(paquete['version'])}`);
  });

  it('m2 se construye con el Dockerfile de la raíz y usa ejemplo.env', () => {
    expect(m2?.build).toBe('.');
    expect([m2?.env_file].flat()).toEqual(['ejemplo.env']);
    expect([bd?.env_file].flat()).toEqual(['ejemplo.env']);
  });

  it('m2 usa init, publica el puerto configurado (8082 por defecto) y espera a que la base esté sana', () => {
    expect(m2?.init).toBe(true);
    expect(m2?.ports).toEqual(['${M2_PUERTO:-8082}:${M2_PUERTO:-8082}']);
    expect(m2?.depends_on).toEqual({ bd: { condition: 'service_healthy' } });
  });

  it('la base no publica ningún puerto y guarda sus datos en el volumen datos-bd', () => {
    expect(bd?.ports).toBeUndefined();
    expect(bd?.volumes).toEqual(['datos-bd:/var/lib/postgresql']);
    expect(Object.keys(compose.volumes ?? {})).toEqual(['datos-bd']);
  });

  // La imagen de m2 no trae curl ni wget; el chequeo lo hace Node, con un GET (wget --spider manda HEAD y da 405).
  it('el chequeo de m2 es un GET a /health con Node, en el puerto configurado', () => {
    const [forma, programa, ...resto] = m2?.healthcheck?.test ?? [];
    expect(forma).toBe('CMD');
    expect(programa).toBe('node');
    const codigo = resto.join(' ');
    expect(codigo).toContain('fetch(');
    expect(codigo).toContain('/health');
    expect(codigo).toContain('process.env.M2_PUERTO');
    expect(codigo).not.toContain('$');
    expect(m2?.healthcheck).toMatchObject({ interval: '5s', timeout: '3s', retries: 6, start_period: '30s' });
  });

  // Por TCP (-h 127.0.0.1): el servidor temporal de la inicialización solo escucha por socket. Con $$, para que las
  // variables las lea el contenedor y no compose.
  it('el chequeo de la base usa pg_isready por TCP y las variables del contenedor', () => {
    const prueba = (bd?.healthcheck?.test ?? []).join(' ');
    expect(prueba).toContain('pg_isready');
    expect(prueba).toContain('-h 127.0.0.1');
    expect(prueba).toContain('$$POSTGRES_USER');
    expect(prueba).toContain('$$POSTGRES_DB');
    expect(bd?.healthcheck).toMatchObject({ interval: '2s', timeout: '2s', retries: 20 });
  });
});
