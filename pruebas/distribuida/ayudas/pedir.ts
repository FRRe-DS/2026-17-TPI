import { inject } from 'vitest';
import { compose, URL_M2, URL_M6 } from './entorno.js';
import { crearContador } from './contador.js';

// Los pedidos de la prueba distribuida: `fetch` con corte de 10 s y un contador (RNF-07.7).
const CORTE_MS = 10_000;

export type Respuesta = { estado: number; encabezados: Headers; texto: string; cuerpo: unknown };

export type Pedido = { cuerpo?: unknown; encabezados?: Record<string, string> };

// El archivo lo crea `global.ts`: así la cuenta es la de toda la corrida, y no la de este archivo de prueba.
export const contador = crearContador({ reintentosM2: Number(process.env['M2_REINTENTOS_MODULOS'] ?? 1), archivo: inject('archivoPedidos') });

async function pedir(base: string, metodo: string, ruta: string, token: string | undefined, pedido: Pedido): Promise<Respuesta> {
  const encabezados: Record<string, string> = { ...pedido.encabezados };
  if (token !== undefined) encabezados['authorization'] = `Bearer ${token}`;
  if (pedido.cuerpo !== undefined) encabezados['content-type'] = 'application/json';
  const respuesta = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: encabezados,
    body: pedido.cuerpo === undefined ? undefined : JSON.stringify(pedido.cuerpo),
    signal: AbortSignal.timeout(CORTE_MS),
  });
  const texto = await respuesta.text();
  let cuerpo: unknown;
  try {
    cuerpo = texto === '' ? undefined : JSON.parse(texto);
  } catch {
    cuerpo = undefined;
  }
  return { estado: respuesta.status, encabezados: respuesta.headers, texto, cuerpo };
}

// Un pedido a M2. `consultaM6` dice si M2 va a consultar a M6 para responderlo, y así el contador suma los reintentos posibles.
export function pedirM2(token: string | undefined, metodo: string, ruta: string, pedido: Pedido & { consultaM6?: boolean } = {}) {
  if (pedido.consultaM6 === true) contador.pedidoAM2QueConsultaM6();
  else contador.pedidoAM2();
  return pedir(URL_M2, metodo, ruta, token, pedido);
}

// Un pedido directo a M6 (la preparación de viajes y las comprobaciones).
export function pedirM6(metodo: string, ruta: string, pedido: Pedido & { token?: string } = {}) {
  contador.pedidoAM6();
  return pedir(URL_M6, metodo, ruta, pedido.token, pedido);
}

// Un token que M2 acepta (el de un cliente, por ejemplo), firmado con su comando de desarrollo, el que hace de M1 en la demo. No es
// el token con el que M2 se presenta ante M6: para eso está `tokenDeServicioDeM2`.
export async function tokenDeM2(sub: string, roles: string[]): Promise<string> {
  const salida = await compose(['exec', '-T', 'm2', 'node', 'dist/herramientas/token.js', '--sub', sub, '--roles', roles.join(',')], {
    tiempoMs: 30_000,
  });
  return salida.trim();
}

// Corre dentro del contenedor de M2 la misma función, con la misma configuración, que usa M2 al llamar a M6 (`src/historial/m6.ts`):
// desde la spec 125, pide el token a Keycloak por client_credentials como grupo-17. Si M2 no quedó en modo keycloak, falla: el M6
// real rechaza el HS256 y la prueba tiene que decir por qué.
const OBTENER_TOKEN_DE_SERVICIO = `
import { crearTokenServicio } from './dist/auth/token-servicio.js';
import { cargarConfig } from './dist/config.js';
const { config, errores } = cargarConfig(process.env);
if (config === undefined) {
  console.error('Configuración no válida: ' + errores.map(({ variable }) => variable).join(', '));
  process.exit(1);
}
const tokenServicio = crearTokenServicio(config);
if (tokenServicio.modo !== 'keycloak') {
  console.error('M2 no pide su token de servicio a Keycloak (modo ' + tokenServicio.modo + '): faltan las variables M2_*_SERVICIO.');
  process.exit(1);
}
console.log((await tokenServicio.obtener('prueba-distribuida')).token);
`;

// El token con el que M2 se presenta ante M6 de verdad: uno nuevo de Keycloak en cada llamada, que vive lo que diga el realm.
export async function tokenDeServicioDeM2(): Promise<string> {
  const salida = await compose(['exec', '-T', 'm2', 'node', '--input-type=module', '-e', OBTENER_TOKEN_DE_SERVICIO], {
    tiempoMs: 30_000,
  });
  return salida.trim();
}

// El HS256 que M2 firmaba antes de la spec 125 (RF-2.4.11.2), con su misma función y configuración: el M6 real tiene que rechazarlo.
const FIRMAR_TOKEN_HS256 = `
import { tokenDeServicio } from './dist/auth/tokens.js';
import { cargarConfig } from './dist/config.js';
const { config, errores } = cargarConfig(process.env);
if (config === undefined) {
  console.error('Configuración no válida: ' + errores.map(({ variable }) => variable).join(', '));
  process.exit(1);
}
console.log(await tokenDeServicio(config));
`;

export async function tokenHs256DeM2(): Promise<string> {
  const salida = await compose(['exec', '-T', 'm2', 'node', '--input-type=module', '-e', FIRMAR_TOKEN_HS256], { tiempoMs: 30_000 });
  return salida.trim();
}
