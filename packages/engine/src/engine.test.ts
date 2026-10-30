import { describe, expect, it } from 'vitest';
import { readArchiveText } from '@huecraft/exporters';
import {
  DEFAULT_PRINT,
  DEFAULT_RELIEF,
  layerTopZ,
  totalLayerCount,
  type PrintParams,
  type StackEntry,
} from '@huecraft/project-schema';
import { checkWatertight, signedVolume } from '@huecraft/mesh';
import { paintTargetLayer, resolvePaintLayers } from './index.js';
import type { PaintStroke } from '@huecraft/project-schema';
import { autoDistributeStack, computeSwaps, EngineCore, formatSwapPlan, normalizeStack, runExport, runPreview } from './index.js';
import { LatestWinsQueue, isAbortError } from './scheduler.js';
import type { PreviewParams, SourceImage } from './protocol.js';

function gradient(width: number, height: number): SourceImage {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const v = Math.round((x / Math.max(1, width - 1)) * 255);
      rgba[o] = rgba[o + 1] = rgba[o + 2] = v;
      rgba[o + 3] = 255;
    }
  }
  return { width, height, rgba };
}

const print: PrintParams = { ...DEFAULT_PRINT, widthMm: 40, maxHeightMm: 1.6, baseThicknessMm: 0.48 };

function entry(slotId: string, startLayer: number, colorHex: string, tdMm = 1, name = slotId): StackEntry {
  return { slotId, startLayer, filament: { name, brand: 'Test', colorHex, tdMm } };
}

const stack: StackEntry[] = [entry('a', 0, '#000000', 0.5), entry('b', 8, '#ff0000', 2), entry('c', 12, '#ffffff', 5)];

function previewParams(over: Partial<PreviewParams> = {}): PreviewParams {
  return { relief: DEFAULT_RELIEF, print, stack, maxEdge: 64, simulateLineWidth: false, ...over };
}

