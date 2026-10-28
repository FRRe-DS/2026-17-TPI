import type { Writable } from 'node:stream';
import { cargarConfigM6, type Entorno } from '../servidor/config.js';
import { registrarErroresDeConfig, resumenDeError, type Salir } from '../servidor/proceso.js';
import { construirAppControl } from './app-control.js';
import { construirAppM6 } from './app-m6.js';
import { crearEstadoM6 } from './estado.js';
import { crearPuertoApi } from './puerto-api.js';

// En todas las interfaces: dentro del contenedor, M2 y el panel llegan por la red de docker y no por localhost. Afuera, compose
// publica solo el canal de control y solo en 127.0.0.1 (plan, Infraestructura).
const ESCUCHA = '0.0.0.0';

export type OpcionesArranqueM6 = {
  // Adonde van los logs; sin él, a la salida estándar. Solo para las pruebas.
  flujoLog?: Writable;
};

// El M6 simulado andando: sus dos puertos abiertos y `detener`, que los cierra y termina con `salir(0)`.
export type M6Andando = { detener: () => Promise<void> };

// Arranca el M6 simulado con las variables del entorno: la API de m6.yml en M6_PUERTO y el canal de control en M6_PUERTO_CONTROL.
// Si algo falla, lo registra sin los valores de la configuración, no deja ningún puerto abierto y llama a `salir(1)`.
export async function arrancarM6(env: Entorno, salir: Salir, { flujoLog }: OpcionesArranqueM6 = {}): Promise<M6Andando | undefined> {
  const { config, errores } = cargarConfigM6(env);
  if (errores) {
    registrarErroresDeConfig(errores, 'm6-simulado', flujoLog);
    salir(1);
    return undefined;
  }

  const estado = crearEstadoM6();
  const api = crearPuertoApi({ puerto: config.puerto, escucha: ESCUCHA, construir: () => construirAppM6({ config, estado, flujoLog }) });
  const control = construirAppControl({ config, estado, api, flujoLog });
  try {
    await api.abrir();
    await control.listen({ host: ESCUCHA, port: config.puertoControl });
  } catch (error) {
    control.log.error({ err: resumenDeError(error) }, 'El M6 simulado no pudo arrancar');
    await Promise.allSettled([api.cerrar(), control.close()]);
    salir(1);
    return undefined;
  }

  let detencion: Promise<void> | undefined;
  const detener = () =>
    (detencion ??= (async () => {
      control.log.info('Deteniendo el M6 simulado');
      // El canal primero: así nadie cambia el modo (y reabre la API) mientras se cierra.
      const cierres = [...(await Promise.allSettled([control.close()])), ...(await Promise.allSettled([api.cerrar()]))];
      for (const cierre of cierres) {
        if (cierre.status === 'rejected') control.log.error({ err: resumenDeError(cierre.reason) }, 'El M6 simulado no se detuvo en orden');
      }
      salir(0);
    })());
  return { detener };
}
