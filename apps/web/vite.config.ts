import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = (name: string) => path.resolve(__dirname, `../../packages/${name}/src`);

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  resolve: {
    alias: {
      '@huecraft/design-system': pkg('design-system'),
      '@huecraft/engine': pkg('engine'),
      '@huecraft/exporters': pkg('exporters'),
      '@huecraft/filament-db': pkg('filament-db'),
      '@huecraft/image-core': pkg('image-core'),
      '@huecraft/mesh': pkg('mesh'),
      '@huecraft/optics': pkg('optics'),
      '@huecraft/project-schema': pkg('project-schema'),
    },
  },
  worker: {
    format: 'es',
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
  optimizeDeps: {
    exclude: ['@huecraft/engine'],
  },
});
