import { describe, expect, it } from 'vitest';
import {
  buildPrintedLut,
  buildSlicerLut,
  computeLayerField,
  computeLineLimitedLayerField,
  layerCountForHeight,
  layerFieldToRgba,
  openThinPeaks,
  transmissionFactor,
  type LayerModel,
} from './index.js';

describe('transmissionFactor (HueForge TD semantics)', () => {
  it('leaves 5 % visible at thickness = TD', () => {
    expect(transmissionFactor(2, 2)).toBeCloseTo(0.05, 6);
    expect(transmissionFactor(0.3, 0.3)).toBeCloseTo(0.05, 6);
  });

  it('is near zero for opaque filament and high for a thin translucent layer', () => {
    expect(transmissionFactor(0.2, 1)).toBeLessThan(0.01);
    expect(transmissionFactor(8, 0.08)).toBeGreaterThan(0.95);
    expect(transmissionFactor(0, 0.08)).toBe(0);
  });

  it('decreases monotonically with thickness', () => {
    expect(transmissionFactor(4, 2)).toBeLessThan(transmissionFactor(4, 1));
  });
});

const model: LayerModel = {
  firstLayerHeightMm: 0.16,
  layerHeightMm: 0.08,
  baseThicknessMm: 0.16,
  maxHeightMm: 0.96,
  baseLayers: 1,
  totalLayers: 11,
};

describe('layerCountForHeight (slicer mid-plane rule)', () => {
  it('counts a layer when its mid-plane is below the surface', () => {
    // Mid-planes: 0.08, 0.20, 0.28, 0.36 ...
    expect(layerCountForHeight(0.16, model)).toBe(1);
    expect(layerCountForHeight(0.2, model)).toBe(1); // exactly on the mid-plane: not printed
    expect(layerCountForHeight(0.2001, model)).toBe(2);
    expect(layerCountForHeight(0.24, model)).toBe(2); // top of layer 1
    expect(layerCountForHeight(0.2799, model)).toBe(2);
    expect(layerCountForHeight(0.2801, model)).toBe(3);
  });

  it('maps every layer top to its own layer count', () => {
    for (let n = 1; n <= 11; n++) expect(layerCountForHeight(0.16 + (n - 1) * 0.08, model)).toBe(n);
  });

  it('clamps to [baseLayers, totalLayers]', () => {
    expect(layerCountForHeight(0, { ...model, baseLayers: 3 })).toBe(3);
    expect(layerCountForHeight(50, model)).toBe(11);
  });

  it('computes a field from relief values', () => {
    const f = computeLayerField(new Float32Array([0, 0.5, 1]), model);
    expect(Array.from(f)).toEqual([1, 6, 11]);
  });
});

const black = { colorHex: '#000000', tdMm: 0.3 };
const white = { colorHex: '#ffffff', tdMm: 8 };
const red = { colorHex: '#ff0000', tdMm: 2 };

describe('printed LUT', () => {
  const thick = (k: number) => (k === 0 ? 0.16 : 0.08);

  it('starts at the first filament colour', () => {
    const lut = buildPrintedLut([red, red, red], thick);
    expect(Array.from(lut.subarray(3, 6))).toEqual([255, 0, 0]);
  });

  it('opaque black (TD 0.3) hides what is below within a few layers', () => {
    const layers = [white, ...Array(10).fill(black)];
    const lut = buildPrintedLut(layers, thick);
    // One 0.08 mm black layer hides ~55 % of the light (linear), 0.32 mm ≥ 95 %.
    expect(lut[2 * 3]).toBeLessThan(200);
    expect(lut[5 * 3]).toBeLessThan(70);
    expect(lut[11 * 3]).toBeLessThan(5);
    for (let n = 2; n <= 11; n++) expect(lut[n * 3]).toBeLessThanOrEqual(lut[(n - 1) * 3]);
  });

  it('white (TD 8) lets the colour below through', () => {
    const layers = [black, ...Array(10).fill(white)];
    const lut = buildPrintedLut(layers, thick);
    // After 0.08 mm of white most of the black is still visible.
    expect(lut[2 * 3]).toBeLessThan(110);
    // Brightness grows monotonically and stays below white.
    for (let n = 2; n <= 11; n++) expect(lut[n * 3]).toBeGreaterThanOrEqual(lut[(n - 1) * 3]);
    expect(lut[11 * 3]).toBeLessThan(255);
  });

  it('slicer LUT is exactly the top-layer filament colour', () => {
    const lut = buildSlicerLut([black, white, red]);
    expect(Array.from(lut.subarray(3, 6))).toEqual([0, 0, 0]);
    expect(Array.from(lut.subarray(6, 9))).toEqual([255, 255, 255]);
    expect(Array.from(lut.subarray(9, 12))).toEqual([255, 0, 0]);
  });

  it('expands a field into opaque RGBA', () => {
    const lut = buildSlicerLut([black, red]);
    const rgba = layerFieldToRgba(new Uint16Array([1, 2]), lut);
    expect(Array.from(rgba)).toEqual([0, 0, 0, 255, 255, 0, 0, 255]);
  });
});

describe('line-width limit', () => {
  it('removes features narrower than a block', () => {
    // A single tall pixel in a flat 4×4 field disappears into its 2×2 block average.
    const t = new Float32Array(16);
    t[5] = 1;
    const limited = computeLineLimitedLayerField(t, 4, 4, 2, model);
    const full = computeLayerField(t, model);
    expect(full[5]).toBe(11);
    expect(limited[5]).toBe(limited[0]);
    expect(limited[5]).toBeLessThan(11);
  });
});

describe('openThinPeaks', () => {
  const W = 20;
  const field = () => new Uint16Array(W * W).fill(3);
  const set = (f: Uint16Array, x0: number, y0: number, x1: number, y1: number, v: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) f[y * W + x] = v;
  };

  it('removes peaks and ridges narrower than the disk', () => {
    const f = field();
    set(f, 5, 5, 5, 5, 9); // single-pixel spike
    set(f, 10, 2, 11, 17, 8); // 2-pixel-wide ridge
    const out = openThinPeaks(f, W, W, 1.5);
    expect(Math.max(...out)).toBe(3);
  });

  it('keeps plateaus at least one disk wide, and never raises anything', () => {
    const f = field();
    set(f, 4, 4, 12, 12, 9);
    set(f, 8, 8, 8, 8, 1); // a pit is not a peak
    const out = openThinPeaks(f, W, W, 1.5);
    expect(out[6 * W + 6]).toBe(9);
    expect(out[4 * W + 4]).toBe(9); // corners of a square plateau survive a disk this small
    expect(out[8 * W + 8]).toBe(1);
    for (let i = 0; i < f.length; i++) expect(out[i]).toBeLessThanOrEqual(f[i]);
  });

  it('works on float heights and is a no-op below one pixel', () => {
    const h = new Float32Array(W * W).fill(0.5);
    h[3 * W + 3] = 2;
    expect(openThinPeaks(h, W, W, 1.2)[3 * W + 3]).toBeCloseTo(0.5);
    expect(openThinPeaks(h, W, W, 0.6)[3 * W + 3]).toBeCloseTo(2);
  });
});
