import type { FastifyInstance } from 'fastify';
import type { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'vitest';
import { construirApp } from '../../src/app.js';
import type { BaseDeDatos } from '../../src/bd/pool.js';
import type { Config } from '../../src/config.js';
import { cargarContrato, type Contrato } from '../../src/contrato/cargar.js';
import type { Manejadores } from '../../src/contrato/operaciones.js';
import { descartarLogs } from './logs.js';
import { CONFIG_TOKENS } from './tokens.js';

export const contratoDePrueba = cargarContrato(fileURLToPath(new URL('./contrato-prueba.yml', import.meta.url)));

export const CONFIG: Config = {
  urlBd: 'postgres://m2:m2@localhost:5432/m2',
  puerto: 8082,
  ...CONFIG_TOKENS,
  tiempoBdMs: 2000,
  tiempoModulosMs: 2000,
  reintentosModulos: 1,
  encabezadoCorrelacion: 'X-Request-Id',
  urlM6: 'http://m6:3006/api/v1',
  credencialM6: undefined,
  reintentarDespuesS: 5,
};

// Un contrato armado en la prueba, para los casos que el contrato de prueba no tiene.
export const contratoCon = (paths: object, extra: object = {}): Contrato => ({
  openapi: '3.1.0',
  info: { title: 'Contrato armado en la prueba', version: '0.0.0' },
  ...extra,
  paths,
});

const SIN_BASE = 'Esta prueba no tiene base de datos: pasá un pool en las opciones de crearApp';

// El pool de las pruebas que no necesitan la base: si alguna llega a consultarla o a abrir una transacción, falla y lo dice.
export const POOL_FALSO: BaseDeDatos = {
  consultar: async () => {
    throw new Error(SIN_BASE);
  },
  connect: async () => {
    throw new Error(SIN_BASE);
  },
  tiempoBdMs: 2000,
};

const abiertas: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(abiertas.splice(0).map((app) => app.close()));
});

// La app de una prueba: con el contrato de prueba, salvo que se pase otro, y CONFIG con los cambios que se pidan. El log
// se descarta, salvo que se pase un flujo (capturarLogs). Sin base: el pool es POOL_FALSO, salvo que se pase otro. Se cierra
// sola al terminar cada prueba (este módulo registra el afterEach en el archivo que lo importa); el pool no, que es de la
// prueba.
export function crearApp(
  manejadores: Manejadores,
  opciones: { contrato?: Contrato; config?: Partial<Config>; flujoLog?: Writable; pool?: BaseDeDatos } = {},
) {
  const app = construirApp({
    config: { ...CONFIG, ...opciones.config },
    pool: opciones.pool ?? POOL_FALSO,
    contrato: opciones.contrato ?? contratoDePrueba,
    manejadores,
    flujoLog: opciones.flujoLog ?? descartarLogs,
  });
  abiertas.push(app);
  return app;
}
