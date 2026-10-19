import type { FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'vitest';
import { construirApp } from '../../src/app.js';
import type { Config } from '../../src/config.js';
import { cargarContrato, type Contrato } from '../../src/contrato/cargar.js';
import type { Manejadores } from '../../src/contrato/operaciones.js';

export const contratoDePrueba = cargarContrato(fileURLToPath(new URL('./contrato-prueba.yml', import.meta.url)));

export const CONFIG: Config = {
  urlBd: 'postgres://m2:m2@localhost:5432/m2',
  puerto: 8082,
  claveTokens: 'clave-de-prueba-de-32-caracteres!',
  emisorTokens: 'pruebas',
  audienciaTokens: 'm2',
  campoRoles: 'roles',
  tiempoBdMs: 2000,
  tiempoModulosMs: 2000,
  reintentosModulos: 1,
  encabezadoCorrelacion: 'X-Request-Id',
};

// Un contrato armado en la prueba, para los casos que el contrato de prueba no tiene.
export const contratoCon = (paths: object, extra: object = {}): Contrato => ({
  openapi: '3.1.0',
  info: { title: 'Contrato armado en la prueba', version: '0.0.0' },
  ...extra,
  paths,
});

const abiertas: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(abiertas.splice(0).map((app) => app.close()));
});

// La app de una prueba: con el contrato de prueba, salvo que se pase otro, y CONFIG con los cambios que se pidan. Se
// cierra sola al terminar cada prueba (este módulo registra el afterEach en el archivo que lo importa).
export function crearApp(manejadores: Manejadores, opciones: { contrato?: Contrato; config?: Partial<Config> } = {}) {
  const app = construirApp({
    config: { ...CONFIG, ...opciones.config },
    contrato: opciones.contrato ?? contratoDePrueba,
    manejadores,
  });
  abiertas.push(app);
  return app;
}
