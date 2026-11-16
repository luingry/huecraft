import { describe, expect, it } from 'vitest';
import { DEFAULT_PRINT, DEFAULT_RELIEF, type PrintParams, type StackEntry } from '@huecraft/project-schema';
import { buildPrintedLut, computeLayerField, hexToRgb, srgbToLinear } from '@huecraft/optics';
import { reliefField, resizeLumaAlpha, extractLumaAlpha } from '@huecraft/image-core';
import { buildTuneTarget, EngineCore, layerModelFor, layerStats } from './index.js';
import { layerFilaments, normalizeStack } from './stack.js';
import type { SourceImage } from './protocol.js';

const print: PrintParams = { ...DEFAULT_PRINT, widthMm: 40, maxHeightMm: 1.6, baseThicknessMm: 0.48 };

function entry(slotId: string, startLayer: number, colorHex: string, tdMm = 1): StackEntry {
  return { slotId, startLayer, filament: { name: slotId, brand: 'Test', colorHex, tdMm } };
}

/** Render what the model predicts for given settings: the image auto-tune should recover. */
function renderPrinted(width: number, height: number, stack: StackEntry[]): SourceImage {
  const grey = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const v = Math.round((x / (width - 1)) * 255);
      grey[o] = grey[o + 1] = grey[o + 2] = v;
      grey[o + 3] = 255;
    }
  const la = extractLumaAlpha({ width, height, rgba: grey });
  const model = layerModelFor(print);
  const field = computeLayerField(reliefField(resizeLumaAlpha(la, { width, height }), DEFAULT_RELIEF), model);
  const lut = buildPrintedLut(layerFilaments(normalizeStack(stack), model.totalLayers), (k) => (k === 0 ? print.firstLayerHeightMm : print.layerHeightMm));
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < field.length; i++) {
    const n = field[i];
    out[i * 4] = lut[n * 3];
    out[i * 4 + 1] = lut[n * 3 + 1];
    out[i * 4 + 2] = lut[n * 3 + 2];
    out[i * 4 + 3] = 255;
  }
  return { width, height, rgba: out };
}

describe('auto-tune', () => {
  const truth = [entry('k', 0, '#000000', 0.6), entry('r', 5, '#d02020', 1.5), entry('w', 10, '#ffffff', 3)];

  it('stats reproduce the per-pixel squared error', () => {
    const img = renderPrinted(60, 30, truth);
    const target = buildTuneTarget(img, 60, 30);
    const field = new Uint16Array(60 * 30).map((_, i) => i % 7);
    const st = layerStats(field, target, 6);
    let w = 0;
    for (let n = 0; n <= 6; n++) w += st.w[n];
    expect(w).toBeCloseTo(60 * 30, 3);
    expect(st.hist.reduce((a, b) => a + b, 0)).toBe(60 * 30);
  });

  it('target averages in linear light', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    const t = buildTuneTarget({ width: 2, height: 1, rgba }, 1, 1);
    // Linear mid-grey (0.5) has OKLab L = cbrt(0.5) ≈ 0.794.
    expect(t.lab[0]).toBeCloseTo(Math.cbrt(0.5), 3);
    expect(srgbToLinear(hexToRgb('#ffffff')[0] / 255)).toBe(1);
  });

  it('recovers swap layers it was shifted away from and never gets worse', () => {
    const img = renderPrinted(120, 60, truth);
    const core = new EngineCore();
    core.setImage(img);
    const off = [entry('k', 0, '#000000', 0.6), entry('r', 2, '#d02020', 1.5), entry('w', 14, '#ffffff', 3)];
    const res = core.autoTune({ relief: DEFAULT_RELIEF, print, stack: off, simulateLineWidth: false, options: { reorder: false, tone: false } });
    expect(res.errorAfter).toBeLessThan(res.errorBefore);
    // At least as close as the settings that rendered the image.
    const ref = core.autoTune({ relief: DEFAULT_RELIEF, print, stack: truth, simulateLineWidth: false, options: { reorder: false, tone: false } });
    expect(res.errorAfter).toBeLessThanOrEqual(ref.errorBefore + 1e-6);
    expect(res.stack.map((e) => e.slotId)).toEqual(['k', 'r', 'w']);
    const starts = res.stack.map((e) => e.startLayer);
    for (let i = 1; i < starts.length; i++) expect(starts[i]).toBeGreaterThan(starts[i - 1]);
  });

  it('finds the right order when allowed to reorder', () => {
    const img = renderPrinted(120, 60, truth);
    const core = new EngineCore();
    core.setImage(img);
    const shuffled = [entry('w', 0, '#ffffff', 3), entry('k', 5, '#000000', 0.6), entry('r', 10, '#d02020', 1.5)];
    const fixed = core.autoTune({ relief: DEFAULT_RELIEF, print, stack: shuffled, simulateLineWidth: false, options: { reorder: false, tone: false } });
    const re = core.autoTune({ relief: DEFAULT_RELIEF, print, stack: shuffled, simulateLineWidth: false, options: { reorder: true, tone: false } });
    expect(re.errorAfter).toBeLessThan(fixed.errorAfter);
    expect(re.stack.map((e) => e.slotId)).toEqual(['k', 'r', 'w']);
    expect(re.stack[0].startLayer).toBe(0);
  });

  it('tone search improves a badly contrasted start and stays within budget', () => {
    const img = renderPrinted(120, 60, truth);
    const core = new EngineCore();
    core.setImage(img);
    const relief = { ...DEFAULT_RELIEF, contrast: 0.4, gamma: 2.2 };
    const res = core.autoTune({ relief, print, stack: truth, simulateLineWidth: false, options: { reorder: false, tone: true, timeBudgetMs: 4000 } });
    expect(res.errorAfter).toBeLessThan(res.errorBefore);
    expect(res.ms).toBeLessThan(6000);
    expect(res.relief.contrast).toBeGreaterThan(0);
  });
});

