// El token con el que M2 se presenta ante M6 (spec 125). Dos implementaciones con la misma forma, elegidas al arrancar: con las
// variables de Keycloak, el token se pide por `client_credentials` (RF-2.4.11.1); sin ellas, M2 firma el HS256 de siempre
// (RF-2.4.11.2, RF-2.4.11 de la spec 007).
import type { FastifyBaseLogger } from 'fastify';
import type { Config, ConfigTokens, ConfigTokenServicio } from '../config.js';
import { ErrorDeIntegracion, ModuloNoDisponible } from '../errores.js';
import { CAMPO_ID_CORRELACION } from '../logs.js';
import { PAUSA_REINTENTO_MS, pausar } from '../modulos/cliente.js';
import { tokenDeServicio } from './tokens.js';

// `reutilizado` dice si el token salió de la memoria y no se pidió durante esta operación: solo a uno reutilizado le corresponde
// la renovación ante un `401` de M6 (RF-2.4.11.8).
export type TokenObtenido = { token: string; reutilizado: boolean };

export type TokenServicio = {
  modo: 'keycloak' | 'hs256';
  // El id de correlación es el de la operación que pide el token: va en la línea del pedido a Keycloak (RNF-14.15).
  obtener(idCorrelacion: string): Promise<TokenObtenido>;
  // Olvida el token guardado, si es este, para que el siguiente `obtener` pida otro (RF-2.4.11.8).
  descartar(token: string): void;
};

// Los tiempos y reintentos con que se pide el token a Keycloak son los de cualquier otro módulo (RNF-13).
type ConfigPedido = Pick<Config, 'tiempoModulosMs' | 'reintentosModulos' | 'reintentarDespuesS'>;

// Sin `tokenServicio` (las pruebas que arman la configuración a mano) es lo mismo que sin las variables de Keycloak.
type ConfigDelTokenServicio = ConfigTokens & Pick<Config, 'audienciaM6'> & ConfigPedido & Partial<Pick<Config, 'tokenServicio'>>;

// El HS256 de RF-2.4.11: uno nuevo en cada pedido, de 60 s, que nunca se guarda. No hay nada que descartar.
export function crearTokenServicioHs256(config: ConfigTokens & Pick<Config, 'audienciaM6'>): TokenServicio {
  return {
    modo: 'hs256',
    obtener: async () => ({ token: await tokenDeServicio(config), reutilizado: false }),
    descartar: () => undefined,
  };
}

const NOMBRE = 'Keycloak';

// El logger de la app, para la línea de cada pedido (RNF-14.15). Sin él no se escribe nada.
type Log = Pick<FastifyBaseLogger, 'info' | 'warn'>;

// Un token que entregó Keycloak y el instante, en milisegundos de `Date.now()`, en que vence según su `expires_in`.
type TokenDeKeycloak = { token: string; venceEn: number };

