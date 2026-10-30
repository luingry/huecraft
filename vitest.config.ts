import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (name: string) => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

// Workspace packages resolve to their TypeScript sources (never stale dist builds).
const alias = Object.fromEntries(
  ['engine', 'exporters', 'filament-db', 'image-core', 'mesh', 'optics', 'project-schema', 'design-system'].map((n) => [
    `@huecraft/${n}`,
    pkg(n),
  ]),
);

export default defineConfig(({ mode }) => ({
  resolve: { alias },
  test:
    mode === 'bench'
      ? // `pnpm --filter @huecraft/engine bench` (or `vitest run --mode bench`)
        { include: ['packages/engine/src/bench.ts'], testTimeout: 120_000 }
      : { include: ['packages/**/*.test.ts'] },
}));
