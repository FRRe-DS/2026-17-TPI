import { existsSync, globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { IMAGEN_POSTGRES } from '../ayudas/global.js';
import configuracionDeVitest from '../../vitest.config.js';
import { ARCHIVO_ULTIMO, OrdenDeArchivos } from '../distribuida/ayudas/orden.js';

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

describe('vitest.config.ts: unitarias, integracion, navegador, distribuida y keycloak (RNF-07.1, RNF-07.5, RNF-07.7, RNF-07.13)', () => {
  it('declara los cinco proyectos, en ese orden', () => {
    expect(proyectos.map((proyecto) => proyecto.test.name)).toEqual(['unitarias', 'integracion', 'navegador', 'distribuida', 'keycloak']);
  });

  // Sin Docker se corre `vitest run --project unitarias`: por eso solo integracion levanta la base.
  it('solo integracion tiene un globalSetup, el que levanta la base', () => {
    const [unitarias, integracion] = proyectos;
    expect(unitarias?.test.globalSetup).toBeUndefined();
    expect(integracion?.test.globalSetup).toEqual(['pruebas/ayudas/global.ts']);
    expect(existsSync(new URL('pruebas/ayudas/global.ts', raiz))).toBe(true);
  });

  // `navegador`, `distribuida` y `keycloak` quedan fuera: sus pruebas (specs 071, 081 y 080) corren con `npm run panel:navegador`,
  // `npm run integracion:m6` y `npm run keycloak:test`, no con `npm test`. Sin `--project`, Vitest correría los cinco y un PR
  // dependería del Grupo 12 y de una imagen de Keycloak.
  it('npm test corre solo unitarias e integracion', () => {
    expect(paquete.scripts?.test).toBe('vitest run --project unitarias --project integracion');
  });

  // La prueba con Keycloak real (spec 080, RNF-07.13): levanta su propio compose, con su proyecto y sus puertos.
  it('npm run keycloak:test corre solo el proyecto keycloak, que levanta su entorno con pruebas/keycloak/global.ts', () => {
    expect(paquete.scripts?.['keycloak:test']).toBe('vitest run --project keycloak');
    const keycloak = proyectos.find((proyecto) => proyecto.test.name === 'keycloak');
    expect(keycloak?.test.include).toEqual(['pruebas/keycloak/**/*.test.ts']);
    expect(keycloak?.test.globalSetup).toEqual(['pruebas/keycloak/global.ts']);
    expect(existsSync(new URL('pruebas/keycloak/global.ts', raiz))).toBe(true);
    expect(archivosDe(keycloak ?? { test: { name: '', include: [] } }).length).toBeGreaterThan(0);
  });

  it('hay pruebas en unitarias y en integracion', () => {
    for (const proyecto of proyectos.filter((candidato) => !['navegador', 'distribuida', 'keycloak'].includes(String(candidato.test.name)))) {
      expect(archivosDe(proyecto).length, proyecto.test.name).toBeGreaterThan(0);
    }
  });

  // Un archivo fuera de los `include` no correría nunca y la suite seguiría en verde.
  it('toda prueba de pruebas/ cae en un proyecto', () => {
    const cubiertas = new Set(proyectos.flatMap(archivosDe));
    expect(todasLasPruebas.filter((archivo) => !cubiertas.has(archivo))).toEqual([]);
  });

  // Si el archivo se renombrara, el orden dejaría de aplicarle sin que nada falle, y apagaría a M6 en medio de los demás.
  it('el archivo que apaga a M6 existe y corre al final (spec 081)', () => {
    expect(configuracionDeVitest.test?.sequence?.sequencer).toBe(OrdenDeArchivos);
    expect(existsSync(new URL(ARCHIVO_ULTIMO, raiz))).toBe(true);
  });

  it('ninguna prueba cae en dos proyectos', () => {
    const repetidas = proyectos.flatMap(archivosDe).filter((archivo, i, todas) => todas.indexOf(archivo) !== i);
    expect(repetidas).toEqual([]);
  });

  it('las de integracion/ son de integracion, las de panel/navegador/ de navegador, las de distribuida/ de distribuida, las de keycloak/ de keycloak, y las demás, de unitarias', () => {
    const [unitarias, integracion, navegador, distribuida, keycloak] = proyectos;
    const deUnitarias = new Set(unitarias ? archivosDe(unitarias) : []);
    const deIntegracion = new Set(integracion ? archivosDe(integracion) : []);
    const deNavegador = new Set(navegador ? archivosDe(navegador) : []);
    const deDistribuida = new Set(distribuida ? archivosDe(distribuida) : []);
    const deKeycloak = new Set(keycloak ? archivosDe(keycloak) : []);
    const alReves = todasLasPruebas.filter((archivo) => {
      if (/^pruebas\/(panel\/)?integracion\//.test(archivo)) return !deIntegracion.has(archivo);
      if (archivo.startsWith('pruebas/panel/navegador/')) return !deNavegador.has(archivo);
      if (archivo.startsWith('pruebas/distribuida/')) return !deDistribuida.has(archivo);
      if (archivo.startsWith('pruebas/keycloak/')) return !deKeycloak.has(archivo);
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

  it.each([
    'node_modules',
    'dist',
    '.git',
    'specs',
    'docs',
    'pruebas',
    'ejemplo.env',
    '.env',
    'EN-CURSO.local.md',
    // El perfil keycloak (spec 080): ni su archivo de entorno ni el realm van en la imagen.
    'ejemplo-keycloak.env',
    'keycloak',
  ])(
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
  command?: string | string[];
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

  it('declara m2 y bd, los del panel (specs 071 y 072) solo bajo el perfil panel, los del M6 real (spec 081) solo bajo m6-real y los de Keycloak (spec 080) bajo el suyo', () => {
    expect(Object.keys(compose.services ?? {}).sort()).toEqual(['bd', 'bd-puente', 'keycloak', 'keycloak-bd', 'm2', 'm6', 'm6-real', 'm6-real-bd', 'panel']);
    expect(m2?.profiles).toBeUndefined();
    expect(bd?.profiles).toBeUndefined();
    for (const nombre of ['m6', 'panel', 'bd-puente']) expect(compose.services?.[nombre]?.profiles, nombre).toEqual(['panel']);
    for (const nombre of ['m6-real', 'm6-real-bd']) expect(compose.services?.[nombre]?.profiles, nombre).toEqual(['m6-real']);
    for (const nombre of ['keycloak', 'keycloak-bd']) expect(compose.services?.[nombre]?.profiles, nombre).toEqual(['keycloak']);
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

  it('la base no publica ningún puerto y guarda sus datos en el volumen datos-bd; el de Keycloak es otro (spec 080)', () => {
    expect(bd?.ports).toBeUndefined();
    expect(bd?.volumes).toEqual(['datos-bd:/var/lib/postgresql']);
    expect(Object.keys(compose.volumes ?? {})).toEqual(['datos-bd', 'datos-m6-real-bd', 'datos-keycloak-bd']);
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

  it('parte de la misma imagen con versión exacta que M2, y las otras tres etapas parten de la de producción', () => {
    const externas = etapas.map(imagenDe).filter((imagen) => !['produccion'].includes(imagen));
    expect(externas).toHaveLength(2);
    expect(externas.filter((imagen) => !imagenExacta(imagen))).toEqual([]);
    expect(new Set([...externas, ...delDockerfileDeM2]).size).toBe(1);
  });

  it('tiene los destinos m6-simulado, panel y puente-bd (spec 072)', () => {
    expect(etapas.filter((linea) => /\sAS\s+(m6-simulado|panel|puente-bd)$/i.test(linea))).toHaveLength(3);
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
      'CMD ["node", "panel/dist/puente-bd/main.js"]',
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

  it('la imagen del puente lleva su código compilado y no el cliente (spec 072)', () => {
    const delDestino = dockerfile.join('\n').split(/^(?=FROM\s)/m).find((etapa) => /\sAS\s+puente-bd\s*\n/i.test(`${etapa}\n`)) ?? '';
    expect(delDestino).toContain('panel/dist/puente-bd');
    expect(delDestino).not.toContain('dist/cliente');
    expect(delDestino).toMatch(/^FROM\s+produccion\s/m);
  });
});

describe('panel/Dockerfile.dockerignore (spec 071, RNF-04.2)', () => {
  const ignorados = readFileSync(new URL('panel/Dockerfile.dockerignore', raiz), 'utf8')
    .split('\n')
    .map((linea) => linea.trim())
    .filter((linea) => linea !== '' && !linea.startsWith('#'));

  it.each([
    'node_modules',
    'panel/dist',
    '.git',
    'ejemplo.env',
    '.env',
    'pruebas',
    'EN-CURSO.local.md',
    'ejemplo-keycloak.env',
    'keycloak',
  ])('deja afuera %s', (ruta) => {
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

describe('docker-compose.yml: perfil m6-real con el M6 del Grupo 12 (spec 081, RNF-04.9, RNF-06.6)', () => {
  const compose = parseYaml(readFileSync(new URL('docker-compose.yml', raiz), 'utf8')) as Compose;
  const m6Real = compose.services?.['m6-real'];
  const baseM6 = compose.services?.['m6-real-bd'];
  const ejemplo = readFileSync(new URL('ejemplo.env', raiz), 'utf8').replaceAll('\r\n', '\n');
  const deEjemplo = (variable: string) => new RegExp(`^${variable}=\\$\\{${variable}:-([^}]*)\\}$`, 'm').exec(ejemplo)?.[1];
  const contexto = () => (typeof m6Real?.build === 'object' ? (m6Real.build.context ?? '') : '');

  it('se construye desde el repositorio del Grupo 12, con su Dockerfile y un commit completo por defecto', () => {
    expect(contexto()).toMatch(/^https:\/\/github\.com\/FRRe-DS\/2026-12-TPI\.git#\$\{M6_REAL_COMMIT:-[0-9a-f]{40}\}$/);
    expect(m6Real?.build).toMatchObject({ dockerfile: 'backend/Dockerfile' });
  });

  // La sección 8 de docs/probar-m2.md repite el hash como texto: tiene que decir el que compose usa (RNF-20.4).
  it('docs/probar-m2.md cita el commit que usa compose', () => {
    const commit = /M6_REAL_COMMIT:-([0-9a-f]{40})/.exec(contexto())?.[1] ?? 'sin commit';
    expect(readFileSync(new URL('docs/probar-m2.md', raiz), 'utf8')).toContain(`\`${commit}\``);
  });

  it('M6 real publica su puerto solo en 127.0.0.1 y espera a que su base esté sana', () => {
    expect(m6Real?.init).toBe(true);
    expect(m6Real?.ports).toEqual(['127.0.0.1:${M6_REAL_PUERTO:-3016}:3006']);
    expect(m6Real?.depends_on).toEqual({ 'm6-real-bd': { condition: 'service_healthy' } });
  });

  it('M6 real recibe su base por DATABASE_URL, escucha en el 3006 y tiene los atajos de demo para preparar viajes', () => {
    expect(m6Real?.environment).toEqual({
      DATABASE_URL:
        'postgresql://${M6_REAL_BD_USUARIO:-m6}:${M6_REAL_BD_CLAVE:-m6-contrasena-de-desarrollo}@m6-real-bd:5432/${M6_REAL_BD_NOMBRE:-m6}?schema=public',
      PORT: '3006',
      ENABLE_DEMO_AUTH: 'true',
    });
  });

  it('la base de M6 usa PostgreSQL 16 en versión exacta, su propio volumen y no publica ningún puerto (RNF-05)', () => {
    expect(baseM6?.image).toMatch(/^postgres:16\./);
    expect(imagenExacta(baseM6?.image ?? '', 2)).toBe(true);
    expect(baseM6?.ports).toBeUndefined();
    expect(baseM6?.volumes).toEqual(['datos-m6-real-bd:/var/lib/postgresql/data']);
  });

  it('la base de M6 no lee ejemplo.env, porque tomaría las POSTGRES_* de M2', () => {
    expect(baseM6?.env_file).toBeUndefined();
    expect(baseM6?.environment).toEqual({
      POSTGRES_USER: '${M6_REAL_BD_USUARIO:-m6}',
      POSTGRES_PASSWORD: '${M6_REAL_BD_CLAVE:-m6-contrasena-de-desarrollo}',
      POSTGRES_DB: '${M6_REAL_BD_NOMBRE:-m6}',
    });
  });

  it('el chequeo de la base de M6 va por TCP, como el de bd', () => {
    expect(baseM6?.healthcheck?.test).toEqual(compose.services?.['bd']?.healthcheck?.test);
  });

  it('m2 no depende de M6: tiene que arrancar y responder aunque M6 no esté (RNF-13)', () => {
    expect(Object.keys(compose.services?.['m2']?.depends_on ?? {})).toEqual(['bd']);
  });

  it.each([
    ['M6_REAL_PUERTO', '3016'],
    ['M6_REAL_BD_USUARIO', 'm6'],
    ['M6_REAL_BD_CLAVE', 'm6-contrasena-de-desarrollo'],
    ['M6_REAL_BD_NOMBRE', 'm6'],
  ])('el valor por defecto de %s en el compose es el de ejemplo.env', (variable, valor) => {
    expect(deEjemplo(variable)).toBe(valor);
    expect(JSON.stringify([m6Real, baseM6])).toContain(`\${${variable}:-${valor}}`);
  });
});

describe('docker-compose.yml: puente a la base y variables nuevas del panel (spec 072, RNF-04.8, RNF-06.5)', () => {
  const compose = parseYaml(readFileSync(new URL('docker-compose.yml', raiz), 'utf8')) as Compose;
  const puente = compose.services?.['bd-puente'];
  const panel = compose.services?.['panel'];
  const sinPerfil = Object.entries(compose.services ?? {}).filter(([, servicio]) => servicio?.profiles === undefined);

  it('sin el perfil solo están m2 y bd, y no se publica ningún puerto de la base', () => {
    expect(sinPerfil.map(([nombre]) => nombre).sort()).toEqual(['bd', 'm2']);
    expect(compose.services?.['bd']?.ports).toBeUndefined();
    expect(compose.services?.['m2']?.ports).toEqual(['${M2_PUERTO:-8082}:${M2_PUERTO:-8082}']);
  });

  it('m2 y bd no cambian: su configuración no menciona el puente ni las variables del panel', () => {
    for (const nombre of ['m2', 'bd']) {
      const texto = JSON.stringify(compose.services?.[nombre]);
      expect(texto, nombre).not.toMatch(/puente|PANEL_|5433/);
    }
  });

  it('bd-puente se construye con el destino puente-bd, se publica solo en 127.0.0.1 y espera a una base sana', () => {
    expect(puente?.build).toEqual({ context: '.', dockerfile: 'panel/Dockerfile', target: 'puente-bd' });
    expect(puente?.image).toBe(`m2-puente-bd:${String(paquete['version'])}`);
    expect(puente?.init).toBe(true);
    expect(puente?.ports).toEqual(['127.0.0.1:${PANEL_PUERTO_BD:-5433}:5433']);
    expect(puente?.depends_on).toEqual({ bd: { condition: 'service_healthy' } });
  });

  it('el chequeo del puente abre una conexión a su propio puerto, con Node y sin $ de compose', () => {
    expect(puente?.healthcheck?.test?.slice(0, 2)).toEqual(['CMD', 'node']);
    const codigo = (puente?.healthcheck?.test ?? []).slice(2).join(' ');
    expect(codigo).toContain('connect(');
    expect(codigo).toContain('5433');
    expect(codigo).not.toContain('$');
  });

  // Compose interpola `${VARIABLE:-valor}` de su propio entorno y no del env_file: los valores por defecto se repiten en el
  // compose y tienen que ser los de ejemplo.env, que es donde la persona los cambia (se cambian juntos).
  const ejemplo = readFileSync(new URL('ejemplo.env', raiz), 'utf8').replaceAll('\r\n', '\n');
  const deEjemplo = (variable: string) => new RegExp(`^${variable}=\\$\\{${variable}:-([^}]*)\\}$`, 'm').exec(ejemplo)?.[1];

  it('el panel en el contenedor llega a la base por bd:5432 con las POSTGRES_* y no puede usar Docker', () => {
    const entorno = panel?.environment ?? {};
    expect(entorno['PANEL_DOCKER']).toBe('no');
    expect(entorno['PANEL_URL_BD']).toMatch(
      /^postgres:\/\/\$\{POSTGRES_USER:-[^}]+\}:\$\{POSTGRES_PASSWORD:-[^}]+\}@bd:5432\/\$\{POSTGRES_DB:-[^}]+\}$/,
    );
  });

  it.each(['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'])('el valor por defecto de %s en la URL del panel es el de ejemplo.env', (variable) => {
    const enCompose = new RegExp(`\\$\\{${variable}:-([^}]*)\\}`).exec(panel?.environment?.['PANEL_URL_BD'] ?? '')?.[1];

    expect(enCompose).toBeDefined();
    expect(enCompose).toBe(deEjemplo(variable));
  });
});

// Keycloak con su propia base, solo con `--profile keycloak` (spec 080, RNF-04.10, RNF-05.6, RNF-06.8). M2 no depende de él:
// en modo `jwks` pide las claves cuando las necesita (RNF-13.9).
describe('docker-compose.yml: perfil keycloak (spec 080, RNF-04.10, RNF-05.6, RNF-06.8)', () => {
  const textoCompose = readFileSync(new URL('docker-compose.yml', raiz), 'utf8');
  const compose = parseYaml(textoCompose) as Compose;
  const keycloak = compose.services?.['keycloak'];
  const keycloakBd = compose.services?.['keycloak-bd'];
  const realm = new URL('keycloak/ds-2026-realm-realm.json', raiz);

  it('Keycloak y su base tienen imagen con versión exacta, y la base es la misma imagen que la de M2', () => {
    expect(keycloak?.image).toBe('quay.io/keycloak/keycloak:26.8.2');
    expect(imagenExacta(keycloak?.image ?? '')).toBe(true);
    expect(keycloakBd?.image).toBe(IMAGEN_POSTGRES);
  });

  it('ninguno de los dos lee ejemplo.env: tomarían las POSTGRES_* de M2', () => {
    expect(keycloak?.env_file).toBeUndefined();
    expect(keycloakBd?.env_file).toBeUndefined();
  });

  it('la base de Keycloak no publica puertos y guarda sus datos en su propio volumen', () => {
    expect(keycloakBd?.ports).toBeUndefined();
    expect(keycloakBd?.volumes).toEqual(['datos-keycloak-bd:/var/lib/postgresql']);
  });

  it('la base de Keycloak toma usuario, contraseña y nombre de variables de compose, con valores de desarrollo', () => {
    expect(keycloakBd?.environment).toEqual({
      POSTGRES_USER: '${KEYCLOAK_BD_USUARIO:-keycloak}',
      POSTGRES_PASSWORD: '${KEYCLOAK_BD_CLAVE:-keycloak-contrasena-de-desarrollo}',
      POSTGRES_DB: 'keycloak',
    });
  });

  it('el chequeo de la base de Keycloak usa pg_isready por TCP y las variables del contenedor, como el de bd', () => {
    const prueba = (keycloakBd?.healthcheck?.test ?? []).join(' ');
    expect(prueba).toContain('pg_isready');
    expect(prueba).toContain('-h 127.0.0.1');
    expect(prueba).toContain('$$POSTGRES_USER');
    expect(prueba).toContain('$$POSTGRES_DB');
  });

  it('Keycloak arranca en modo start, importa el realm de ./keycloak montado solo lectura y espera a su base sana', () => {
    expect([keycloak?.command].flat().join(' ')).toBe('start --import-realm');
    expect(keycloak?.volumes).toEqual(['./keycloak:/opt/keycloak/data/import:ro']);
    expect(keycloak?.depends_on).toEqual({ 'keycloak-bd': { condition: 'service_healthy' } });
  });

  it('Keycloak se publica solo en 127.0.0.1, en KEYCLOAK_PUERTO (8080 por defecto)', () => {
    expect(keycloak?.ports).toEqual(['127.0.0.1:${KEYCLOAK_PUERTO:-8080}:8080']);
  });

  it('Keycloak usa la base y las credenciales de las mismas variables que su base, y las de administración de las suyas', () => {
    expect(keycloak?.environment).toEqual({
      KC_DB: 'postgres',
      KC_DB_URL: 'jdbc:postgresql://keycloak-bd:5432/keycloak',
      KC_DB_USERNAME: keycloakBd?.environment?.['POSTGRES_USER'],
      KC_DB_PASSWORD: keycloakBd?.environment?.['POSTGRES_PASSWORD'],
      KC_BOOTSTRAP_ADMIN_USERNAME: '${KEYCLOAK_ADMIN_USUARIO:-admin}',
      KC_BOOTSTRAP_ADMIN_PASSWORD: '${KEYCLOAK_ADMIN_CLAVE:-admin-contrasena-de-desarrollo}',
      // El emisor de los tokens es uno solo, el que ve la máquina; M2 baja las claves por la red de compose.
      KC_HOSTNAME: 'http://localhost:${KEYCLOAK_PUERTO:-8080}',
      KC_HOSTNAME_BACKCHANNEL_DYNAMIC: 'true',
      KC_HTTP_ENABLED: 'true',
      KC_HEALTH_ENABLED: 'true',
    });
  });

  // La imagen no trae curl: el chequeo es bash con /dev/tcp. Mira el código HTTP: el texto "UP" aparece en una comprobación
  // interna mientras el estado general es DOWN, y el primer token recibiría 503 (plan, Datos).
  it('el chequeo de Keycloak pide /health/ready en el puerto 9000 y mira el código HTTP, no el texto', () => {
    const prueba = (keycloak?.healthcheck?.test ?? []).join(' ');
    expect(prueba).toContain('/dev/tcp/127.0.0.1/9000');
    expect(prueba).toContain('/health/ready');
    expect(prueba).toContain('HTTP/1.1 200');
    expect(prueba).not.toMatch(/\bUP\b/);
    expect(prueba).not.toMatch(/curl|wget/);
  });

  it('m2 no depende de Keycloak ni nombra sus variables', () => {
    expect(compose.services?.['m2']?.depends_on).toEqual({ bd: { condition: 'service_healthy' } });
    expect(JSON.stringify(compose.services?.['m2'])).not.toMatch(/KEYCLOAK|keycloak/);
  });

  // `${VARIABLE:?}` haría fallar a compose también sin el perfil.
  it('el compose no exige ninguna variable', () => {
    expect(textoCompose).not.toMatch(/\$\{[^}]*:?\?/);
  });

  it('el realm está en keycloak/ con el nombre que Keycloak 26 importa: <realm>-realm.json', () => {
    expect(existsSync(realm)).toBe(true);
    expect(globSync('*', { cwd: fileURLToPath(new URL('keycloak/', raiz)) })).toEqual(['ds-2026-realm-realm.json']);
    expect((JSON.parse(readFileSync(realm, 'utf8')) as { realm?: unknown }).realm).toBe('ds-2026-realm');
  });
});

