import { ModuloNoDisponible } from '../errores.js';

export interface RespuestaModulo {
  estado: number;
  cuerpo: unknown;
}

export interface ClienteModulo {
  obtener(ruta: string, idCorrelacion: string): Promise<RespuestaModulo>;
  enviar(metodo: string, ruta: string, cuerpo: unknown, idCorrelacion: string): Promise<RespuestaModulo>;
}

interface OpcionesCliente {
  nombre: string;
  urlBase: string;
  tiempoMs: number;
  reintentos: number;
  encabezadoCorrelacion: string;
}

const ESPERA_REINTENTO_MS = 200;

export function crearClienteModulo({
  nombre,
  urlBase,
  tiempoMs,
  reintentos,
  encabezadoCorrelacion,
}: OpcionesCliente): ClienteModulo {
  async function ejecutar(metodo: string, ruta: string, cuerpo: unknown, idCorrelacion: string): Promise<RespuestaModulo> {
    const intentos = metodo === 'GET' ? 1 + reintentos : 1;

    for (let i = 0; i < intentos; i++) {
      if (i > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, ESPERA_REINTENTO_MS));
      }

      try {
        const señal = AbortSignal.timeout(tiempoMs);
        const encabezados: Record<string, string> = {
          Accept: 'application/json',
          [encabezadoCorrelacion]: idCorrelacion,
        };
        if (cuerpo !== undefined) {
          encabezados['Content-Type'] = 'application/json';
        }

        const respuesta = await fetch(`${urlBase}${ruta}`, {
          method: metodo,
          headers: encabezados,
          body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
          signal: señal,
        });

        // Body read with the same signal: counts toward the timeout
        const texto = await respuesta.text();

        if (respuesta.status >= 400 && respuesta.status < 500) {
          // 4xx vuelve directamente, sin reintento
          let cuerpoParsed: unknown;
          try {
            cuerpoParsed = JSON.parse(texto);
          } catch {
            cuerpoParsed = texto;
          }
          return { estado: respuesta.status, cuerpo: cuerpoParsed };
        }

        if (respuesta.status < 400) {
          // 2xx/3xx: debe ser JSON; si no, es falta de disponibilidad
          const cuerpoParsed = JSON.parse(texto) as unknown;
          return { estado: respuesta.status, cuerpo: cuerpoParsed };
        }

        // 5xx: falta de disponibilidad, cae al próximo intento
      } catch {
        // Corte por tiempo, fallo de red, JSON inválido: falta de disponibilidad
        if (i === intentos - 1) throw new ModuloNoDisponible(nombre);
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