describe('brush paint', () => {
  const image = gradient(120, 80);
  const dot = (over: Partial<PaintStroke> = {}): PaintStroke => ({
    id: 's1',
    mode: 'paint',
    slotId: 'b',
    layer: 12,
    radius: 0.1,
    softness: 0,
    opacity: 1,
    points: [0.25, 0.5],
    ...over,
  });
  const at = (r: { width: number; height: number; layerField: Uint16Array }, u: number, v: number) =>
    r.layerField[Math.floor(v * r.height) * r.width + Math.floor(u * r.width)];

  it('targets the top of the filament band and follows swaps', () => {
    expect(paintTargetLayer(stack, 'a', 20)).toBe(8);
    expect(paintTargetLayer(stack, 'b', 20)).toBe(12);
    expect(paintTargetLayer(stack, 'c', 20)).toBe(20);
    expect(paintTargetLayer(stack, 'gone', 20)).toBeNull();
    const moved = stack.map((e) => (e.slotId === 'c' ? { ...e, startLayer: 15 } : e));
    expect(resolvePaintLayers([dot()], moved, 20)[0].layer).toBe(15);
  });

  it('raises a full-opacity dab exactly to the target layer, leaving the rest alone', () => {
    const plain = runPreview(image, previewParams());
    const r = runPreview(image, previewParams({ paint: [dot()] }));
    expect(at(r, 0.25, 0.5)).toBe(12);
    expect(at(r, 0.9, 0.5)).toBe(at(plain, 0.9, 0.5));
  });

  it('blends with partial opacity and erasing restores the relief', () => {
    const plain = runPreview(image, previewParams());
    const half = runPreview(image, previewParams({ paint: [dot({ layer: totalLayerCount(print), opacity: 0.5, points: [0.1, 0.5] })] }));
    const before = at(plain, 0.1, 0.5);
    const mid = at(half, 0.1, 0.5);
    expect(mid).toBeGreaterThan(before);
    expect(mid).toBeLessThan(totalLayerCount(print));
    const erased = runPreview(image, previewParams({ paint: [dot(), dot({ id: 's2', mode: 'erase', radius: 0.2 })] }));
    expect(Array.from(erased.layerField)).toEqual(Array.from(plain.layerField));
  });

  it('raise / lower blends only touch columns on the other side of the target', () => {
    const plain = runPreview(image, previewParams());
    const wide = { radius: 2, points: [0.5, 0.5] };
    const raised = runPreview(image, previewParams({ paint: [dot({ ...wide, blend: 'raise' })] }));
    const lowered = runPreview(image, previewParams({ paint: [dot({ ...wide, blend: 'lower' })] }));
    for (let i = 0; i < plain.layerField.length; i++) {
      expect(raised.layerField[i]).toBe(Math.max(plain.layerField[i], 12));
      expect(lowered.layerField[i]).toBe(Math.min(plain.layerField[i], 12));
    }
  });

  it('colour blends only paint lighter, darker or sampled colours', () => {
    const plain = runPreview(image, previewParams());
    const lut = plain.printedLut;
    const lum = (n: number) => 0.2126 * lut[n * 3] + 0.7152 * lut[n * 3 + 1] + 0.0722 * lut[n * 3 + 2];
    const wide = { radius: 2, points: [0.5, 0.5] };
    // Brush colour = layer 12 (band of 'b').
    const onLight = runPreview(image, previewParams({ paint: [dot({ ...wide, blend: 'onLight' })] }));
    const onDark = runPreview(image, previewParams({ paint: [dot({ ...wide, blend: 'onDark' })] }));
    for (let i = 0; i < plain.layerField.length; i++) {
      const n = plain.layerField[i];
      expect(onLight.layerField[i]).toBe(lum(n) > lum(12) ? 12 : n);
      expect(onDark.layerField[i]).toBe(lum(n) < lum(12) ? 12 : n);
    }
    // Tolerance on onLight: only colours at least that much lighter than the brush.
    const margin = runPreview(image, previewParams({ paint: [dot({ ...wide, blend: 'onLight', tolerance: 0.2 })] }));
    for (let i = 0; i < plain.layerField.length; i++) {
      const n = plain.layerField[i];
      expect(margin.layerField[i]).toBe(lum(n) - lum(12) > 0.2 * 255 ? 12 : n);
    }
    // Sampled with zero tolerance: only columns with exactly the sampled colour change.
    const sampled = runPreview(image, previewParams({ paint: [dot({ ...wide, layer: 19, blend: 'sampled', sampleLayer: 6, tolerance: 0 })] }));
    for (let i = 0; i < plain.layerField.length; i++) {
      const n = plain.layerField[i];
      const same = lut[n * 3] === lut[18] && lut[n * 3 + 1] === lut[19] && lut[n * 3 + 2] === lut[20];
      expect(sampled.layerField[i]).toBe(same ? 19 : n);
    }
    expect(Array.from(sampled.layerField)).not.toEqual(Array.from(plain.layerField));
  });

  it('cached incremental painting matches a fresh run', () => {
    const core = new EngineCore();
    core.setImage(image);
    const a = dot({ points: [0.2, 0.2, 0.6, 0.6] });
    const b = dot({ id: 's2', slotId: 'c', layer: 20, points: [0.6, 0.2, 0.2, 0.6] });
    core.preview(previewParams({ paint: [a] }));
    core.preview(previewParams({ paint: [a, { ...b, points: b.points.slice(0, 2) }] }));
    const cached = core.preview(previewParams({ paint: [a, b] }));
    const fresh = runPreview(image, previewParams({ paint: [a, b] }));
    expect(Array.from(cached.layerField)).toEqual(Array.from(fresh.layerField));
  });

  it('exports the painted heights', () => {
    const r = runExport(image, { name: 'p', relief: DEFAULT_RELIEF, print, stack, swapCommand: 'pause', format: 'stl', paint: [dot()] });
    const plain = runExport(image, { name: 'p', relief: DEFAULT_RELIEF, print, stack, swapCommand: 'pause', format: 'stl' });
    expect(r.bytes).not.toEqual(plain.bytes);
  });
});

