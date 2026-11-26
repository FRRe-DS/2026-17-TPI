// El token con el que M2 se presenta ante M6 (spec 125). Dos implementaciones con la misma forma, elegidas al arrancar: con las
// variables de Keycloak, el token se pide por `client_credentials` (RF-2.4.11.1); sin ellas, M2 firma el HS256 de siempre
// (RF-2.4.11.2, RF-2.4.11 de la spec 007).
import type { Config, ConfigTokens, ConfigTokenServicio } from '../config.js';
import { ErrorDeIntegracion, ModuloNoDisponible } from '../errores.js';
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
) {
  // Se arma una vez: el secreto queda solo en este encabezado, que no va a ningún error ni al log (RNF-19).
  const autorizacion = `Basic ${Buffer.from(`${comoFormulario(cliente)}:${comoFormulario(secreto)}`).toString('base64')}`;
  const cuerpo = new URLSearchParams({ grant_type: 'client_credentials' }).toString();

  // Un intento: el token, o lanza. Un 4xx sale como `ErrorDeIntegracion` y no se reintenta (RF-2.4.11.7); lo demás que falla
  // (corte, red, 5xx, un 200 sin la forma pedida) se reintenta (RF-2.4.11.6).
  async function intentar(): Promise<TokenDeKeycloak> {
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
    const texto = await respuesta.text();
    const { status: estado } = respuesta;

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

  // Hasta `1 + reintentosModulos` intentos, con la pausa de siempre entre uno y otro. Agotados, `ModuloNoDisponible`: un 503
  // genérico con `Retry-After` y lo que falló en el último intento como causa (RF-2.4.11.6, RNF-14.8).
  return async function pedir(): Promise<TokenDeKeycloak> {
    const intentos = 1 + reintentosModulos;
    let ultimaFalla: unknown;
    for (let intento = 1; intento <= intentos; intento++) {
      try {
        return await intentar();
      } catch (error) {
        if (error instanceof ErrorDeIntegracion) throw error;
        ultimaFalla = error;
        if (intento < intentos) await pausar(PAUSA_REINTENTO_MS);
      }
    }
    throw new ModuloNoDisponible(NOMBRE, { cause: ultimaFalla, reintentarDespuesS });
  };
}

// El token de Keycloak (RF-2.4.11.1). Por ahora cada `obtener` hace su pedido.
function crearTokenServicioKeycloak(tokenServicio: ConfigTokenServicio, config: ConfigPedido): TokenServicio {
  const pedir = crearPedidoDeToken(tokenServicio, config);
  return {
    modo: 'keycloak',
    obtener: async () => ({ token: (await pedir()).token, reutilizado: false }),
    descartar: () => undefined,
  };
}

// Con las tres variables de Keycloak, el token se pide a Keycloak (RF-2.4.11.1); sin ninguna, el HS256 (RF-2.4.11.2).
export function crearTokenServicio(config: ConfigDelTokenServicio): TokenServicio {
  return config.tokenServicio === undefined
    ? crearTokenServicioHs256(config)
    : crearTokenServicioKeycloak(config.tokenServicio, config);
}
