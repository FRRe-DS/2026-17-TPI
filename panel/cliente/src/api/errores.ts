// Los errores de la capa de API (RNF-03.6, RNF-15.4): un solo tipo para todo lo que no sea un éxito, de modo que las pantallas
// muestren el error de M2 completo o «M2 no responde» sin mirar cómo falló el pedido.

export const MENSAJE_M2_NO_RESPONDE = 'M2 no responde';
export const TYPE_M2_NO_RESPONDE = '/panel/errores/m2-no-responde';

export type DatosDeError = {
  // M2 no contestó a tiempo (o el panel dijo que no contestó): no hay un error de M2 que mostrar.
  sinRespuesta: boolean;
  // El código HTTP de la respuesta; 504 cuando M2 no responde.
  estado: number;
  type: string;
  title: string;
  detail?: string | undefined;
  instance?: string | undefined;
  // Los segundos de `Retry-After` (1 a 3600), para la cuenta regresiva de RF-2.4.13; sin valor si no vino o no es un entero válido.
  reintentarEnS?: number | undefined;
  // El `X-Request-Id` de la respuesta, el que se busca en `docker compose logs m2`.
  requestId?: string | undefined;
};

export class ErrorDeApi extends Error implements DatosDeError {
  readonly sinRespuesta: boolean;
  readonly estado: number;
  readonly type: string;
  readonly title: string;
  readonly detail: string | undefined;
  readonly instance: string | undefined;
  readonly reintentarEnS: number | undefined;
  readonly requestId: string | undefined;

  constructor(datos: DatosDeError) {
    super(datos.title);
    this.name = 'ErrorDeApi';
    this.sinRespuesta = datos.sinRespuesta;
    this.estado = datos.estado;
    this.type = datos.type;
    this.title = datos.title;
    this.detail = datos.detail;
    this.instance = datos.instance;
    this.reintentarEnS = datos.reintentarEnS;
    this.requestId = datos.requestId;
  }
}

// El mismo error para el `504` del panel, el tiempo agotado y la conexión que no se pudo abrir.
export const m2NoResponde = (requestId?: string): ErrorDeApi =>
  new ErrorDeApi({ sinRespuesta: true, estado: 504, type: TYPE_M2_NO_RESPONDE, title: MENSAJE_M2_NO_RESPONDE, requestId });

const texto = (valor: unknown): string | undefined => (typeof valor === 'string' && valor !== '' ? valor : undefined);

// `Retry-After` en segundos enteros, de 1 a 3600. Una fecha HTTP u otro valor no sirve para una cuenta regresiva.
export function segundosDeEspera(valor: string | null): number | undefined {
  if (valor === null || !/^\d+$/.test(valor)) return undefined;
  const segundos = Number(valor);
  return segundos >= 1 && segundos <= 3600 ? segundos : undefined;
}

// Convierte una respuesta que no es un éxito en el error a mostrar. El código es el de la respuesta, no el del cuerpo. Un cuerpo
// que no es un `problem+json` (HTML de un proxy, texto, vacío) se muestra con el código y un `type` genérico: no se inventa un
// error de M2.
export async function errorDeRespuesta(respuesta: Response): Promise<ErrorDeApi> {
  const requestId = texto(respuesta.headers.get('x-request-id'));
  if (respuesta.status === 504) return m2NoResponde(requestId);

  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(await respuesta.text());
  } catch {
    cuerpo = undefined;
  }
  const problema = typeof cuerpo === 'object' && cuerpo !== null ? (cuerpo as Record<string, unknown>) : {};
  return new ErrorDeApi({
    sinRespuesta: false,
    estado: respuesta.status,
    type: texto(problema.type) ?? 'about:blank',
    title: texto(problema.title) ?? (texto(respuesta.statusText) ?? `Error ${respuesta.status}`),
    detail: texto(problema.detail),
    instance: texto(problema.instance),
    reintentarEnS: segundosDeEspera(respuesta.headers.get('retry-after')),
    requestId,
  });
}
