import { describe, expect, it } from 'vitest';
import { buildSolidHeightfieldMesh, buildTerracedMesh, checkWatertight, signedVolume, type MeshData } from './index.js';

describe('buildSolidHeightfieldMesh', () => {
  it.each([
    [2, 2],
    [5, 3],
    [7, 9],
  ])('is watertight with outward normals for %i×%i', (w, h) => {
    const heights = new Float32Array(w * h);
    for (let i = 0; i < heights.length; i++) heights[i] = 1 + ((i * 7) % 5) * 0.1;
    const mesh = buildSolidHeightfieldMesh({ heights, width: w, height: h, widthMm: 10, heightMm: 6 });
    expect(checkWatertight(mesh)).toEqual({ ok: true, badEdges: 0 });
    expect(mesh.indices.length).toBe(mesh.triangleCount * 3);
    expect(signedVolume(mesh)).toBeGreaterThan(0);
  });

  it('a flat top gives the exact box volume and extent', () => {
    const mesh = buildSolidHeightfieldMesh({ heights: new Float32Array(12).fill(2), width: 4, height: 3, widthMm: 30, heightMm: 20 });
    expect(signedVolume(mesh)).toBeCloseTo(30 * 20 * 2, 3);
    let maxX = 0;
    let maxY = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      maxX = Math.max(maxX, mesh.positions[i]);
      maxY = Math.max(maxY, mesh.positions[i + 1]);
    }
    expect(maxX).toBeCloseTo(30, 5);
    expect(maxY).toBeCloseTo(20, 5);
  });

  /** z of the top surface at every grid sample, found by locating it in the top triangles. */
  function sampleTop(mesh: MeshData, w: number, h: number, widthMm: number, heightMm: number): Float32Array {
    const out = new Float32Array(w * h).fill(NaN);
    const p = mesh.positions;
    for (let t = 0; t < mesh.triangleCount; t++) {
      const [a, b, c] = [0, 1, 2].map((k) => mesh.indices[t * 3 + k] * 3);
      if (p[a + 2] === 0 && p[b + 2] === 0 && p[c + 2] === 0) continue; // bottom
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1];
      const det = ux * vy - uy * vx;
      if (Math.abs(det) < 1e-12) continue; // vertical wall
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const qx = (x * widthMm) / (w - 1) - p[a];
          const qy = ((h - 1 - y) * heightMm) / (h - 1) - p[a + 1];
          const s = (qx * vy - qy * vx) / det;
          const r = (ux * qy - uy * qx) / det;
          if (s < -1e-6 || r < -1e-6 || s + r > 1 + 1e-6) continue;
          out[y * w + x] = p[a + 2] + s * (p[b + 2] - p[a + 2]) + r * (p[c + 2] - p[a + 2]);
        }
      }
    }
    return out;
  }

  it.each([
    [9, 7],
    [17, 17],
    [23, 11],
    [4, 30],
  ])('keeps every sample of a terraced %i×%i field exactly on the surface', (w, h) => {
    const heights = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) heights[y * w + x] = 0.6 + 0.08 * Math.round(3 + 3 * Math.sin(x / 3) * Math.cos(y / 4));
    }
    const mesh = buildSolidHeightfieldMesh({ heights, width: w, height: h, widthMm: 10, heightMm: 8 });
    expect(checkWatertight(mesh)).toEqual({ ok: true, badEdges: 0 });
    expect(signedVolume(mesh)).toBeGreaterThan(0);
    const top = sampleTop(mesh, w, h, 10, 8);
    for (let i = 0; i < heights.length; i++) expect(top[i]).toBeCloseTo(heights[i], 4);
  });

  it('a flat field collapses to a handful of triangles', () => {
    const w = 101;
    const h = 61;
    const mesh = buildSolidHeightfieldMesh({ heights: new Float32Array(w * h).fill(1.2), width: w, height: h, widthMm: 50, heightMm: 30 });
    expect(checkWatertight(mesh).ok).toBe(true);
    expect(signedVolume(mesh)).toBeCloseTo(50 * 30 * 1.2, 1);
    expect(mesh.triangleCount).toBeLessThan(2000); // a full grid would be 12 000 on top alone
  });

  it('maxErrorMm trades samples for triangles within the bound', () => {
    const w = 33;
    const h = 33;
    const heights = new Float32Array(w * h);
    for (let i = 0; i < heights.length; i++) heights[i] = 1 + 0.05 * Math.sin(i * 0.37);
    const exact = buildSolidHeightfieldMesh({ heights, width: w, height: h, widthMm: 10, heightMm: 10 });
    const loose = buildSolidHeightfieldMesh({ heights, width: w, height: h, widthMm: 10, heightMm: 10, maxErrorMm: 0.04 });
    expect(checkWatertight(loose).ok).toBe(true);
    expect(loose.triangleCount).toBeLessThan(exact.triangleCount);
    const top = sampleTop(loose, w, h, 10, 10);
    for (let i = 0; i < heights.length; i++) expect(Math.abs(top[i] - heights[i])).toBeLessThanOrEqual(0.04 + 1e-4);
  });

  it('puts the top image row at max y', () => {
    const heights = new Float32Array([5, 5, 1, 1]); // row 0 tall
    const mesh = buildSolidHeightfieldMesh({ heights, width: 2, height: 2, widthMm: 1, heightMm: 1 });
    expect(mesh.positions[1]).toBeCloseTo(1); // vertex 0 = row 0
    expect(mesh.positions[2]).toBe(5);
  });
});

