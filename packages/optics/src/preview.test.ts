import { describe, expect, it } from 'vitest';
import type { FilamentRecord } from '@huecraft/filament-db';
import { computeOpticsPreview } from './index.js';

const black: FilamentRecord = {
  id: 'b',
  name: 'Black',
  brand: 'G',
  colorHex: '#111111',
  lab: { l: 8, a: 0, b: 0 },
  tdMm: 0.3,
  source: 'builtin',
};

const red: FilamentRecord = {
  id: 'r',
  name: 'Red',
  brand: 'G',
  colorHex: '#c0392b',
  lab: { l: 48, a: 58, b: 42 },
  tdMm: 2.5,
  source: 'builtin',
};

describe('computeOpticsPreview', () => {
  it('reflects filament stack in high-relief pixels', () => {
    const field = {
      width: 2,
      height: 1,
      heights: new Float32Array([0.1, 3.0]),
    };

    const blackOnly = computeOpticsPreview(field, [black], 0.08, 0.4).rgba;
    const blackRed = computeOpticsPreview(field, [black, red], 0.08, 0.4).rgba;

    expect(Array.from(blackOnly)).not.toEqual(Array.from(blackRed));
  });
});