describe('preview', () => {
  const image = gradient(120, 80);

  it('counts layers with the first layer and mid-plane rule', () => {
    const r = runPreview(image, previewParams());
    expect(r.totalLayers).toBe(totalLayerCount(print));
    expect(r.baseLayers).toBe(5); // 0.16 + 4 × 0.08 = 0.48
    expect(r.layerField[0]).toBe(5); // black → base only
    expect(r.layerField[r.width - 1]).toBe(r.totalLayers); // white → full height
    expect(r.layerHistogram.length).toBe(r.totalLayers + 1);
    expect(r.layerHistogram.reduce((a, b) => a + b, 0)).toBe(r.width * r.height);
    expect(r.sizeMm.z).toBeCloseTo(layerTopZ(print, r.totalLayers - 1), 5);
  });

  it('applies the stack globally: same layer count → same colour everywhere', () => {
    const r = runPreview(image, previewParams());
    const byCount = new Map<number, string>();
    for (let i = 0; i < r.layerField.length; i++) {
      const key = Array.from(r.slicerRgba.subarray(i * 4, i * 4 + 3)).join(',');
      const prev = byCount.get(r.layerField[i]);
      if (prev) expect(prev).toBe(key);
      byCount.set(r.layerField[i], key);
    }
    // Columns whose top layer is >= 8 show the red filament (layer 8 → n = 9..12).
    expect(Array.from(r.slicerLut.subarray(9 * 3, 9 * 3 + 3))).toEqual([255, 0, 0]);
    expect(Array.from(r.slicerLut.subarray(8 * 3, 8 * 3 + 3))).toEqual([0, 0, 0]);
    expect(Array.from(r.slicerLut.subarray(13 * 3, 13 * 3 + 3))).toEqual([255, 255, 255]);
    // Moving the swap changes the colour of every column at that layer count.
    const moved = runPreview(image, previewParams({ stack: [stack[0], { ...stack[1], startLayer: 6 }, stack[2]] }));
    expect(Array.from(moved.slicerLut.subarray(7 * 3, 7 * 3 + 3))).toEqual([255, 0, 0]);
  });

  it('reports swaps with slicer numbering and Z', () => {
    const r = runPreview(image, previewParams());
    expect(r.swaps).toEqual([
      { layer: 8, slicerLayer: 9, topZMm: 0.8, pauseAtZMm: 0.72, slotId: 'b', filamentName: 'b', colorHex: '#ff0000' },
      { layer: 12, slicerLayer: 13, topZMm: 1.12, pauseAtZMm: 1.04, slotId: 'c', filamentName: 'c', colorHex: '#ffffff' },
    ]);
    const beyond = runPreview(image, previewParams({ stack: [stack[0], { ...stack[1], startLayer: 500 }] }));
    expect(beyond.swaps).toEqual([]);
  });

  it('physical size does not depend on preview resolution', () => {
    const a = runPreview(image, previewParams({ maxEdge: 32 }));
    const b = runPreview(image, previewParams({ maxEdge: 120 }));
    expect(a.width).toBe(32);
    expect(b.width).toBe(120);
    expect(a.sizeMm).toEqual(b.sizeMm);
    expect(a.sizeMm.width).toBe(40);
    expect(a.sizeMm.height).toBeCloseTo((40 * 80) / 120, 6);
    for (const r of [a, b]) {
      let maxX = 0;
      let maxY = 0;
      for (let i = 0; i < r.mesh.positions.length; i += 3) {
        maxX = Math.max(maxX, r.mesh.positions[i]);
        maxY = Math.max(maxY, r.mesh.positions[i + 1]);
      }
      expect(maxX).toBeCloseTo(40, 4);
      expect(maxY).toBeCloseTo(r.sizeMm.height, 4);
    }
  });

  it('line-width simulation removes sub-line detail and is a no-op at coarse pitch', () => {
    const noisy: SourceImage = gradient(200, 200);
    for (let i = 0; i < 200 * 200; i++) {
      const v = (i + Math.floor(i / 200)) % 2 ? 255 : 0;
      noisy.rgba[i * 4] = noisy.rgba[i * 4 + 1] = noisy.rgba[i * 4 + 2] = v;
    }
    const fine = { ...print, widthMm: 20 }; // pitch 0.1 mm < 0.42 mm line
    const off = runPreview(noisy, previewParams({ print: fine, maxEdge: 200 }));
    const on = runPreview(noisy, previewParams({ print: fine, maxEdge: 200, simulateLineWidth: true }));
    const distinct = (f: Uint16Array) => new Set(f).size;
    expect(distinct(off.layerField)).toBe(2);
    expect(on.mesh.triangleCount).toBeLessThan(off.mesh.triangleCount);
    expect(Array.from(on.layerHistogram)).toEqual(Array.from(off.layerHistogram));
    const coarse = { ...print, widthMm: 200 }; // pitch 1 mm ≥ line width
    const a = runPreview(noisy, previewParams({ print: coarse, maxEdge: 200 }));
    const b = runPreview(noisy, previewParams({ print: coarse, maxEdge: 200, simulateLineWidth: true }));
    expect(Array.from(b.layerField)).toEqual(Array.from(a.layerField));
  });

  it('caches the resize and relief between stack edits', () => {
    const core = new EngineCore();
    core.setImage(gradient(800, 600));
    core.preview(previewParams({ maxEdge: 400 }));
    const second = core.preview(previewParams({ maxEdge: 400, stack: [stack[0]] }));
    expect(second.timings.resizeMs + second.timings.reliefMs).toBeLessThan(5);
  });
});

