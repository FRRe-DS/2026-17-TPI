import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// El cliente del panel (plan, Estructura): React 19 compilado a `panel/dist/cliente`, que sirve `servidor/estaticos.ts`.
// Nada se incrusta en el HTML (RNF-19.3): ni los archivos chicos se pasan a `data:`, que la política de seguridad del panel
// no permite, y el CSS sale en archivos.
export default defineConfig({
  root: fileURLToPath(new URL('./cliente', import.meta.url)),
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./dist/cliente', import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    sourcemap: false,
  },
});
