import { describe, expect, it } from 'vitest';
import { buildSolidHeightfieldMesh, buildTerracedMesh, checkWatertight, signedVolume } from './index.js';

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
    // 4 plateau runs (one per row) + 8 left/right walls + 2 top/bottom walls + 1 bottom.
    expect(mesh.triangleCount).toBe((4 + 8 + 2 + 1) * 2);
    expect(mesh.printedColors[0]).toBeCloseTo(40 / 255);
  });
});