describe('buildTerracedMesh', () => {
  const lut = new Uint8Array([0, 0, 0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
  const z = new Float32Array([0, 0.2, 0.28, 0.36]);

  it('merges equal runs and keeps every index in range', () => {
    const field = new Uint16Array([1, 1, 2, 3, 3, 3, 1, 1, 2]);
    const mesh = buildTerracedMesh({ field, width: 3, height: 3, widthMm: 3, heightMm: 3, zOfCount: z, printedLut: lut, slicerLut: lut });
    const vertexCount = mesh.positions.length / 3;
    expect(mesh.indices.length).toBe(mesh.triangleCount * 3);
    expect(mesh.printedColors.length).toBe(mesh.positions.length);
    expect(mesh.slicerColors.length).toBe(mesh.positions.length);
    for (const i of mesh.indices) expect(i).toBeLessThan(vertexCount);
    // Plateaus sit exactly at layer tops.
    const zs = new Set<number>();
    for (let i = 2; i < mesh.positions.length; i += 3) zs.add(Math.round(mesh.positions[i] * 1000) / 1000);
    expect([...zs].sort()).toEqual([0, 0.2, 0.28, 0.36]);
  });

  it('a uniform field is one plateau, four border walls and a bottom', () => {
    const field = new Uint16Array(16).fill(2);
    const mesh = buildTerracedMesh({ field, width: 4, height: 4, widthMm: 4, heightMm: 4, zOfCount: z, printedLut: lut, slicerLut: lut });
    // 4 plateau runs (one per row) + 8 left/right walls + 2 top/bottom walls + 1 bottom,
    // each wall cut into 2 bands (layers 1 and 2 differ in colour).
    expect(mesh.triangleCount).toBe((4 + 16 + 4 + 1) * 2);
    expect(mesh.printedColors[0]).toBeCloseTo(40 / 255);
  });

  it('walls show each layer in its own colour, not the top colour down to the bed', () => {
    const field = new Uint16Array([3, 1]);
    const mesh = buildTerracedMesh({ field, width: 2, height: 1, widthMm: 2, heightMm: 1, zOfCount: z, printedLut: lut, slicerLut: lut });
    // Every quad sits within one layer band and carries that layer's colour.
    for (let o = 0; o < mesh.positions.length; o += 12) {
      let zMax = 0;
      for (let v = o + 2; v < o + 12; v += 3) zMax = Math.max(zMax, mesh.positions[v]);
      if (zMax === 0) continue;
      const k = [...z].findIndex((zz) => Math.abs(zz - zMax) < 1e-6);
      expect(Math.round(mesh.slicerColors[o] * 255)).toBe(lut[k * 3]);
    }
    // The wall between counts 3 and 1 spans layers 2 and 3 as two bands.
    const wallBands = new Set<string>();
    for (let o = 0; o < mesh.positions.length; o += 12) {
      const xs = [0, 3, 6, 9].map((v) => mesh.positions[o + v]);
      if (xs.every((x) => x === 1)) wallBands.add(`${mesh.positions[o + 2]}-${mesh.positions[o + 8]}`);
    }
    expect(wallBands.size).toBe(2);
  });

  it('merges consecutive layers of the same colour into one wall band', () => {
    const flat = new Uint8Array([0, 0, 0, 10, 20, 30, 10, 20, 30, 10, 20, 30]);
    const field = new Uint16Array([3]);
    const mesh = buildTerracedMesh({ field, width: 1, height: 1, widthMm: 1, heightMm: 1, zOfCount: z, printedLut: flat, slicerLut: flat });
    // plateau + 4 single-band border walls + bottom
    expect(mesh.triangleCount).toBe(6 * 2);
  });
});
