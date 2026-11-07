import { compose, URL_M2, URL_M6 } from './entorno.js';
import { crearContador } from './contador.js';

// Los pedidos de la prueba distribuida: `fetch` con corte de 10 s y un contador (RNF-07.7).
const CORTE_MS = 10_000;

export type Respuesta = { estado: number; encabezados: Headers; texto: string; cuerpo: unknown };

export type Pedido = { cuerpo?: unknown; encabezados?: Record<string, string> };

export const contador = crearContador({ reintentosM2: Number(process.env['M2_REINTENTOS_MODULOS'] ?? 1) });

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

// Un token que M2 acepta, firmado por el mismo M2 con su comando de desarrollo (el que usa la demo), y no uno armado con claves de
// prueba: así M2 se presenta ante M6 con el token que firma de verdad.
export async function tokenDeM2(sub: string, roles: string[]): Promise<string> {
  const salida = await compose(['exec', '-T', 'm2', 'node', 'dist/herramientas/token.js', '--sub', sub, '--roles', roles.join(',')], {
    tiempoMs: 30_000,
  });
  return salida.trim();
}