// Un intento en el que Keycloak respondió, pero con algo que no sirve: un 5xx, otro código que no es 200 ni 4xx, o un 200 sin
// la forma de RF-2.4.11.6. Es falta de disponibilidad y se reintenta. El mensaje lleva el código y nunca el cuerpo, que trae
// el token (RNF-19).
class RespuestaInutil extends Error {
  constructor(
    readonly estado: number,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

const esObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === 'object' && valor !== null && !Array.isArray(valor);

// RFC 6749, 2.3.1: el cliente y el secreto van codificados como formulario antes de unirlos para `Basic`.
const comoFormulario = (texto: string) => new URLSearchParams([['', texto]]).toString().slice(1);

// El pedido de token por `client_credentials` (RF-2.4.11.1). No usa el cliente de módulos: manda un formulario y se reintenta
// aunque sea un `POST`, porque no cambia nada en Keycloak (plan, Decisiones; RNF-13).
function crearPedidoDeToken(
  { urlTokens, cliente, secreto }: ConfigTokenServicio,
  { tiempoModulosMs, reintentosModulos, reintentarDespuesS }: ConfigPedido,
  log: Log | undefined,
) {
  // Se arma una vez: el secreto queda solo en este encabezado, que no va a ningún error ni al log (RNF-19).
  const autorizacion = `Basic ${Buffer.from(`${comoFormulario(cliente)}:${comoFormulario(secreto)}`).toString('base64')}`;
  const cuerpo = new URLSearchParams({ grant_type: 'client_credentials' }).toString();

  // Un intento: el token, o lanza. Un 4xx sale como `ErrorDeIntegracion` y no se reintenta (RF-2.4.11.7); lo demás que falla
  // (corte, red, 5xx, un 200 sin la forma pedida) se reintenta (RF-2.4.11.6). En `intento.estado` deja el código con el que
  // respondió Keycloak, para la línea del pedido; queda en `null` si no respondió.
  async function intentar(intento: { estado: number | null }): Promise<TokenDeKeycloak> {
    // La señal corre desde antes del `fetch`: el plazo incluye la conexión y el cuerpo (RNF-13.1).
    const senal = AbortSignal.timeout(tiempoModulosMs);
    const respuesta = await fetch(urlTokens, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: autorizacion,
      },
      body: cuerpo,
      signal: senal,
      redirect: 'error',
    });
    // Se lee con la misma señal: el cuerpo también cuenta para el corte. Si se corta, el intento queda sin código, como en el
    // cliente de módulos.
    const texto = await respuesta.text();
    const { status: estado } = respuesta;
    intento.estado = estado;

    // Un rechazo es un error de configuración de M2: la causa lleva el código y nunca el cuerpo de Keycloak (RF-2.4.11.7).
    if (estado >= 400 && estado < 500) throw new ErrorDeIntegracion({ cause: new Error(`${NOMBRE} respondió ${estado}`) });
    if (estado !== 200) throw new RespuestaInutil(estado, `${NOMBRE} respondió ${estado}`);
    let datos: unknown;
    try {
      datos = JSON.parse(texto);
    } catch {
      // El SyntaxError no sale: su mensaje copia un pedazo del texto.
      throw new RespuestaInutil(estado, `${NOMBRE} respondió ${estado} con un cuerpo que no es JSON`);
    }
    // Solo se leen `access_token` y `expires_in`; el token no se verifica ni se decodifica: lo valida M6 (RF-2.4.11.10).
    if (
      !esObjeto(datos) ||
      typeof datos.access_token !== 'string' ||
      datos.access_token === '' ||
      !Number.isSafeInteger(datos.expires_in) ||
      (datos.expires_in as number) <= 0
    ) {
      throw new RespuestaInutil(estado, `${NOMBRE} respondió ${estado} sin access_token o sin un expires_in entero positivo`);
    }
    return { token: datos.access_token, venceEn: Date.now() + (datos.expires_in as number) * 1000 };
  }

  // Una línea al terminar el pedido, salga bien o mal, con el mismo formato que la de las llamadas a otros módulos (RNF-14.15):
  // `estado` es el código del último intento, o `null` si no respondió, y una falla va como advertencia. Es una lista cerrada
  // de campos: ni la URL, ni encabezados, ni cuerpos, que llevan el secreto o el token (RNF-19).
  function registrar(idCorrelacion: string, estado: number | null, intentos: number, inicio: number, fallo: boolean) {
    if (log === undefined) return;
    const linea = {
      [CAMPO_ID_CORRELACION]: idCorrelacion,
      modulo: NOMBRE,
      metodo: 'POST',
      estado,
      intentos,
      duracionMs: Math.round(performance.now() - inicio),
    };
    if (fallo) log.warn(linea, `llamada a ${NOMBRE}`);
    else log.info(linea, `llamada a ${NOMBRE}`);
  }

