import { describe, expect, it } from 'vitest';
import { buildToolpaths, PathKind, type ToolpathInput } from './toolpath';

function input(field: Uint16Array, w: number, h: number, sizeMm: number, totalLayers: number, extra: Partial<ToolpathInput> = {}): ToolpathInput {
  const layerTopZ = new Float32Array(totalLayers).map((_, k) => 0.2 + k * 0.1);
  const layerHeight = new Float32Array(totalLayers).map((_, k) => (k === 0 ? 0.2 : 0.1));
  return { field, width: w, height: h, widthMm: sizeMm, heightMm: (sizeMm * h) / w, totalLayers, lineWidthMm: 0.4, layerTopZ, layerHeight, ...extra };
}

const lengthOf = (t: ReturnType<typeof buildToolpaths>, pick: (i: number) => boolean) => {
  let sum = 0;
  for (let i = 0; i < t.count; i++) {
    if (!pick(i)) continue;
    const s = t.segments;
    sum += Math.hypot(s[i * 4 + 2] - s[i * 4], s[i * 4 + 3] - s[i * 4 + 1]);
  }
  return sum;
};

describe('buildToolpaths', () => {
  // 20 × 20 mm square, 100 × 100 px, 3 layers everywhere.
  const w = 100;
  const square = new Uint16Array(w * w).fill(3);

  it('puts the outer wall half a line width inside the outline', () => {
    const t = buildToolpaths(input(square, w, w, 20, 3));
    expect(t.layerStart[3]).toBe(t.count);
    const side = 20 - 0.4;
    const outer = lengthOf(t, (i) => t.layer[i] === 0 && t.kind[i] === PathKind.OuterWall);
    // Square loop with slightly rounded corners.
    expect(outer).toBeGreaterThan(side * 4 * 0.97);
    expect(outer).toBeLessThan(side * 4 * 1.01);
    for (let i = 0; i < t.count; i++) {
      for (const v of [t.segments[i * 4], t.segments[i * 4 + 1], t.segments[i * 4 + 2], t.segments[i * 4 + 3]]) {
        expect(v).toBeGreaterThan(0.1);
        expect(v).toBeLessThan(19.9);
      }
    }
  });

  it('fills solid layers about one line per line width', () => {
    const t = buildToolpaths(input(square, w, w, 20, 3));
    const infill = lengthOf(t, (i) => t.layer[i] === 1 && t.kind[i] === PathKind.SolidInfill);
    const inner = 20 - 2 * 2 * 0.4; // inside two perimeters
    expect(infill).toBeGreaterThan((inner * inner) / 0.4 * 0.9);
    expect(infill).toBeLessThan((inner * inner) / 0.4 * 1.15);
  });

  it('alternates ±45° and uses sparse infill in the middle of tall columns', () => {
    const t = buildToolpaths(input(new Uint16Array(w * w).fill(12), w, w, 20, 12));
    const dir = (i: number) => Math.sign((t.segments[i * 4 + 2] - t.segments[i * 4]) * (t.segments[i * 4 + 3] - t.segments[i * 4 + 1]));
    const firstInfill = (k: number) => {
      for (let i = t.layerStart[k]; i < t.layerStart[k + 1]; i++) if (t.kind[i] >= PathKind.SolidInfill) return i;
      return -1;
    };
    expect(dir(firstInfill(0))).toBe(-dir(firstInfill(1)));
    const kinds5 = new Set(Array.from(t.kind.subarray(t.layerStart[5], t.layerStart[6])));
    expect(kinds5.has(PathKind.SparseInfill)).toBe(true);
    expect(kinds5.has(PathKind.SolidInfill)).toBe(false);
    const kinds11 = new Set(Array.from(t.kind.subarray(t.layerStart[11], t.layerStart[12])));
    expect(kinds11.has(PathKind.SolidInfill)).toBe(true);
    expect(lengthOf(t, (i) => t.layer[i] === 5 && t.kind[i] === PathKind.SparseInfill)).toBeLessThan(
      lengthOf(t, (i) => t.layer[i] === 11 && t.kind[i] === PathKind.SolidInfill) * 0.25,
    );
  });

  it('follows terraces: upper layers only cover the taller area', () => {
    const f = new Uint16Array(w * w).fill(2);
    for (let y = 0; y < w; y++) for (let x = 0; x < 50; x++) f[y * w + x] = 4;
    const t = buildToolpaths(input(f, w, w, 20, 4));
    for (let i = t.layerStart[2]; i < t.count; i++) {
      expect(t.segments[i * 4]).toBeLessThan(10);
      expect(t.segments[i * 4 + 2]).toBeLessThan(10);
    }
    expect(t.layerStart[2]).toBeGreaterThan(0);
    expect(t.count).toBeGreaterThan(t.layerStart[2]);
  });

  it('keeps a ring as two walls loops (outer + hole)', () => {
    const f = new Uint16Array(w * w).fill(1);
    for (let y = 30; y < 70; y++) for (let x = 30; x < 70; x++) f[y * w + x] = 0;
    const t = buildToolpaths(input(f, w, w, 20, 1, { perimeters: 1 }));
    const outer = lengthOf(t, (i) => t.kind[i] === PathKind.OuterWall);
    expect(outer).toBeGreaterThan((19.6 + 8.4) * 4 * 0.97);
    expect(outer).toBeLessThan((19.6 + 8.4) * 4 * 1.02);
  });
});
