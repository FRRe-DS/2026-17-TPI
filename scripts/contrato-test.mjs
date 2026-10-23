// Prueba de contrato de lo implementado (RNF-07.2), pasos 1 a 6 del plan: lee el contrato y los manejadores compilados,
// informa como pendiente cada operación que no tiene manejador y, si no hay ninguna implementada, termina bien sin probar
// nada. Si hay, comprueba que el servicio levantado con docker compose responde, le pide un token al contenedor y corre
// Schemathesis solo sobre las implementadas, y termina con su código.
// Usa dist/: `npm run contrato:test` compila antes de correrlo.
import { execFile, spawn } from 'node:child_process';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const USO = 'Uso: node scripts/contrato-test.mjs [--contrato <ruta>]';

const SCHEMATHESIS = 'schemathesis/schemathesis:4.31.1';
const SUB_PRUEBA = '00000000-0000-4000-8000-000000000001';
const ROLES_PRUEBA = 'CLIENTE,CONDUCTOR,OPERADOR,SERVICIO';

// El puerto que publica docker-compose.yml, con su mismo valor por defecto, también si la variable está vacía (`:-`).
const PUERTO = process.env.M2_PUERTO || '8082';
const URL_SERVICIO = `http://localhost:${PUERTO}`;

// docker compose busca el proyecto en la raíz del repositorio, aunque el script se corra desde otro directorio.
const RAIZ = fileURLToPath(new URL('..', import.meta.url));

const LEVANTAR = 'Levántalo con `docker compose up -d --build --wait`.';

// Importa un módulo compilado, con la ruta relativa a dist/ y no al directorio desde el que se corre el script.
const desdeDist = (ruta) => import(new URL(`../dist/${ruta}`, import.meta.url).href);

const linea = (estado, { operationId, metodo, ruta }) =>
  `${estado.padEnd(12)} ${metodo.padEnd(7)} ${ruta} (${operationId ?? 'sin operationId'})`;

// Paso 4: el servicio tiene que estar levantado antes de pedir el token o correr Schemathesis.
async function servicioResponde() {
  try {
    const respuesta = await fetch(`${URL_SERVICIO}/health`, { signal: AbortSignal.timeout(5000) });
    return respuesta.ok;
  } catch {
    return false;
  }
}

// Paso 4: el token lo firma el comando de tokens dentro del contenedor, con la configuración del servicio. No se imprime.
async function pedirToken() {
  const { stdout } = await promisify(execFile)(
    'docker',
    ['compose', 'exec', '-T', 'm2', 'node', 'dist/herramientas/token.js', '--sub', SUB_PRUEBA, '--roles', ROLES_PRUEBA],
    { cwd: RAIZ },
  );
  return stdout.trim();
}

// La configuración de Schemathesis, en la raíz del repositorio: no genera el carácter nulo y acepta el 422 donde el contrato lo
// declara (spec 004, guia.md, T10).
const CONFIGURACION = resolve(RAIZ, 'schemathesis.toml');

// Paso 5: Schemathesis con todos sus chequeos y los ajustes de CONFIGURACION, solo sobre las operaciones implementadas.
// Devuelve su código.
function correrSchemathesis(rutaContrato, implementadas, token) {
  const absoluta = resolve(rutaContrato);
  const argumentos = [
    'run',
    '--rm',
    '--network',
    'host',
    '-v',
    `${dirname(absoluta)}:/contrato:ro`,
    '-v',
    `${CONFIGURACION}:/configuracion/schemathesis.toml:ro`,
    SCHEMATHESIS,
    '--config-file',
    '/configuracion/schemathesis.toml',
    'run',
    `/contrato/${basename(absoluta)}`,
    '--url',
    URL_SERVICIO,
    ...implementadas.flatMap(({ operationId }) => ['--include-operation-id', operationId]),
    '--header',
    `Authorization: Bearer ${token}`,
  ];
  return new Promise((resolver, rechazar) => {
    const proceso = spawn('docker', argumentos, { stdio: 'inherit' });
    proceso.on('error', rechazar);
    // Si lo corta una señal no hay código: cuenta como falla.
    proceso.on('close', (codigo) => resolver(codigo ?? 1));
  });
}

// Devuelve el código de salida: 0 si salió bien, 1 si no se pudo leer algo o el servicio no responde, 2 si los
// argumentos están mal, y el de Schemathesis cuando lo corre.
async function main(argumentos) {
  let contrato;
  try {
    ({ contrato } = parseArgs({ args: argumentos, options: { contrato: { type: 'string' } } }).values);
  } catch (error) {
    console.error(`${error.message}\n${USO}`);
    return 2;
  }

  try {
    const { cargarContrato, RUTA_CONTRATO } = await desdeDist('contrato/cargar.js');
    const { listarOperaciones } = await desdeDist('contrato/operaciones.js');
    const { manejadores } = await desdeDist('operaciones/index.js');

    const ruta = contrato ?? RUTA_CONTRATO;
    const { implementadas, pendientes } = listarOperaciones(cargarContrato(ruta), manejadores);

    console.log(`Contrato: ${relative(process.cwd(), ruta)}`);
    for (const operacion of implementadas) console.log(linea('implementada', operacion));
    for (const operacion of pendientes) console.log(linea('pendiente', operacion));
    console.log(
      `Operaciones: ${implementadas.length + pendientes.length} (${implementadas.length} implementadas, ${pendientes.length} pendientes)`,
    );

    if (implementadas.length === 0) {
      console.log('No hay operaciones implementadas del contrato: nada para probar');
      return 0;
    }

    if (!(await servicioResponde())) {
      console.error(`El servicio no responde en ${URL_SERVICIO}/health. ${LEVANTAR}`);
      return 1;
    }

    let token;
    try {
      token = await pedirToken();
    } catch (error) {
      console.error(`No se pudo pedir un token al contenedor m2. ${LEVANTAR}\n${error.stderr?.trim() || error.message}`);
      return 1;
    }

    console.log(`Schemathesis sobre ${implementadas.map(({ operationId }) => operationId).join(', ')} en ${URL_SERVICIO}`);
    return await correrSchemathesis(ruta, implementadas, token);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
