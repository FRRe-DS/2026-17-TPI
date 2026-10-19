import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist/', 'src/generado/']),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },
  {
    // Solo el script de la prueba de contrato, que es nuestro. Los globales de Node van a mano para no sumar una dependencia.
    files: ['scripts/contrato-test.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', URL: 'readonly' } },
  },
]);
