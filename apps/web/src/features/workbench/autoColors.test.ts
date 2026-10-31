import { describe, expect, it } from 'vitest';
import { createFilamentFromHex, STARTER_FILAMENTS } from '@huecraft/filament-db';
import { dominantColors, pickAutoColors, readColorPresets } from './autoColors';

/** Image made of horizontal bands, `[hex, rows]` each, 10 px wide. */
function bands(spec: Array<[string, number]>, alpha = 255) {
  const width = 10;
  const height = spec.reduce((s, [, rows]) => s + rows, 0);
  const rgba = new Uint8ClampedArray(width * height * 4);
  let o = 0;
  for (const [hex, rows] of spec) {
    const n = parseInt(hex.slice(1), 16);
    for (let i = 0; i < rows * width; i++, o += 4) rgba.set([(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha], o);
  }
  return { width, height, rgba };
}

describe('dominantColors', () => {
  it('finds the four colours, most frequent first', () => {
    const img = bands([['#ff0000', 40], ['#0000ff', 30], ['#00ff00', 20], ['#ffffff', 10]]);
    const out = dominantColors(img, 4);
    expect(out.map((c) => c.hex)).toEqual(['#ff0000', '#0000ff', '#00ff00', '#ffffff']);
    expect(out[0].share).toBeCloseTo(0.4, 2);
  });

  it('returns fewer colours when the image has fewer', () => {
    expect(dominantColors(bands([['#123456', 5], ['#fedcba', 5]]), 4)).toHaveLength(2);
  });

  it('ignores transparent pixels', () => {
    expect(dominantColors(bands([['#ff0000', 5]], 0), 4)).toEqual([]);
  });
});

describe('pickAutoColors', () => {
  it('reuses a close library filament and creates the others', () => {
    const colors = dominantColors(bands([['#c22f20', 30], ['#3a7d44', 20]]), 4);
    const picks = pickAutoColors(colors, STARTER_FILAMENTS, false);
    const red = picks.find((p) => p.fromLibrary);
    expect(red?.filament.libraryId).toMatch(/red/);
    const green = picks.find((p) => !p.fromLibrary);
    expect(green?.filament.colorHex).toBe('#3a7d44');
    expect(green?.filament.libraryId).toBeUndefined();
  });

  it('orders dark to light, reversed when inverted', () => {
    const lib = [createFilamentFromHex('Black', '', '#000000', 0.6), createFilamentFromHex('White', '', '#ffffff', 4)];
    const colors = dominantColors(bands([['#ffffff', 10], ['#050505', 10]]), 4);
    expect(pickAutoColors(colors, lib, false).map((p) => p.filament.name)).toEqual(['Black', 'White']);
    expect(pickAutoColors(colors, lib, true).map((p) => p.filament.name)).toEqual(['White', 'Black']);
  });

  it('collapses colours matching the same filament', () => {
    const lib = [createFilamentFromHex('White', '', '#ffffff', 4)];
    const colors = dominantColors(bands([['#ffffff', 10], ['#f4f4f4', 10]]), 4);
    expect(pickAutoColors(colors, lib, false)).toHaveLength(1);
  });
});

describe('readColorPresets', () => {
  it('gives each preset its colour count, the simple one with fewer colours', () => {
    const img = bands([['#101010', 20], ['#c22f20', 20], ['#3a7d44', 20], ['#2050c0', 20], ['#e0c040', 10], ['#f0f0f0', 10]]);
    const out = readColorPresets(img, STARTER_FILAMENTS, false);
    const count = (id: string) => out.find((r) => r.preset.id === id)!.picks.length;
    expect(count('faithful')).toBe(6);
    expect(count('balanced')).toBeLessThanOrEqual(4);
    expect(count('simple')).toBeLessThanOrEqual(3);
  });
});