  // Hasta `1 + reintentosModulos` intentos, con la pausa de siempre entre uno y otro. Agotados, `ModuloNoDisponible`: un 503
  // genérico con `Retry-After` y lo que falló en el último intento como causa (RF-2.4.11.6, RNF-14.8). `idCorrelacion` es el
  // de la operación que disparó el pedido: va en su línea.
  return async function pedir(idCorrelacion: string): Promise<TokenDeKeycloak> {
    const intentos = 1 + reintentosModulos;
    const inicio = performance.now();
    let ultimaFalla: unknown;
    let estado: number | null = null;
    for (let numero = 1; numero <= intentos; numero++) {
      const intento = { estado: null as number | null };
      try {
        const obtenido = await intentar(intento);
        registrar(idCorrelacion, intento.estado, numero, inicio, false);
        return obtenido;
      } catch (error) {
        estado = intento.estado;
        if (error instanceof ErrorDeIntegracion) {
          registrar(idCorrelacion, estado, numero, inicio, true);
          throw error;
        }
        ultimaFalla = error;
        if (numero < intentos) await pausar(PAUSA_REINTENTO_MS);
      }
    }
    registrar(idCorrelacion, estado, intentos, inicio, true);
    throw new ModuloNoDisponible(NOMBRE, { cause: ultimaFalla, reintentarDespuesS });
  };
}

// Lo que le tiene que quedar de vida a un token para reutilizarlo (RF-2.4.11.4): cubre la llamada a M6 con su reintento y deja
// margen para relojes que no coinciden.
const VIDA_MINIMA_MS = 30_000;

// El token de Keycloak (RF-2.4.11.1). Guarda en la memoria del proceso, y en ningún otro lugar, un token y su vencimiento
// (RNF-19), y lo reutiliza mientras le queden 30 s o más (RF-2.4.11.4). Si hay que pedir uno y ya hay un pedido en curso, se
// espera ese mismo: todos reciben el mismo token o el mismo error (RF-2.4.11.5, Casos límite).
function crearTokenServicioKeycloak(
  tokenServicio: ConfigTokenServicio,
  config: ConfigPedido,
  log: Log | undefined,
): TokenServicio {
  const pedir = crearPedidoDeToken(tokenServicio, config, log);
  let guardado: TokenDeKeycloak | undefined;
  let enCurso: Promise<TokenDeKeycloak> | undefined;

  const leQuedaVida = ({ venceEn }: TokenDeKeycloak) => venceEn - Date.now() >= VIDA_MINIMA_MS;

  // El pedido mismo guarda su resultado y se borra al terminar, sin depender de cuál de los que esperan siga primero. Un token
  // de menos de 30 s se entrega y no se guarda; una falla no se guarda, así que el siguiente vuelve a pedir.
  function pedirCompartido(idCorrelacion: string): Promise<TokenDeKeycloak> {
    enCurso ??= pedir(idCorrelacion)
      .then((obtenido) => {
        if (leQuedaVida(obtenido)) guardado = obtenido;
        return obtenido;
      })
      .finally(() => {
        enCurso = undefined;
      });
    return enCurso;
  }

  return {
    modo: 'keycloak',
    // Un token reutilizado no hace pedido ni deja línea (RNF-14.15).
    async obtener(idCorrelacion) {
      if (guardado !== undefined && leQuedaVida(guardado)) return { token: guardado.token, reutilizado: true };
      // Pedido durante esta operación, aunque lo haya iniciado otra: no es reutilizado (RF-2.4.11.8).
      return { token: (await pedirCompartido(idCorrelacion)).token, reutilizado: false };
    },
    // Compara el token: un 401 que llega tarde con uno viejo no borra el más nuevo que guardó otro pedido.
    descartar(token) {
      if (guardado?.token === token) guardado = undefined;
    },
  };
}

// Con las tres variables de Keycloak, el token se pide a Keycloak (RF-2.4.11.1); sin ninguna, el HS256 (RF-2.4.11.2). Lo usa
// también la línea de arranque (RNF-14.14).
export const modoTokenServicio = (config: Partial<Pick<Config, 'tokenServicio'>>): TokenServicio['modo'] =>
  config.tokenServicio === undefined ? 'hs256' : 'keycloak';

// `log` es el de la app: cada pedido a Keycloak deja su línea (RNF-14.15). El HS256 no pide nada y no la usa.
export function crearTokenServicio(config: ConfigDelTokenServicio, log?: Log): TokenServicio {
  return config.tokenServicio === undefined
    ? crearTokenServicioHs256(config)
    : crearTokenServicioKeycloak(config.tokenServicio, config, log);
}
