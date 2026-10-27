import { defineConfig } from 'vitest/config';

// Tres proyectos (RNF-07.1, RNF-07.5). `unitarias` no necesita Docker: se corre sola con `vitest run --project unitarias`.
// `integracion` levanta una base real en un contenedor, uno solo por corrida (pruebas/ayudas/global.ts).
// `navegador` necesita Chrome y queda fuera de `npm test`: se corre con `npm run panel:navegador`.
export default defineConfig({
  test: {
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
          testTimeout: 30_000,
        },
      },
    ],
  },
});
