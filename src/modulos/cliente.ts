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
  reintentos: number; // Su uso lógico está delegado a T25
  encabezadoCorrelacion: string;
}

export function crearClienteModulo({
  nombre,
  urlBase,
  tiempoMs,
  encabezadoCorrelacion,
}: OpcionesCliente): ClienteModulo {
  async function ejecutar(metodo: string, ruta: string, cuerpo: unknown, idCorrelacion: string): Promise<RespuestaModulo> {
    try {
    // Se utiliza AbortSignal para asegurar el corte por tiempo global (conexión y cuerpo compartido)
      const senal = AbortSignal.timeout(tiempoMs);
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
        signal: senal,
        redirect: 'error',
      });

      // Lectura del cuerpo con la misma senal: cuenta para el corte por tiempo
      const texto = await respuesta.text();
      // Las respuestas de la familia 4xx regresan directamente sin activar reintentos innecesarios
      if (respuesta.status >= 400 && respuesta.status < 500) {
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
    } catch {
      throw new ModuloNoDisponible(nombre);
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
