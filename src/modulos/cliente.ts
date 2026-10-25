import { ModuloNoDisponible } from '../errores.js';

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
  // Da con qué se presenta M2 ante el módulo, en `Authorization: Bearer`, y se llama en cada intento: un token de servicio
  // de vida corta, nuevo en cada uno (RF-2.4.11). Sin ella no se envía el encabezado. Es un secreto que cambia en cada
  // intento y `secretosDeConfig` no conoce: no va en ningún error ni en el log (RNF-19.1).
  credencial?: () => Promise<string>;
  // Los segundos del `Retry-After` del 503, si el contrato lo declara para este módulo (spec 007, RF-2.4.6).
  reintentarDespuesS?: number;
};

// La pausa entre un intento y el siguiente (plan, Integraciones).
const PAUSA_REINTENTO_MS = 200;

const pausar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function crearClienteModulo({
  nombre,
  urlBase,
  tiempoMs,
  reintentos,
  encabezadoCorrelacion,
  credencial,
  reintentarDespuesS,
}: OpcionesCliente): ClienteModulo {
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
      [encabezadoCorrelacion]: idCorrelacion,
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

    if (respuesta.status >= 500) throw new Error(`${nombre} respondió ${respuesta.status}`);
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
      throw new Error(`${nombre} respondió ${respuesta.status} con un cuerpo que no es JSON`);
    }
  }

  // Los GET se reintentan; un POST, PUT o DELETE no, porque repetirlo podría hacer el efecto dos veces (RNF-13.2). Agotados
  // los intentos, lanza `ModuloNoDisponible` con lo que falló en el último como causa (RNF-14.8).
  async function ejecutar(metodo: string, ruta: string, cuerpo: unknown, idCorrelacion: string): Promise<RespuestaModulo> {
    const intentos = metodo === 'GET' ? 1 + reintentos : 1;
    let ultimaFalla: unknown;
    for (let intento = 1; intento <= intentos; intento++) {
      // Fuera del try: si M2 no puede dar su credencial, la falla es de M2 y no del módulo. No se reintenta ni es un 503: sale
      // tal cual y da 500.
      const autorizacion = credencial !== undefined ? `Bearer ${await credencial()}` : undefined;
      try {
        return await intentar(metodo, ruta, cuerpo, idCorrelacion, autorizacion);
      } catch (error) {
        ultimaFalla = error;
        if (intento < intentos) await pausar(PAUSA_REINTENTO_MS);
      }
    }
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
