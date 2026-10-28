import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist/', 'panel/dist/', 'src/generado/', 'panel/cliente/src/generado/']),
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },
  {
    // El panel pinta datos que vienen de M2: nada de HTML crudo (RNF-19.3).
    files: ['panel/cliente/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'No se usa dangerouslySetInnerHTML: React escapa el texto.' },
        { selector: "JSXAttribute[name.name='style']", message: 'Sin estilos en línea: la política de seguridad del panel los bloquea. Van en un CSS Module.' },
      ],
    },
  },
  {
    // Solo el script de la prueba de contrato, que es nuestro. Los globales de Node van a mano para no sumar una dependencia.
    files: ['scripts/contrato-test.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: { AbortSignal: 'readonly', console: 'readonly', fetch: 'readonly', process: 'readonly', URL: 'readonly' },
    },
  },
]);
