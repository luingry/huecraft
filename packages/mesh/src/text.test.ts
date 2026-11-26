import { describe, expect, it } from 'vitest';
import { buildTextMesh, measureText, toFontText } from './text.js';
import { signedVolume } from './index.js';

describe('buildTextMesh', () => {
  it('normalises text to the font', () => {
    expect(toFontText('Camada 12 → Vermelho ção ~')).toBe('CAMADA 12 > VERMELHO CAO ?');
  });

  it('builds closed outward boxes inside the measured extent', () => {
    const lines = ['HUE 1', 'Z0.96'];
    const mesh = buildTextMesh(lines, { pixelMm: 0.5, depthMm: 1, x: 2, y: -3 });
    expect(mesh.triangleCount % 12).toBe(0);
    expect(mesh.triangleCount).toBeGreaterThan(0);
    // Each box is closed with outward normals: total volume = filled pixels × pixel area × depth.
    expect(signedVolume(mesh)).toBeGreaterThan(0);
    const { width, height } = measureText(lines, 0.5);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      expect(mesh.positions[i]).toBeGreaterThanOrEqual(2 - 1e-6);
      expect(mesh.positions[i]).toBeLessThanOrEqual(2 + width + 1e-6);
      expect(mesh.positions[i + 1]).toBeLessThanOrEqual(-3 + 1e-6);
      expect(mesh.positions[i + 1]).toBeGreaterThanOrEqual(-3 - height - 1e-6);
    }
  });

  it('volume equals filled pixels', () => {
    // "-" is one row of 5 pixels.
    const mesh = buildTextMesh(['-'], { pixelMm: 1, depthMm: 2, x: 0, y: 0 });
    expect(mesh.triangleCount).toBe(12);
    expect(signedVolume(mesh)).toBeCloseTo(10, 6);
  });
});
