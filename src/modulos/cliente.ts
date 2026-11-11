import type { FastifyBaseLogger } from 'fastify';
import { ModuloNoDisponible } from '../errores.js';
import { CAMPO_ID_CORRELACION } from '../logs.js';

export type RespuestaModulo = {
  estado: number;
  cuerpo: unknown;
};

export type ClienteModulo = {
  obtener(ruta: string, idCorrelacion: string): Promise<RespuestaModulo>;
  enviar(metodo: string, ruta: string, cuerpo: unknown, idCorrelacion: string): Promise<RespuestaModulo>;
};

type OpcionesCliente = {
  nombre: string;
  urlBase: string;
  tiempoMs: number;
  // Cuántas veces se vuelve a intentar un GET que falló. Los demás métodos no se reintentan.
  reintentos: number;
  encabezadoCorrelacion: string;
  // El encabezado de correlación que declara el contrato del módulo y el largo máximo que admite. Si está, el identificador va
  // también en él (RNF-14.11), salvo que pase de ese largo (RNF-14.12). Sin ella, solo va el configurado.
  correlacionDelModulo?: { encabezado: string; largoMaximo: number };
  // Da con qué se presenta M2 ante el módulo, en `Authorization: Bearer`, y se llama en cada intento: un token de servicio
  // de vida corta, nuevo en cada uno (RF-2.4.11). Sin ella no se envía el encabezado. Es un secreto que cambia en cada
  // intento y `secretosDeConfig` no conoce: no va en ningún error ni en el log (RNF-19.1).
  credencial?: () => Promise<string>;
  // Los segundos del `Retry-After` del 503, si el contrato lo declara para este módulo (spec 007, RF-2.4.6).
  reintentarDespuesS?: number;
  // El logger de la app, para la línea de cada llamada (RNF-14.10). Sin él no se escribe nada.
  log?: Pick<FastifyBaseLogger, 'info' | 'warn'>;
};

// La pausa entre un intento y el siguiente (plan, Integraciones).
export const PAUSA_REINTENTO_MS = 200;

