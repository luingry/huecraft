import react from '@vitejs/plugin-react';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, type Connect, type Plugin } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = (name: string) => path.resolve(__dirname, `../../packages/${name}/src`);

/**
 * Keeps the slicer template (base 3MF) in ~/.huecraft on disk, so it survives a
 * cleared browser storage, another browser or a different dev-server origin.
 * The browser's IndexedDB copy stays the primary one; this is the fallback.
 */
function localTemplateStore(): Plugin {
  const dir = path.join(os.homedir(), '.huecraft');
  const dataFile = path.join(dir, 'slicer-template.3mf');
  const metaFile = path.join(dir, 'slicer-template.json');
  const route = '/__huecraft/slicer-template';

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    if (!req.url || req.url.split('?')[0] !== route) return next();
    try {
      if (req.method === 'GET') {
        if (!fs.existsSync(dataFile) || !fs.existsSync(metaFile)) {
          res.statusCode = 204;
          return res.end();
        }
        const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as { fileName: string; application: string };
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('X-File-Name', encodeURIComponent(meta.fileName));
        res.setHeader('X-Application', encodeURIComponent(meta.application));
        return res.end(fs.readFileSync(dataFile));
      }
      if (req.method === 'PUT') {
        const url = new URL(req.url, 'http://localhost');
        const fileName = url.searchParams.get('fileName') ?? 'template.3mf';
        const application = url.searchParams.get('application') ?? '';
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          try {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(dataFile, Buffer.concat(chunks));
            fs.writeFileSync(metaFile, JSON.stringify({ fileName, application }));
            res.statusCode = 204;
          } catch (e) {
            res.statusCode = 500;
          }
          res.end();
        });
        return;
      }
      if (req.method === 'DELETE') {
        fs.rmSync(dataFile, { force: true });
        fs.rmSync(metaFile, { force: true });
        res.statusCode = 204;
        return res.end();
      }
      res.statusCode = 405;
      res.end();
    } catch (e) {
      res.statusCode = 500;
      res.end(String(e));
    }
  };

  return {
    name: 'huecraft-local-template',
    configureServer: (server) => void server.middlewares.use(handler),
  };
}

export default defineConfig({
  plugins: [react(), localTemplateStore()],
  // A fixed port keeps the origin (and so the browser's IndexedDB) the same every run.
  server: { port: 5173, strictPort: true },
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
