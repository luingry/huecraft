/**
 * Engine benchmark. Run with `pnpm --filter @huecraft/engine bench`
 * (vitest in "bench" mode, see the root vitest.config.ts).
 */
import { test } from 'vitest';
import { DEFAULT_PRINT, DEFAULT_RELIEF, type StackEntry } from '@huecraft/project-schema';
import { EngineCore } from './core.js';
import type { SourceImage } from './protocol.js';

function photoLike(width: number, height: number): SourceImage {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const v = 128 + 60 * Math.sin(x / 37) * Math.cos(y / 23) + 50 * Math.sin((x + y) / 90) + ((x * 7919 + y * 104729) % 17) - 8;
      rgba[o] = rgba[o + 1] = rgba[o + 2] = v;
      rgba[o + 3] = 255;
    }
  }
  return { width, height, rgba };
}

const stack: StackEntry[] = [
  { slotId: 'a', startLayer: 0, filament: { name: 'Black', brand: 'B', colorHex: '#000000', tdMm: 0.6 } },
  { slotId: 'b', startLayer: 9, filament: { name: 'Gray', brand: 'B', colorHex: '#8e9089', tdMm: 1.6 } },
  { slotId: 'c', startLayer: 16, filament: { name: 'Light Gray', brand: 'B', colorHex: '#d1d3d5', tdMm: 2.8 } },
  { slotId: 'd', startLayer: 23, filament: { name: 'White', brand: 'B', colorHex: '#ffffff', tdMm: 3.6 } },
];

function time<T>(fn: () => T): [T, number] {
  const t0 = performance.now();
  const r = fn();
  return [r, performance.now() - t0];
}

test('engine bench', () => {
  const lines: string[] = [];
  const core = new EngineCore();
  const [, setMs] = time(() => core.setImage(photoLike(3000, 2000)));
  lines.push(`setImage 3000×2000: ${setMs.toFixed(1)} ms`);

  const params = { relief: DEFAULT_RELIEF, print: DEFAULT_PRINT, stack, maxEdge: 640, simulateLineWidth: false };
  const [cold, coldMs] = time(() => core.preview(params));
  lines.push(`preview 640 cold (resize + relief): ${coldMs.toFixed(1)} ms, ${cold.mesh.triangleCount} tris`);
  const warm: number[] = [];
  for (let i = 0; i < 10; i++) {
    const s = stack.map((e, k) => (k === 1 ? { ...e, startLayer: 8 + (i % 4) } : e));
    warm.push(time(() => core.preview({ ...params, stack: s }))[1]);
  }
  warm.sort((a, b) => a - b);
  lines.push(`preview 640 cached (stack drag): median ${warm[5].toFixed(1)} ms, min ${warm[0].toFixed(1)} ms`);
  const [r, lwMs] = time(() => core.preview({ ...params, simulateLineWidth: true }));
  lines.push(`preview 640 cached + line width: ${lwMs.toFixed(1)} ms, ${r.mesh.triangleCount} tris`);
  lines.push(`  breakdown: ${Object.entries(r.timings).map(([k, v]) => `${k}=${v.toFixed(1)}`).join(' ')}`);

  // Export of a 1000×1000 grid: 100 mm at 0.1 mm from a 1000×1000 source.
  const exportCore = new EngineCore();
  exportCore.setImage(photoLike(1000, 1000));
  const exportParams = { name: 'bench', relief: DEFAULT_RELIEF, print: { ...DEFAULT_PRINT, widthMm: 100, exportResolutionMm: 0.1 }, stack, swapCommand: 'pause' as const };
  const [mf, mfMs] = time(() => exportCore.export({ ...exportParams, format: '3mf' }));
  lines.push(`export 3MF 1000×1000: ${mfMs.toFixed(0)} ms, ${mf.triangleCount} tris, ${(mf.bytes.length / 1e6).toFixed(1)} MB`);
  lines.push(`  breakdown: ${Object.entries(mf.timings).map(([k, v]) => `${k}=${v.toFixed(1)}`).join(' ')}`);
  const [stl, stlMs] = time(() => exportCore.export({ ...exportParams, format: 'stl' }));
  lines.push(`export STL 1000×1000: ${stlMs.toFixed(0)} ms, ${(stl.bytes.length / 1e6).toFixed(1)} MB`);
  console.log(`\n${lines.join('\n')}\n`);
});
