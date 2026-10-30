import { runPipeline } from './pipeline.js';

const w = 128;
const h = 128;
const rgba = new Uint8ClampedArray(w * h * 4);
for (let i = 0; i < w * h; i++) {
  const v = (i % w) / w;
  rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = Math.floor(v * 255);
  rgba[i * 4 + 3] = 255;
}

const t0 = performance.now();
runPipeline({
  project: {
    schemaVersion: 1,
    id: 'bench',
    name: 'bench',
    createdAt: '',
    updatedAt: '',
    relief: { mode: 'luminance', contrast: 1, gamma: 1, paletteColors: [], referenceAnchors: [] },
    print: { layerHeightMm: 0.08, baseThicknessMm: 0.4, maxHeightMm: 3.2, mmPerPixel: 0.25 },
    stack: [],
  },
  image: { width: w, height: h, rgba },
  filaments: [
    { id: 'a', name: 'Black', brand: 'G', colorHex: '#111', lab: { l: 8, a: 0, b: 0 }, tdMm: 0.3, source: 'builtin' },
    { id: 'b', name: 'White', brand: 'G', colorHex: '#eee', lab: { l: 94, a: 0, b: 0 }, tdMm: 6, source: 'builtin' },
  ],
});
console.log(`Bench 128²: ${(performance.now() - t0).toFixed(1)} ms`);