describe('colour-driven heights', () => {
  it('reliefForCount lands on exactly n layers', async () => {
    const { reliefForCount } = await import('./colorHeight.js');
    const model = layerModelFor(print);
    for (let n = model.baseLayers; n <= model.totalLayers; n++) {
      const t = new Float32Array([reliefForCount(n, model)]);
      expect(computeLayerField(t, model)[0]).toBe(n);
    }
  });

  it('separates two colours of equal luma that the luma relief merges', () => {
    // Left half red, right half a blue of the same luma.
    const w = 40, h = 20;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const left = i % w < w / 2;
      rgba.set(left ? [200, 20, 30, 255] : [20, 60, 175, 255], i * 4);
    }
    const st = [entry('k', 0, '#101010', 0.5), entry('b', 4, '#1f3fb0', 0.8), entry('r', 9, '#c81e28', 0.8)];
    const core = new EngineCore();
    core.setImage({ width: w, height: h, rgba });
    const base = { relief: DEFAULT_RELIEF, print, stack: st, maxEdge: 40, simulateLineWidth: false };
    const luma = core.preview(base);
    const color = core.preview({ ...base, relief: { ...DEFAULT_RELIEF, colorMatch: 1 } });
    const at = (r: { layerField: Uint16Array }, x: number) => r.layerField[10 * w + x];
    expect(Math.abs(at(luma, 5) - at(luma, 35))).toBeLessThanOrEqual(1);
    expect(at(color, 5)).not.toBe(at(color, 35));
    const px = (r: { printedRgba: Uint8ClampedArray }, x: number) => Array.from(r.printedRgba.slice((10 * w + x) * 4, (10 * w + x) * 4 + 3));
    const [rr, , rb] = px(color, 5);
    const [br, , bb] = px(color, 35);
    expect(rr).toBeGreaterThan(rb);
    expect(bb).toBeGreaterThan(br);
  });

  it('auto-tune in colour mode reports a lower colour error than luma mode', () => {
    const w = 40, h = 20;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set(i % w < w / 2 ? [200, 20, 30, 255] : [20, 60, 175, 255], i * 4);
    const st = [entry('k', 0, '#101010', 0.5), entry('b', 4, '#1f3fb0', 0.8), entry('r', 9, '#c81e28', 0.8)];
    const core = new EngineCore();
    core.setImage({ width: w, height: h, rgba });
    const p = { relief: DEFAULT_RELIEF, print, stack: st, simulateLineWidth: false };
    const luma = core.autoTune({ ...p, options: { reorder: true, tone: true } });
    const color = core.autoTune({ ...p, options: { reorder: true, tone: false, colorMatch: 0.95 } });
    expect(color.relief.colorMatch).toBe(0.95);
    expect(color.errorAfter).toBeLessThan(luma.errorAfter);
  });

  it('brightness and gamma still move the heights in colour mode', () => {
    // Horizontal grey ramp: the colour match follows it, the tone should shift it.
    const w = 64, h = 8;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const v = Math.round(((i % w) / (w - 1)) * 255);
      rgba.set([v, v, v, 255], i * 4);
    }
    const st = [entry('k', 0, '#101010', 0.5), entry('w', 4, '#f0f0f0', 1.5)];
    const core = new EngineCore();
    core.setImage({ width: w, height: h, rgba });
    const base = { relief: { ...DEFAULT_RELIEF, colorMatch: 0.95 }, print, stack: st, maxEdge: 64, simulateLineWidth: false };
    const sum = (r: { layerField: Uint16Array }) => r.layerField.reduce((a, b) => a + b, 0);
    const plain = sum(core.preview(base));
    const bright = sum(core.preview({ ...base, relief: { ...base.relief, brightness: 0.25 } }));
    const dark = sum(core.preview({ ...base, relief: { ...base.relief, gamma: 2 } }));
    expect(bright).toBeGreaterThan(plain * 1.05);
    expect(dark).toBeLessThan(plain * 0.95);
  });
});
