import { parseArgs } from 'node:util';
import { esRolConocido, generarToken, ROLES_CONOCIDOS } from '../auth/tokens.js';
import { cargarConfigTokens, type Entorno } from '../config.js';

// Comando de desarrollo que hace de M1: firma un token con la clave, el emisor y la audiencia configurados (RNF-12.5). Imprime
// solo el token, para usarlo como `Authorization: Bearer $(…)`.
const USO = 'Uso: node dist/herramientas/token.js --sub <texto> --roles <ROL[,ROL…]> [--vence <segundos>]';

const OPCIONES = { sub: { type: 'string' }, roles: { type: 'string' }, vence: { type: 'string' } } as const;

const ARGUMENTOS_NO_VALIDOS = 'Los argumentos no son válidos.';
const FALTA_SUB = 'Falta --sub, el identificador de quien llama (el sub del token).';
const FALTA_ROLES = 'Falta --roles, al menos un rol (varios, separados por comas).';
const VENCE_INVALIDO = '--vence tiene que ser un entero de segundos mayor que 0.';

// Los códigos de salida son los de scripts/contrato-test.mjs: 0 si salió bien, 1 si falta configuración y 2 si los
// argumentos están mal.
const SALIDA_CONFIGURACION = 1;
const SALIDA_ARGUMENTOS = 2;

type Pedido = { sub: string; roles: string[]; venceEnSegundos: number | undefined };

type Lectura = { pedido: Pedido; errores?: undefined } | { pedido?: undefined; errores: string[] };

// Solo dígitos decimales: nada de signos, espacios, decimales ni notación científica.
function aSegundos(texto: string): number | undefined {
  const numero = Number(texto);
  return /^\d+$/.test(texto) && Number.isSafeInteger(numero) && numero > 0 ? numero : undefined;
}

// Junta los problemas de los argumentos para informarlos todos juntos. Lo único que no se puede juntar es un argumento que
// parseArgs rechaza: ahí queda un mensaje fijo, porque el de Node repite el argumento y podría ser un secreto.
function leerArgumentos(argv: readonly string[]): Lectura {
  let valores: { sub?: string; roles?: string; vence?: string };
  try {
    valores = parseArgs({ args: argv, options: OPCIONES }).values;
  } catch {
    return { errores: [ARGUMENTOS_NO_VALIDOS] };
  }

  const errores: string[] = [];

  const sub = valores.sub ?? '';
  if (sub.trim() === '') errores.push(FALTA_SUB);

  const roles = (valores.roles ?? '')
    .split(',')
    .map((rol) => rol.trim())
    .filter((rol) => rol !== '');
  if (roles.length === 0) errores.push(FALTA_ROLES);

  const venceEnSegundos = valores.vence === undefined ? undefined : aSegundos(valores.vence);
  if (valores.vence !== undefined && venceEnSegundos === undefined) errores.push(VENCE_INVALIDO);

  return errores.length > 0 ? { errores } : { pedido: { sub, roles, venceEnSegundos } };
}

// Devuelve el código de salida. Los errores y los avisos van a la salida de errores: en la salida estándar solo va el token.
export async function main(argv: readonly string[], env: Entorno): Promise<number> {
  const lectura = leerArgumentos(argv);
  if (lectura.pedido === undefined) {
    console.error([...lectura.errores, USO].join('\n'));
    return SALIDA_ARGUMENTOS;
  }

  const resultado = cargarConfigTokens(env);
  if (resultado.config === undefined) {
    const lineas = resultado.errores.map(({ variable, motivo }) => `  ${variable}: ${motivo}`);
    console.error(['La configuración de tokens no es válida:', ...lineas].join('\n'));
    return SALIDA_CONFIGURACION;
  }

  // Se firma lo que se pide, pero un rol mal escrito (en minúsculas, por ejemplo) hace un token que el servicio ignora.
  const desconocidos = lectura.pedido.roles.filter((rol) => !esRolConocido(rol));
  if (desconocidos.length > 0) {
    console.error(
      `Aviso: el servicio ignora los roles que no reconoce (${desconocidos.join(', ')}). ` +
        `Los que reconoce, escritos así: ${ROLES_CONOCIDOS.join(', ')}.`,
    );
  }

  console.log(await generarToken(lectura.pedido, resultado.config));
  return 0;
}

// Con `node dist/herramientas/token.js` corre como comando; al importarlo (las pruebas) solo exporta `main`. Deja el código en
// `process.exitCode` y no corta con `process.exit`, para que el proceso termine después de escribir el token.
if (import.meta.main) process.exitCode = await main(process.argv.slice(2), process.env);
