import { defineConfig } from 'vitest/config';

// Dos proyectos (RNF-07.1). `unitarias` no necesita Docker: se corre sola con `vitest run --project unitarias`.
// `integracion` levanta una base real en un contenedor, uno solo por corrida (pruebas/ayudas/global.ts).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unitarias',
          include: ['pruebas/unitarias/**/*.test.ts', 'pruebas/http/**/*.test.ts', 'pruebas/modulos/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integracion',
          include: ['pruebas/integracion/**/*.test.ts'],
          globalSetup: ['pruebas/ayudas/global.ts'],
        },
      },
    ],
  },
});
