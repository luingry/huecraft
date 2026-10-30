import { describe, expect, it } from 'vitest';
import type { StackEntry } from '@huecraft/project-schema';
import { addOnTop, filamentsInUse, insertInBand, moveFilament, swapFilaments, topReachedLayer } from './stack';

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

describe('adding filaments', () => {
  const e = { name: 'E', brand: '', colorHex: '#ffffff', tdMm: 1 };
  const starts = (s: StackEntry[]) => s.map((x) => x.startLayer);

  it('finds the highest layer the image reaches', () => {
    expect(topReachedLayer(Uint32Array.from([0, 0, 3, 5, 0, 0]), 5)).toBe(2);
    expect(topReachedLayer(null, 5)).toBe(4);
  });

  it('adds on top below the highest reached layer, not the last layer of the print', () => {
    expect(starts(addOnTop(stack, e, 21))).toEqual([0, 5, 10, 15, 19]);
  });

  it('splits the thickest band when the top has no room left', () => {
    const s = addOnTop([...stack, slot('e', 20)], e, 20);
    expect(s).toHaveLength(6);
    expect(Math.max(...starts(s))).toBeLessThanOrEqual(20);
  });

  it('inserts into the upper half of a band', () => {
    expect(names(insertInBand(stack, 'b', e, 20))).toEqual(['A@0', 'B@5', 'E@8', 'C@10', 'D@15']);
    expect(insertInBand([slot('a', 0), slot('b', 1)], 'a', e, 20)).toHaveLength(2);
  });

  it('lists each filament in use once', () => {
    expect(filamentsInUse([...stack, { ...slot('x', 20), filament: stack[0].filament }])).toHaveLength(4);
  });
});