export const pausar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Un intento en el que el módulo respondió, pero con algo que no sirve: un 5xx o un cuerpo que no es JSON. Lleva el código
// para la línea de la llamada (RNF-14.10); el mensaje tiene el código y nunca el cuerpo (RNF-19.2).
class RespuestaInutil extends Error {
  constructor(
    readonly estado: number,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

export function crearClienteModulo({
  nombre,
  urlBase,
  tiempoMs,
  reintentos,
  encabezadoCorrelacion,
  correlacionDelModulo,
  credencial,
  reintentarDespuesS,
  log,
}: OpcionesCliente): ClienteModulo {
  // Los nombres de encabezado no distinguen mayúsculas: si el del módulo es el configurado, es uno solo, y `fetch` uniría las
  // dos claves en un encabezado con el valor repetido.
  const elDelModuloEsElConfigurado =
    correlacionDelModulo !== undefined && correlacionDelModulo.encabezado.toLowerCase() === encabezadoCorrelacion.toLowerCase();

  // Los encabezados de correlación de un intento. El configurado va siempre (RNF-14.7) y el del módulo se suma con el mismo
  // valor (RNF-14.11). Un identificador más largo que lo que admite el módulo no va en su encabezado; si ese encabezado es
  // el configurado, la llamada sale sin correlación (RNF-14.12).
  function encabezadosDeCorrelacion(idCorrelacion: string): Record<string, string> {
    if (correlacionDelModulo === undefined) return { [encabezadoCorrelacion]: idCorrelacion };
    const cabe = idCorrelacion.length <= correlacionDelModulo.largoMaximo;
    if (elDelModuloEsElConfigurado) return cabe ? { [encabezadoCorrelacion]: idCorrelacion } : {};
    return cabe
      ? { [encabezadoCorrelacion]: idCorrelacion, [correlacionDelModulo.encabezado]: idCorrelacion }
      : { [encabezadoCorrelacion]: idCorrelacion };
  }

  // Una sola línea por llamada, al terminar, salga bien o mal (RNF-14.10): `estado` es el código con el que respondió el
  // módulo en el último intento, también un 4xx o un 5xx, y `null` si en ese intento no respondió (corte o red). Si la llamada
  // falló, va como advertencia. Es una lista cerrada de campos: ni la ruta ni la query, que llevan el clienteId o el viajeId,
  // ni encabezados, ni cuerpos (RNF-19). La causa de la falla no va acá: la registra el 503 (RNF-14.8).
  function registrarLlamada(
    metodo: string,
    idCorrelacion: string,
    estado: number | null,
    intentos: number,
    inicio: number,
    fallo: boolean,
  ) {
    if (log === undefined) return;
    const linea = {
      [CAMPO_ID_CORRELACION]: idCorrelacion,
      modulo: nombre,
      metodo,
      estado,
      intentos,
      duracionMs: Math.round(performance.now() - inicio),
    };
    if (fallo) log.warn(linea, `llamada a ${nombre}`);
    else log.info(linea, `llamada a ${nombre}`);
  }

  // Un intento: devuelve la respuesta del módulo, que puede ser un 4xx. Si no la obtiene, lanza lo que falló: el corte por
  // tiempo, el error de red, el 5xx o el cuerpo que no es JSON, estos dos con su código y sin su cuerpo, que puede traer
  // datos del otro módulo y va al log como causa (RNF-14.8, RNF-19.2). Es lo que se reintenta.
  async function intentar(
    metodo: string,
    ruta: string,
    cuerpo: unknown,
    idCorrelacion: string,
    autorizacion: string | undefined,
  ): Promise<RespuestaModulo> {
    // La señal corre desde antes del `fetch`: el plazo incluye la conexión, los encabezados y el cuerpo (RNF-13.1).
    const senal = AbortSignal.timeout(tiempoMs);
    const encabezados: Record<string, string> = {
      Accept: 'application/json',
      ...encabezadosDeCorrelacion(idCorrelacion),
    };
    if (cuerpo !== undefined) encabezados['Content-Type'] = 'application/json';
    if (autorizacion !== undefined) encabezados.Authorization = autorizacion;

    const respuesta = await fetch(`${urlBase}${ruta}`, {
      method: metodo,
      headers: encabezados,
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
      signal: senal,
      redirect: 'error',
    });
    // Se lee con la misma señal: el cuerpo también cuenta para el corte.
    const texto = await respuesta.text();

    if (respuesta.status >= 500) throw new RespuestaInutil(respuesta.status, `${nombre} respondió ${respuesta.status}`);
    // Un 4xx es una respuesta del módulo: se devuelve tal cual, sin reintento. Si no es JSON, va el texto.
    if (respuesta.status >= 400) {
      try {
        return { estado: respuesta.status, cuerpo: JSON.parse(texto) as unknown };
      } catch {
        return { estado: respuesta.status, cuerpo: texto };
      }
    }
    // Una respuesta que no es un error tiene que ser JSON; si no, el módulo no está bien. El SyntaxError de JSON.parse no
    // sale: su mensaje copia un pedazo del texto.
    try {
      return { estado: respuesta.status, cuerpo: JSON.parse(texto) as unknown };
    } catch {
      throw new RespuestaInutil(respuesta.status, `${nombre} respondió ${respuesta.status} con un cuerpo que no es JSON`);
    }
  }

  // Los GET se reintentan; un POST, PUT o DELETE no, porque repetirlo podría hacer el efecto dos veces (RNF-13.2). Agotados
  // los intentos, lanza `ModuloNoDisponible` con lo que falló en el último como causa (RNF-14.8).
  async function ejecutar(metodo: string, ruta: string, cuerpo: unknown, idCorrelacion: string): Promise<RespuestaModulo> {
    const intentos = metodo === 'GET' ? 1 + reintentos : 1;
    const inicio = performance.now();
    let ultimaFalla: unknown;
    let ultimoEstado: number | null = null;
    for (let intento = 1; intento <= intentos; intento++) {
      // Fuera del try: si M2 no puede dar su credencial, la falla es de M2 y no del módulo. No se reintenta ni es un 503: sale
      // tal cual y da 500. Si ya había salido un intento, la llamada queda registrada con los que salieron; si no, no hubo
      // llamada y no hay línea.
      let autorizacion: string | undefined;
      try {
        autorizacion = credencial !== undefined ? `Bearer ${await credencial()}` : undefined;
      } catch (error) {
        if (intento > 1) registrarLlamada(metodo, idCorrelacion, ultimoEstado, intento - 1, inicio, true);
        throw error;
      }
      try {
        const respuesta = await intentar(metodo, ruta, cuerpo, idCorrelacion, autorizacion);
        registrarLlamada(metodo, idCorrelacion, respuesta.estado, intento, inicio, false);
        return respuesta;
      } catch (error) {
        ultimaFalla = error;
        ultimoEstado = error instanceof RespuestaInutil ? error.estado : null;
        if (intento < intentos) await pausar(PAUSA_REINTENTO_MS);
      }
    }
    registrarLlamada(metodo, idCorrelacion, ultimoEstado, intentos, inicio, true);
    throw new ModuloNoDisponible(nombre, { cause: ultimaFalla, reintentarDespuesS });
  }

  return {
    obtener(ruta, idCorrelacion) {
      return ejecutar('GET', ruta, undefined, idCorrelacion);
    },
    enviar(metodo, ruta, cuerpo, idCorrelacion) {
      return ejecutar(metodo, ruta, cuerpo, idCorrelacion);
    },
  };
}
