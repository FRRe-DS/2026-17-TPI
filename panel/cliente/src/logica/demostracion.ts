import { AREAS, type Caso, type Esperado, type IdDeArea } from './casos.js';
import type { PedidoDelCaso, ResumenDeEjecucion } from './ejecutar-caso.js';

// Lo que muestra la sección «Casos» de la vista de demostración (spec 072, T14), sin React: los casos por área, el avance de
// «Ejecutar todo», el resumen y el texto de cada pedido y de lo esperado.

export type GrupoDeCasos = { area: { id: IdDeArea; titulo: string }; casos: Caso[] };

// Los casos agrupados en el orden de `AREAS` (el de la tabla de `docs/probar-m2.md`); un área sin casos no se muestra.
export function casosPorArea(casos: readonly Caso[]): GrupoDeCasos[] {
  return AREAS.map((area) => ({ area, casos: casos.filter((caso) => caso.area === area.id) })).filter((grupo) => grupo.casos.length > 0);
}

export const textoDeAvance = (hechos: number, total: number): string => `${hechos} de ${total}`;

// Lo que dice «Ejecutar todo» al terminar. Con `total` (cuántos casos había) y menos resultados, se cortó a medias.
export function textoDelResumen(resumen: ResumenDeEjecucion, total?: number): { correcto: boolean; texto: string } {
  const { correctos, incorrectos } = resumen;
  const hechos = correctos + incorrectos;
  const correcto = incorrectos === 0 && hechos > 0;
  if (total !== undefined && hechos < total) {
    const dieron = incorrectos === 0 ? (hechos === 0 ? 'no se ejecutó ninguno' : hechos === 1 ? 'el caso dio lo esperado' : `los ${hechos} dieron lo esperado`) : `${correctos} ${correctos === 1 ? 'dio' : 'dieron'} lo esperado y ${incorrectos} ${incorrectos === 1 ? 'no coincide' : 'no coinciden'}`;
    return { correcto: false, texto: `Se cortó con ${hechos} de ${total} casos hechos: ${dieron}.` };
  }
  if (hechos === 1) return correcto ? { correcto, texto: 'El caso dio lo esperado.' } : { correcto, texto: 'El caso no coincide con lo esperado.' };
  if (correcto) return { correcto, texto: `Los ${hechos} casos dieron lo esperado.` };
  return { correcto: false, texto: `${correctos} de ${hechos} casos dieron lo esperado; ${incorrectos} ${incorrectos === 1 ? 'no coincide' : 'no coinciden'}.` };
}

// Lo que tiene que pasar. Con `comoError`, un 4xx o 5xx además tiene que ser `application/problem+json` (RNF-03.6).
export function textoDeEsperado(esperado: Esperado, comoError = false): string {
  const partes = [String(esperado.estado)];
  if (comoError && esperado.estado >= 400) partes.push('como application/problem+json');
  if (esperado.type !== undefined) partes.push(`error ${esperado.type}`);
  if (esperado.conRetryAfter) partes.push('con el encabezado Retry-After');
  if (esperado.conLocation) partes.push('con el encabezado Location');
  return partes.join(', ');
}

export const lineaDelPedido = (pedido: Pick<PedidoDelCaso, 'metodo' | 'ruta'>): string => `${pedido.metodo} ${pedido.ruta}`;

export const textoDeIdentidad = (pedido: Pick<PedidoDelCaso, 'identidad'>): string =>
  pedido.identidad === null ? 'sin token' : `${pedido.identidad.rol} (${pedido.identidad.sub})`;

// El `Authorization` de un caso, enmascarado como en el detalle técnico de la 071 (RNF-19.4). El navegador no arma el token: manda
// el rol y el `sub` y el servidor del panel lo firma, así que lo único que se puede mostrar de él es que va y que está tapado. Es el
// mismo texto que `TOKEN_ENMASCARADO` de `panel/servidor/pedidos.ts`; una prueba comprueba que no se separen.
export const AUTORIZACION_ENMASCARADA = 'Bearer ••••';

// `undefined` si el caso va sin token: no hay encabezado que mostrar.
export const textoDeAutorizacion = (pedido: Pick<PedidoDelCaso, 'identidad'>): string | undefined =>
  pedido.identidad === null ? undefined : AUTORIZACION_ENMASCARADA;

// Lo más que se muestra de un cuerpo: una lista de 20 calificaciones no tiene que empujar el resto de la vista.
export const LIMITE_DE_CUERPO = 2000;

// El cuerpo como texto con sangría, o `undefined` si no hay. Se muestra siempre como texto (nodo de texto, nunca HTML): el mensaje de
// un error puede traer lo que la persona escribió.
export function mostrarCuerpo(cuerpo: unknown): string | undefined {
  if (cuerpo === undefined) return undefined;
  let texto: string;
  try {
    texto = JSON.stringify(cuerpo, null, 2) ?? '(no se puede mostrar)';
  } catch {
    return '(no se puede mostrar)';
  }
  return texto.length > LIMITE_DE_CUERPO ? `${texto.slice(0, LIMITE_DE_CUERPO)}… (se recortó: ${texto.length - LIMITE_DE_CUERPO} caracteres más)` : texto;
}
