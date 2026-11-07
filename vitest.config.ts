import { defineConfig } from 'vitest/config';
import { OrdenDeArchivos } from './pruebas/distribuida/ayudas/orden.js';

// Cuatro proyectos (RNF-07.1, RNF-07.5). `unitarias` no necesita Docker: se corre sola con `vitest run --project unitarias`.
// `integracion` levanta una base real en un contenedor, uno solo por corrida (pruebas/ayudas/global.ts).
// `navegador` necesita Chrome y la misma base en un contenedor, y queda fuera de `npm test`: se corre con `npm run panel:navegador`,
// que antes compila el panel.
// `distribuida` (spec 081) prueba M2 contra el M6 real del Grupo 12 levantado con compose: tampoco entra en `npm test`, se corre con
// `npm run integracion:m6`. Sus archivos van de a uno porque comparten M2 y M6, y el que apaga a M6, al final (`OrdenDeArchivos`).
export default defineConfig({
  test: {
    sequence: { sequencer: OrdenDeArchivos },
    projects: [
      {
        test: {
          name: 'unitarias',
          include: ['pruebas/unitarias/**/*.test.ts', 'pruebas/http/**/*.test.ts', 'pruebas/modulos/**/*.test.ts', 'pruebas/panel/unitarias/**/*.test.ts', 'pruebas/panel/http/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integracion',
          include: ['pruebas/integracion/**/*.test.ts', 'pruebas/panel/integracion/**/*.test.ts'],
          globalSetup: ['pruebas/ayudas/global.ts'],
        },
      },
      {
        test: {
          name: 'navegador',
          include: ['pruebas/panel/navegador/**/*.test.ts'],
          globalSetup: ['pruebas/ayudas/global.ts'],
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'distribuida',
          include: ['pruebas/distribuida/**/*.test.ts'],
          globalSetup: ['pruebas/distribuida/global.ts'],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 15 * 60_000,
        },
      },
    ],
  },
});
