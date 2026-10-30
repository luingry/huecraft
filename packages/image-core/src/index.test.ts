import { describe, expect, it } from 'vitest';
import { DEFAULT_RELIEF } from '@huecraft/project-schema';
import {
  boxBlur,
  exportGridSize,
  extractLumaAlpha,
  previewGridSize,
  reliefField,
  resizeLumaAlpha,
  type RgbaImage,
} from './index.js';

function gray(width: number, height: number, value: (x: number, y: number) => number, alpha = 255): RgbaImage {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const v = value(x, y);
      rgba[o] = rgba[o + 1] = rgba[o + 2] = v;
      rgba[o + 3] = alpha;
    }
  }
  return { width, height, rgba };
}

describe('grid sizes', () => {
  it('keeps the aspect and never upscales', () => {
    expect(previewGridSize(4000, 2000, 640)).toEqual({ width: 640, height: 320 });
    expect(previewGridSize(2000, 4000, 640)).toEqual({ width: 320, height: 640 });
    expect(previewGridSize(100, 50, 640)).toEqual({ width: 100, height: 50 });
  });

  it('derives the export grid from width and resolution, capped at the source', () => {
    expect(exportGridSize(4000, 3000, 100, 0.1)).toEqual({ width: 1000, height: 750 });
    expect(exportGridSize(300, 300, 100, 0.1)).toEqual({ width: 300, height: 300 });
  });
});

describe('resizeLumaAlpha', () => {
  it('area-averages instead of picking the nearest sample', () => {
    // Alternating black/white columns: the average must be mid-gray, nearest would give 0 or 1.
    const img = gray(8, 2, (x) => (x % 2 ? 255 : 0));
    const out = resizeLumaAlpha(extractLumaAlpha(img), { width: 2, height: 1 });
    expect(out.luma[0]).toBeCloseTo(0.5, 5);
    expect(out.luma[1]).toBeCloseTo(0.5, 5);
    expect(out.alpha[0]).toBeCloseTo(1, 5);
  });

  it('handles non-integer ratios with fractional coverage', () => {
    const img = gray(3, 1, (x) => [0, 255, 0][x]);
    const out = resizeLumaAlpha(extractLumaAlpha(img), { width: 2, height: 1 });
    // Output 0 covers [0, 1.5): 1 px black + 0.5 px white → 1/3.
    expect(out.luma[0]).toBeCloseTo(1 / 3, 5);
    expect(out.luma[1]).toBeCloseTo(1 / 3, 5);
  });
});

describe('reliefField', () => {
  it('increases monotonically on a gradient', () => {
    const img = gray(64, 1, (x) => Math.round((x / 63) * 255));
    const t = reliefField(extractLumaAlpha(img), DEFAULT_RELIEF);
    for (let x = 1; x < 64; x++) expect(t[x]).toBeGreaterThanOrEqual(t[x - 1]);
    expect(t[0]).toBeCloseTo(0, 3);
    expect(t[63]).toBeCloseTo(1, 3);
  });

  it('inverts, applies contrast around 0.5 and clamps', () => {
    const img = gray(3, 1, (x) => [0, 128, 255][x]);
    const la = extractLumaAlpha(img);
    const inv = reliefField(la, { ...DEFAULT_RELIEF, invert: true });
    expect(inv[0]).toBeCloseTo(1, 3);
    expect(inv[2]).toBeCloseTo(0, 3);
    const hi = reliefField(la, { ...DEFAULT_RELIEF, contrast: 4 });
    expect(hi[1]).toBeCloseTo(0.5 + (128 / 255 - 0.5) * 4, 2);
    expect(hi[2]).toBe(1);
  });

  it('treats transparent pixels as base (t = 0), even when inverted', () => {
    const img = gray(4, 1, () => 0, 0);
    const t = reliefField(extractLumaAlpha(img), { ...DEFAULT_RELIEF, invert: true });
    expect(Array.from(t)).toEqual([0, 0, 0, 0]);
  });
});

describe('boxBlur', () => {
  it('preserves a constant field and spreads an impulse', () => {
    const flat = new Float32Array(25).fill(0.7);
    boxBlur(flat, 5, 5, 2);
    for (const v of flat) expect(v).toBeCloseTo(0.7, 5);
    const imp = new Float32Array(49);
    imp[24] = 1;
    boxBlur(imp, 7, 7, 1);
    expect(imp[24]).toBeCloseTo(1 / 9, 5);
    expect(imp[23]).toBeCloseTo(1 / 9, 5);
    expect(imp[0]).toBe(0);
  });
});
