// Prueba de contrato de lo implementado (RNF-07.2). Pasos 1 a 3 del plan: lee el contrato y los manejadores compilados,
// informa como pendiente cada operación que no tiene manejador y, si no hay ninguna implementada, termina bien sin
// probar nada. Los pasos 4 a 6 (pedir un token y correr Schemathesis sobre lo implementado) llegan con T29.
// Usa dist/: `npm run contrato:test` compila antes de correrlo.
import { relative } from 'node:path';
import { parseArgs } from 'node:util';

const USO = 'Uso: node scripts/contrato-test.mjs [--contrato <ruta>]';

// Importa un módulo compilado, con la ruta relativa a dist/ y no al directorio desde el que se corre el script.
const desdeDist = (ruta) => import(new URL(`../dist/${ruta}`, import.meta.url).href);

const linea = (estado, { operationId, metodo, ruta }) =>
  `${estado.padEnd(12)} ${metodo.padEnd(7)} ${ruta} (${operationId ?? 'sin operationId'})`;

// Devuelve el código de salida: 0 si salió bien, 1 si no se pudo leer algo y 2 si los argumentos están mal.
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
    } else {
      console.log('Aviso: la prueba con Schemathesis llega con la tarea T29 de la spec 003: no se probó ninguna operación.');
    }
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