describe('export', () => {
  const image = gradient(9, 7); // odd sizes

  it.each([true, false])('builds a watertight mesh (snapToLayers=%s)', (snapToLayers) => {
    const p = { ...print, widthMm: 9, exportResolutionMm: 1, snapToLayers };
    const r = runExport(image, { name: 'odd', relief: DEFAULT_RELIEF, print: p, stack, swapCommand: 'pause', format: 'stl' });
    const view = new DataView(r.bytes.buffer, r.bytes.byteOffset, r.bytes.byteLength);
    expect(view.getUint32(80, true)).toBe(r.triangleCount);
    expect(r.fileName).toBe('odd.stl');
    // Rebuild the indexed mesh the same way to check topology.
    const core = new EngineCore();
    core.setImage(image);
    const res3mf = core.export({ name: 'odd', relief: DEFAULT_RELIEF, print: p, stack, swapCommand: 'pause', format: '3mf' });
    const model = readArchiveText(res3mf.bytes)['3D/3dmodel.model'];
    const verts = [...model.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)].map((m) => [+m[1], +m[2], +m[3]]);
    const tris = [...model.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g)].map((m) => [+m[1], +m[2], +m[3]]);
    const mesh = { positions: new Float32Array(verts.flat()), indices: new Uint32Array(tris.flat()), triangleCount: tris.length };
    expect(checkWatertight(mesh).ok).toBe(true);
    expect(signedVolume(mesh)).toBeGreaterThan(0);
    const tops = verts.slice(0, 9 * 7).map((v) => v[2]);
    if (snapToLayers) {
      for (const z of tops) {
        const k = Math.round((z - p.firstLayerHeightMm) / p.layerHeightMm);
        expect(z).toBeCloseTo(layerTopZ(p, k), 3);
      }
    }
    expect(Math.min(...tops)).toBeGreaterThanOrEqual(p.baseThicknessMm - 1e-4);
  });

  it('writes the swaps into the 3MF at the layer tops', () => {
    const r = runExport(gradient(40, 40), { name: 'Grad', relief: DEFAULT_RELIEF, print, stack, swapCommand: 'pause', format: '3mf' });
    expect(r.fileName).toBe('Grad.3mf');
    expect(r.mimeType).toBe('model/3mf');
    const files = readArchiveText(r.bytes);
    const xml = files['Metadata/custom_gcode_per_layer.xml'];
    expect(xml).toContain('top_z="0.8" type="1"');
    expect(xml).toContain('top_z="1.12" type="1"');
    expect(files['Metadata/hueCraft_swap_plan.txt']).toBe(r.swapText);
    expect(r.swapText).toContain('Layer 9 (Z 0.800 mm) → pause, load "b" #ff0000');
    expect(r.swapText).toContain('total layers: 19');
  });

  it('export grid follows exportResolutionMm, not the preview', () => {
    const r = runExport(gradient(300, 150), { name: 'g', relief: DEFAULT_RELIEF, print: { ...print, widthMm: 20, exportResolutionMm: 0.1 }, stack, swapCommand: 'pause', format: 'stl' });
    expect(r.timings.gridWidth).toBe(200);
    expect(r.timings.gridHeight).toBe(100);
  });
});

