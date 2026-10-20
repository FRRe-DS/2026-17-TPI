import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unitarias',
          include: [
            'pruebas/unitarias/**/*.test.ts',
            'pruebas/http/**/*.test.ts',
            'pruebas/modulos/**/*.test.ts',
          ],
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
