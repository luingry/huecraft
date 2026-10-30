import { describe, expect, it } from 'vitest';
import { computeHeightField, decodeImageData } from './index.js';

describe('computeHeightField luminance', () => {
  it('increases monotonically left to right on gradient', () => {
    const w = 64;
    const h = 1;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let x = 0; x < w; x++) {
      const v = Math.floor((x / (w - 1)) * 255);
      rgba[x * 4] = v;
      rgba[x * 4 + 1] = v;
      rgba[x * 4 + 2] = v;
      rgba[x * 4 + 3] = 255;
    }
    const img = decodeImageData(w, h, rgba);
    const field = computeHeightField(img, {
      mode: 'luminance',
      contrast: 1,
      gamma: 1,
      paletteColors: [],
      referenceAnchors: [],
    }, 3);
    for (let x = 1; x < w; x++) {
      expect(field.heights[x]).toBeGreaterThanOrEqual(field.heights[x - 1]);
    }
  });
});
