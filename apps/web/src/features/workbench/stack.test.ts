import { describe, expect, it } from 'vitest';
import type { StackEntry } from '@huecraft/project-schema';
import { moveFilament, swapFilaments } from './stack';

const slot = (id: string, startLayer: number): StackEntry => ({
  slotId: id,
  startLayer,
  filament: { name: id.toUpperCase(), brand: '', colorHex: '#000000', tdMm: 1 },
});
const stack = [slot('a', 0), slot('b', 5), slot('c', 10), slot('d', 15)];
const names = (s: StackEntry[]) => s.map((e) => `${e.filament.name}@${e.startLayer}`);

describe('filament reordering', () => {
  it('swaps two filaments and keeps the ranges', () => {
    expect(names(swapFilaments(stack, 'a', 'c'))).toEqual(['C@0', 'B@5', 'A@10', 'D@15']);
  });

  it('moves a filament up and shifts the ones in between down', () => {
    expect(names(moveFilament(stack, 'a', 2))).toEqual(['B@0', 'C@5', 'A@10', 'D@15']);
  });

  it('moves a filament down and shifts the ones in between up', () => {
    expect(names(moveFilament(stack, 'd', 1))).toEqual(['A@0', 'D@5', 'B@10', 'C@15']);
  });

  it('is a no-op onto its own position', () => {
    expect(moveFilament(stack, 'b', 1)).toBe(stack);
  });
});
