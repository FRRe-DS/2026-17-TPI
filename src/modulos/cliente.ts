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
};

// La pausa entre un intento y el siguiente (plan, Integraciones).
const PAUSA_REINTENTO_MS = 200;

// Que un intento no obtuvo respuesta del módulo: corte por tiempo, red caída, 5xx o cuerpo que no es JSON. Es lo que
// se reintenta; no sale del cliente, que al final lanza `ModuloNoDisponible`.
class IntentoFallido extends Error {}

const pausar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function crearClienteModulo({
  nombre,
  urlBase,
  tiempoMs,
  reintentos,
  encabezadoCorrelacion,
}: OpcionesCliente): ClienteModulo {
  // Un intento: devuelve la respuesta del módulo, que puede ser un 4xx, o lanza `IntentoFallido`.
  async function intentar(metodo: string, ruta: string, cuerpo: unknown, idCorrelacion: string): Promise<RespuestaModulo> {
    try {
      // La señal corre desde antes del `fetch`: el plazo incluye la conexión, los encabezados y el cuerpo (RNF-13.1).
      const senal = AbortSignal.timeout(tiempoMs);
      const encabezados: Record<string, string> = {
        Accept: 'application/json',
        [encabezadoCorrelacion]: idCorrelacion,
      };
      if (cuerpo !== undefined) encabezados['Content-Type'] = 'application/json';

      const respuesta = await fetch(`${urlBase}${ruta}`, {
        method: metodo,
        headers: encabezados,
        body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
        signal: senal,
        redirect: 'error',
      });
      // Se lee con la misma señal: el cuerpo también cuenta para el corte.
      const texto = await respuesta.text();

      if (respuesta.status >= 500) throw new IntentoFallido();
      // Un 4xx es una respuesta del módulo: se devuelve tal cual, sin reintento. Si no es JSON, va el texto.
      if (respuesta.status >= 400) {
        try {
          return { estado: respuesta.status, cuerpo: JSON.parse(texto) as unknown };
        } catch {
          return { estado: respuesta.status, cuerpo: texto };
        }
      }
      // Una respuesta que no es un error tiene que ser JSON; si no, el módulo no está bien.
      return { estado: respuesta.status, cuerpo: JSON.parse(texto) as unknown };
    } catch {
      throw new IntentoFallido();
    }
  }

  // Los GET se reintentan; un POST, PUT o DELETE no, porque repetirlo podría hacer el efecto dos veces (RNF-13.2).
  async function ejecutar(metodo: string, ruta: string, cuerpo: unknown, idCorrelacion: string): Promise<RespuestaModulo> {
    const intentos = metodo === 'GET' ? 1 + reintentos : 1;
    for (let intento = 1; intento <= intentos; intento++) {
      try {
        return await intentar(metodo, ruta, cuerpo, idCorrelacion);
      } catch {
        if (intento < intentos) await pausar(PAUSA_REINTENTO_MS);
      }
    }
    throw new ModuloNoDisponible(nombre);
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
