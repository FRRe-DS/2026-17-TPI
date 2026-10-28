import type { FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import type { Writable } from 'node:stream';
import { construirApp } from './app.js';
import { cargarConfigPanel, type Entorno } from './config.js';
import type { DependenciasDemo } from './demo/rutas.js';
import { registrarErroresDeConfig, resumenDeError, type Salir } from './proceso.js';

// El cliente compilado está al lado de este archivo compilado: `panel/dist/servidor/` y `panel/dist/cliente/`.
const DIRECTORIO_DEL_CLIENTE = fileURLToPath(new URL('../cliente', import.meta.url));

export type OpcionesArranquePanel = {
  // Adonde van los logs; sin él, a la salida estándar. Solo para las pruebas.
  flujoLog?: Writable;
  // La carpeta con el cliente compilado. Solo para las pruebas, que no compilan el de verdad.
  directorioCliente?: string;
  // La base y Docker de la vista de demostración, para probar sin una base real. Sin ellos, los de la configuración.
  demo?: DependenciasDemo;
};

// El panel andando: la app, que ya escucha, y `detener`, que la cierra y termina con `salir(0)`. Llamarla otra vez devuelve la
// misma parada.
export type PanelAndando = { app: FastifyInstance; detener: () => Promise<void> };

// Arranca el panel con las variables del entorno (RNF-06.4): lee la configuración y escucha en PANEL_ESCUCHA y PANEL_PUERTO. Si
// algo falla, lo registra sin los valores de la configuración y llama a `salir(1)`; devuelve el panel andando, o nada.
export async function arrancarPanel(
  env: Entorno,
  salir: Salir,
  { flujoLog, directorioCliente = DIRECTORIO_DEL_CLIENTE, demo }: OpcionesArranquePanel = {},
): Promise<PanelAndando | undefined> {
  const { config, errores } = cargarConfigPanel(env);
  if (errores) {
    registrarErroresDeConfig(errores, 'panel', flujoLog);
    salir(1);
    return undefined;
  }

  const app = construirApp({ config, flujoLog, directorioCliente, demo });
  try {
    await app.listen({ host: config.escucha, port: config.puerto });
  } catch (error) {
    app.log.error({ err: resumenDeError(error) }, 'El panel no pudo arrancar');
    await app.close().catch(() => undefined);
    salir(1);
    return undefined;
  }

  let detencion: Promise<void> | undefined;
  const detener = () =>
    (detencion ??= (async () => {
      app.log.info('Deteniendo el panel');
      try {
        await app.close();
      } catch (error) {
        app.log.error({ err: resumenDeError(error) }, 'El panel no se detuvo en orden');
      }
      salir(0);
    })());
  return { app, detener };
}
