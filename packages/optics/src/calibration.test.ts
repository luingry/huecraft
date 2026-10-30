import { describe, expect, it } from 'vitest';
import { transmissionFactor } from './index.js';

describe('transmissionFactor', () => {
  it('is near zero for opaque filament', () => {
    expect(transmissionFactor(0.2, 1)).toBeLessThan(0.01);
  });

  it('is high for translucent thin layer', () => {
    expect(transmissionFactor(8, 0.08)).toBeGreaterThan(0.95);
  });

  it('decreases monotonically with thickness', () => {
    const a = transmissionFactor(4, 1);
    const b = transmissionFactor(4, 2);
    expect(b).toBeLessThan(a);
  });
});
