import { describe, expect, it } from 'vitest';
import { buildTerracedSolidMesh, checkWatertight, signedVolume, type MeshData, type TerracedSolidInput } from './index.js';

const build = (input: TerracedSolidInput): MeshData => buildTerracedSolidMesh(input) as MeshData;

const zOf = (n: number) => (n === 0 ? 0 : 0.2 + (n - 1) * 0.08);
const zTable = (max: number) => Float32Array.from({ length: max + 2 }, (_, n) => zOf(n));

/** Count interpolated on the heightfield's triangulation (cells split along the a–d diagonal). */
function plValue(field: Uint16Array, w: number, h: number, gx: number, gy: number): number {
  const x = Math.min(w - 2, Math.floor(gx));
  const y = Math.min(h - 2, Math.floor(gy));
  const fx = gx - x;
  const fy = gy - y;
  const v = (i: number, j: number) => field[(y + j) * w + x + i];
  // Upper-right triangle (a, b, d) when fx >= fy, else (a, d, c).
  return fx >= fy ? v(0, 0) + fx * (v(1, 0) - v(0, 0)) + fy * (v(1, 1) - v(1, 0)) : v(0, 0) + fy * (v(0, 1) - v(0, 0)) + fx * (v(1, 1) - v(0, 1));
}

/** z of the upward-facing triangle above (x, y), or NaN. */
function topZ(mesh: MeshData, x: number, y: number): number {
  const p = mesh.positions;
  let best = NaN;
  for (let t = 0; t < mesh.triangleCount; t++) {
    const a = mesh.indices[t * 3] * 3, b = mesh.indices[t * 3 + 1] * 3, c = mesh.indices[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1];
    const det = ux * vy - uy * vx;
    if (det <= 1e-12) continue; // not facing up
    const qx = x - p[a], qy = y - p[a + 1];
    const s = (qx * vy - qy * vx) / det;
    const r = (ux * qy - uy * qx) / det;
    if (s < 0 || r < 0 || s + r > 1) continue;
    const z = p[a + 2] + s * (p[b + 2] - p[a + 2]) + r * (p[c + 2] - p[a + 2]);
    if (!(z <= best)) best = z;
  }
  return best;
}

function randomField(w: number, h: number, seed: number, levels: number, smooth: boolean): Uint16Array {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const f = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      f[y * w + x] = smooth
        ? 3 + Math.round((levels / 2) * (1 + Math.sin(x / 3 + rnd() * 0.3) * Math.cos(y / 4)))
        : 3 + Math.floor(rnd() * levels);
    }
  }
  return f;
}

describe('buildTerracedSolidMesh', () => {
  it.each([
    [2, 2, 1, 2, false],
    [5, 4, 2, 3, false],
    [9, 7, 3, 4, false],
    [16, 11, 4, 6, true],
    [23, 17, 5, 8, true],
    [12, 30, 6, 2, false],
    [40, 25, 7, 10, true],
  ])('%i×%i (seed %i) is watertight and slices like the heightfield', (w, h, seed, levels, smooth) => {
    const field = randomField(w, h, seed, levels, smooth);
    const mesh = build({ field, width: w, height: h, widthMm: w - 1, heightMm: h - 1, zOfCount: zTable(3 + levels + 1) });
    expect(checkWatertight(mesh)).toEqual({ ok: true, badEdges: 0 });
    expect(signedVolume(mesh)).toBeGreaterThan(0);
    // Grid units = mm here. Probe points; the terrace height must be the layer whose
    // mid-plane band contains the heightfield value.
    let s = seed * 7 + 1;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 200; k++) {
      const x = rnd() * (w - 1);
      const y = rnd() * (h - 1);
      const v = plValue(field, w, h, x, h - 1 - y);
      const z = topZ(mesh, x, y);
      const n = Math.round((z - 0.2) / 0.08) + 1;
      expect(Math.abs(v - n)).toBeLessThanOrEqual(0.5 + 1e-6);
    }
  });

  it('gives up past maxTriangles', () => {
    const w = 30;
    const h = 20;
    const field = randomField(w, h, 9, 6, false);
    const input = { field, width: w, height: h, widthMm: 3, heightMm: 2, zOfCount: zTable(10) };
    const full = build(input);
    expect(buildTerracedSolidMesh({ ...input, maxTriangles: full.triangleCount / 10 })).toBeNull();
    expect(buildTerracedSolidMesh({ ...input, maxTriangles: full.triangleCount * 10 })).not.toBeNull();
  });

  it('a flat field is a box', () => {
    const mesh = build({ field: new Uint16Array(20).fill(5), width: 5, height: 4, widthMm: 40, heightMm: 30, zOfCount: zTable(6) });
    expect(checkWatertight(mesh).ok).toBe(true);
    expect(signedVolume(mesh)).toBeCloseTo(40 * 30 * zOf(5), 3);
    expect(mesh.triangleCount).toBeLessThan(20);
  });
});

describe('buildTerracedSolidMesh layer ranges', () => {
  it.each([
    [9, 7, 3, 4, false],
    [16, 11, 4, 6, true],
    [23, 17, 5, 8, true],
    [30, 20, 9, 6, false],
  ])('%i×%i (seed %i): slabs cut at layer ranges are watertight and add up to the full solid', (w, h, seed, levels, smooth) => {
    const field = randomField(w, h, seed, levels, smooth);
    const input = { field, width: w, height: h, widthMm: w - 1, heightMm: h - 1, zOfCount: zTable(3 + levels + 1) };
    const full = signedVolume(build(input));
    const cuts = [0, 4, 3 + Math.ceil(levels / 2), 0xffff];
    let sum = 0;
    for (let i = 0; i + 1 < cuts.length; i++) {
      const mesh = build({ ...input, minCount: cuts[i], maxCount: cuts[i + 1] });
      expect(checkWatertight(mesh)).toEqual({ ok: true, badEdges: 0 });
      const v = signedVolume(mesh);
      expect(v).toBeGreaterThan(0);
      sum += v;
    }
    expect(sum).toBeCloseTo(full, 3);
  });

  it('samples with no layers leave holes, and the complement fills them', () => {
    const w = 24;
    const h = 18;
    const levels = 7;
    const field = randomField(w, h, 11, levels, true);
    const top = 3 + levels;
    const inverse = field.map((n) => top - n);
    const zOfCount = zTable(top + 1);
    const input = { width: w, height: h, widthMm: w - 1, heightMm: h - 1, zOfCount };
    const a = build({ ...input, field });
    const b = build({ ...input, field: inverse });
    expect(inverse.some((n) => n === 0)).toBe(true);
    expect(checkWatertight(b)).toEqual({ ok: true, badEdges: 0 });
    expect(signedVolume(a)).toBeGreaterThan(0);
    expect(signedVolume(b)).toBeGreaterThan(0);
  });

  it('rejects a range with no material', () => {
    const field = new Uint16Array(20).fill(5);
    expect(() => build({ field, width: 5, height: 4, widthMm: 4, heightMm: 3, zOfCount: zTable(6), minCount: 5 })).toThrow();
  });
});
