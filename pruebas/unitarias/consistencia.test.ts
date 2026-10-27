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
  build?: string | { context?: string; dockerfile?: string; target?: string };
  profiles?: string[];
  environment?: Record<string, string>;
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

  it('declara m2 y bd, y los dos del panel (spec 071) solo bajo el perfil panel', () => {
    expect(Object.keys(compose.services ?? {}).sort()).toEqual(['bd', 'm2', 'm6', 'panel']);
    expect(m2?.profiles).toBeUndefined();
    expect(bd?.profiles).toBeUndefined();
    for (const nombre of ['m6', 'panel']) expect(compose.services?.[nombre]?.profiles, nombre).toEqual(['panel']);
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

describe('panel/Dockerfile (spec 071, RNF-04.6)', () => {
  const dockerfile = instruccionesDe(readFileSync(new URL('panel/Dockerfile', raiz), 'utf8'));
  const etapas = dockerfile.filter((linea) => /^FROM\s/i.test(linea));
  const imagenDe = (linea: string) => linea.split(/\s+/).slice(1).find((parte) => !parte.startsWith('--')) ?? '';
  const delDockerfileDeM2 = instruccionesDe(readFileSync(new URL('Dockerfile', raiz), 'utf8'))
    .filter((linea) => /^FROM\s/i.test(linea))
    .map(imagenDe);

  it('parte de la misma imagen con versión exacta que M2, y las otras dos etapas parten de la de producción', () => {
    const externas = etapas.map(imagenDe).filter((imagen) => !['produccion'].includes(imagen));
    expect(externas).toHaveLength(2);
    expect(externas.filter((imagen) => !imagenExacta(imagen))).toEqual([]);
    expect(new Set([...externas, ...delDockerfileDeM2]).size).toBe(1);
  });

  it('tiene los destinos m6-simulado y panel', () => {
    expect(etapas.filter((linea) => /\sAS\s+(m6-simulado|panel)$/i.test(linea))).toHaveLength(2);
  });

  it('instala con npm ci y la etapa de producción solo lo de producción y sin scripts', () => {
    const instalaciones = dockerfile.filter((linea) => /^RUN\s.*\bnpm\s+(ci|install|i|add)\b/i.test(linea));
    expect(instalaciones).toHaveLength(2);
    expect(instalaciones.filter((linea) => !/\bnpm\s+ci\b/.test(linea))).toEqual([]);
    expect(instalaciones.filter((linea) => /--omit=dev\b/.test(linea) && /--ignore-scripts\b/.test(linea))).toHaveLength(1);
  });

  it('corre con el usuario node y arranca cada destino con node en forma exec', () => {
    expect(dockerfile.filter((linea) => /^USER\s/i.test(linea))).toEqual(['USER node']);
    expect(dockerfile.filter((linea) => /^CMD\s/i.test(linea))).toEqual([
      'CMD ["node", "panel/dist/m6-simulado/main.js"]',
      'CMD ["node", "panel/dist/servidor/main.js"]',
    ]);
  });

  it('la imagen del M6 simulado no lleva el cliente compilado y la del panel sí', () => {
    // Las instrucciones de la etapa llamada `nombre`, hasta el siguiente FROM.
    const delDestino = (nombre: string) =>
      dockerfile
        .join('\n')
        .split(/^(?=FROM\s)/m)
        .find((etapa) => new RegExp(`^FROM\\s.*\\sAS\\s+${nombre}\\s*\\n`, 'i').test(`${etapa}\n`)) ?? '';
    expect(delDestino('m6-simulado')).toContain('panel/dist/m6-simulado/main.js');
    expect(delDestino('m6-simulado')).not.toContain('dist/cliente');
    expect(delDestino('panel')).toContain('/app/panel/dist/cliente');
  });
});

describe('panel/Dockerfile.dockerignore (spec 071, RNF-04.2)', () => {
  const ignorados = readFileSync(new URL('panel/Dockerfile.dockerignore', raiz), 'utf8')
    .split('\n')
    .map((linea) => linea.trim())
    .filter((linea) => linea !== '' && !linea.startsWith('#'));

  it.each(['node_modules', 'panel/dist', '.git', 'ejemplo.env', '.env', 'pruebas', 'EN-CURSO.local.md'])('deja afuera %s', (ruta) => {
    expect(ignorados).toContain(ruta);
  });

  it.each(['panel', 'contrato', 'package.json', 'package-lock.json', 'tsconfig.json'])('no deja afuera %s', (ruta) => {
    expect(ignorados.filter((linea) => linea === ruta || linea === `${ruta}/` || linea === '*')).toEqual([]);
  });
});

describe('docker-compose.yml: perfil panel (spec 071, RNF-04.6)', () => {
  const compose = parseYaml(readFileSync(new URL('docker-compose.yml', raiz), 'utf8')) as Compose;
  const panel = compose.services?.['panel'];
  const m6 = compose.services?.['m6'];
  const codigoDelChequeo = (servicio: typeof panel) => (servicio?.healthcheck?.test ?? []).slice(2).join(' ');

  it('las imágenes llevan la versión de package.json', () => {
    expect(panel?.image).toBe(`m2-panel:${String(paquete['version'])}`);
    expect(m6?.image).toBe(`m2-m6-simulado:${String(paquete['version'])}`);
  });

  it('se construyen con panel/Dockerfile desde la raíz, cada uno con su destino, y leen ejemplo.env', () => {
    expect(panel?.build).toEqual({ context: '.', dockerfile: 'panel/Dockerfile', target: 'panel' });
    expect(m6?.build).toEqual({ context: '.', dockerfile: 'panel/Dockerfile', target: 'm6-simulado' });
    expect([panel?.env_file].flat()).toEqual(['ejemplo.env']);
    expect([m6?.env_file].flat()).toEqual(['ejemplo.env']);
    expect(panel?.init).toBe(true);
    expect(m6?.init).toBe(true);
  });

  it('el panel y el canal de control se publican solo en 127.0.0.1, y la API de M6 no se publica', () => {
    expect(panel?.ports).toEqual(['127.0.0.1:${PANEL_PUERTO:-8083}:${PANEL_PUERTO:-8083}']);
    expect(m6?.ports).toEqual(['127.0.0.1:${M6_PUERTO_CONTROL:-3007}:${M6_PUERTO_CONTROL:-3007}']);
  });

  it('dentro del contenedor el panel escucha en todas las interfaces y llama a M2 y al canal por el nombre del servicio', () => {
    expect(panel?.environment).toMatchObject({
      PANEL_ESCUCHA: '0.0.0.0',
      PANEL_URL_M2: 'http://m2:${M2_PUERTO:-8082}',
      PANEL_URL_M6_CONTROL: 'http://m6:${M6_PUERTO_CONTROL:-3007}',
    });
  });

  it('el panel espera a que M2 y el M6 simulado estén sanos', () => {
    expect(panel?.depends_on).toEqual({ m2: { condition: 'service_healthy' }, m6: { condition: 'service_healthy' } });
  });

  it('los chequeos son un GET con Node, sin $ de compose, en el puerto del contenedor', () => {
    for (const [servicio, ruta, variable] of [
      [panel, '/salud-panel', 'process.env.PANEL_PUERTO'],
      [m6, '/control/estado', 'process.env.M6_PUERTO_CONTROL'],
    ] as const) {
      expect(servicio?.healthcheck?.test?.slice(0, 2)).toEqual(['CMD', 'node']);
      const codigo = codigoDelChequeo(servicio);
      expect(codigo).toContain('fetch(');
      expect(codigo).toContain(ruta);
      expect(codigo).toContain(variable);
      expect(codigo).not.toContain('$');
    }
  });

  it('el chequeo del M6 simulado mira el canal de control y no la API, que el modo caído cierra', () => {
    expect(codigoDelChequeo(m6)).not.toContain('M6_PUERTO\'');
    expect(codigoDelChequeo(m6)).not.toContain('/api/');
  });
});