describe('stack helpers', () => {
  it('normalizes order and forces entry 0 to layer 0', () => {
    const s = normalizeStack([entry('x', 9, '#111111'), entry('y', 3, '#222222')]);
    expect(s.map((e) => [e.slotId, e.startLayer])).toEqual([['y', 0], ['x', 9]]);
  });

  it('skips shadowed swaps', () => {
    const s = normalizeStack([entry('a', 0, '#000000'), entry('b', 5, '#111111'), entry('c', 5, '#222222')]);
    expect(computeSwaps(s, print, 20).map((w) => w.slotId)).toEqual(['c']);
  });

  it('autoDistributeStack spreads by pixel quantiles, strictly increasing', () => {
    const hist = new Uint32Array(21);
    hist[5] = 1000; // base only, ignored
    for (let n = 6; n <= 20; n++) hist[n] = 10;
    hist[20] = 160; // most relief pixels at full height
    const input = [entry('a', 0, '#000'), entry('b', 0, '#111'), entry('c', 0, '#222'), entry('d', 0, '#333')];
    const out = autoDistributeStack(input, hist, 5, 20);
    expect(out.map((e) => e.slotId)).toEqual(['a', 'b', 'c', 'd']);
    expect(out[0].startLayer).toBe(0);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].startLayer).toBeGreaterThan(out[i - 1].startLayer);
      expect(out[i].startLayer).toBeGreaterThanOrEqual(5);
      expect(out[i].startLayer).toBeLessThan(20);
    }
    // 300 relief px: 140 spread over 6..19, 160 at 20 → the first quarter (75 px) is reached at n = 13.
    expect(out[1].startLayer).toBe(13);
  });

  it('autoDistributeStack stays valid when there are more filaments than layers', () => {
    const hist = new Uint32Array(8);
    hist[7] = 5;
    const out = autoDistributeStack([0, 1, 2, 3, 4].map((i) => entry(String(i), 0, '#000')), hist, 3, 7);
    for (const e of out.slice(1)) {
      expect(e.startLayer).toBeGreaterThanOrEqual(3);
      expect(e.startLayer).toBeLessThan(7);
    }
  });

  it('formats a swap plan', () => {
    const s = normalizeStack(stack);
    const text = formatSwapPlan({
      name: 'X',
      print,
      stack: s,
      swaps: computeSwaps(s, print, 19),
      swapCommand: 'color-change',
      totalLayers: 19,
      baseLayers: 5,
      sizeMm: { width: 40, height: 20, z: 1.6 },
    });
    expect(text).toContain('Layer 1 (Z 0.160 mm) → start with "a" #000000');
    expect(text).toContain('Layer 13 (Z 1.120 mm) → colour change to "c" #ffffff');
  });
});

describe('LatestWinsQueue', () => {
  it('runs one job at a time and keeps only the newest pending request', async () => {
    const started: number[] = [];
    const gates: Array<() => void> = [];
    const q = new LatestWinsQueue<number, number>(
      (n) =>
        new Promise<number>((resolve) => {
          started.push(n);
          gates.push(() => resolve(n * 10));
        }),
    );
    const p1 = q.request(1);
    const p2 = q.request(2);
    const p3 = q.request(3);
    const r2 = p2.catch((e) => e);
    expect(started).toEqual([1]);
    gates[0]();
    expect(await p1).toBe(10);
    const err = await r2;
    expect(isAbortError(err)).toBe(true);
    expect((err as Error).name).toBe('AbortError');
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual([1, 3]);
    gates[1]();
    expect(await p3).toBe(30);
  });

  it('propagates errors and keeps working', async () => {
    let fail = true;
    const q = new LatestWinsQueue<number, number>(async (n) => {
      if (fail) throw new Error('boom');
      return n;
    });
    await expect(q.request(1)).rejects.toThrow('boom');
    fail = false;
    await expect(q.request(2)).resolves.toBe(2);
  });
});
