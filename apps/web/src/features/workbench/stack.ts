import type { FilamentRecord } from '@huecraft/filament-db';
import type { StackEntry, StackFilament } from '@huecraft/project-schema';

export function toStackFilament(f: FilamentRecord | StackFilament): StackFilament {
  return {
    libraryId: 'id' in f ? f.id : f.libraryId,
    name: f.name,
    brand: f.brand,
    colorHex: f.colorHex,
    tdMm: f.tdMm,
  };
}

export function createSlot(f: FilamentRecord | StackFilament, startLayer: number): StackEntry {
  return { slotId: crypto.randomUUID(), startLayer, filament: toStackFilament(f) };
}

export function sortStack(stack: StackEntry[]): StackEntry[] {
  return [...stack].sort((a, b) => a.startLayer - b.startLayer);
}

/**
 * Sort by start layer and keep starts strictly increasing (entry 0 at 0).
 * Entries pushed past the last layer simply won't print; the UI flags them.
 */
export function normalizeStack(stack: StackEntry[]): StackEntry[] {
  let prev = -1;
  const out = sortStack(stack).map((e, i) => {
    const start = i === 0 ? 0 : Math.max(e.startLayer, prev + 1);
    prev = start;
    return start === e.startLayer ? e : { ...e, startLayer: start };
  });
  return out.every((e, i) => e === stack[i]) ? stack : out;
}

/** Move one swap, clamped between its neighbours. */
export function setStartLayer(stack: StackEntry[], slotId: string, layer: number, totalLayers: number): StackEntry[] {
  const sorted = sortStack(stack);
  const i = sorted.findIndex((e) => e.slotId === slotId);
  if (i <= 0) return stack;
  const lo = sorted[i - 1].startLayer + 1;
  const hi = i + 1 < sorted.length ? sorted[i + 1].startLayer - 1 : totalLayers - 1;
  const clamped = Math.max(lo, Math.min(hi, Math.round(layer)));
  if (clamped === sorted[i].startLayer) return stack;
  sorted[i] = { ...sorted[i], startLayer: clamped };
  return sorted;
}

/**
 * Highest layer index any pixel reaches (histogram index n = columns with n layers).
 * Swaps above it change nothing in the image. Falls back to the last layer.
 */
export function topReachedLayer(histogram: Uint32Array | null, totalLayers: number): number {
  if (histogram) for (let n = Math.min(totalLayers, histogram.length - 1); n >= 1; n--) if (histogram[n] > 0) return n - 1;
  return totalLayers - 1;
}

/** Layers [start, end) of the band of `slotId`, with the top band ending above `topLayer`. */
export function bandRange(stack: StackEntry[], slotId: string, topLayer: number): { start: number; end: number } | null {
  const sorted = sortStack(stack);
  const i = sorted.findIndex((e) => e.slotId === slotId);
  if (i < 0) return null;
  const end = i + 1 < sorted.length ? sorted[i + 1].startLayer : topLayer + 1;
  return { start: sorted[i].startLayer, end };
}

/**
 * Split the band of `slotId` in half: the new filament takes its upper half.
 * Returns the stack unchanged when the band is thinner than two layers.
 */
export function insertInBand(
  stack: StackEntry[],
  slotId: string,
  f: FilamentRecord | StackFilament,
  topLayer: number,
): StackEntry[] {
  const range = bandRange(stack, slotId, topLayer);
  if (!range || range.end - range.start < 2) return stack;
  const start = range.start + Math.ceil((range.end - range.start) / 2);
  return sortStack([...stack, createSlot(f, start)]);
}

/**
 * Add a filament on top of the stack, halfway between the current top swap and
 * the highest layer the image reaches. With no room left there, the thickest
 * band is split instead so the new colour always shows up.
 */
export function addOnTop(stack: StackEntry[], f: FilamentRecord | StackFilament, topLayer: number): StackEntry[] {
  const sorted = sortStack(stack);
  if (sorted.length === 0) return [createSlot(f, 0)];
  const topStart = sorted[sorted.length - 1].startLayer;
  if (topLayer - topStart >= 1) {
    return [...sorted, createSlot(f, Math.max(topStart + 1, Math.round((topStart + topLayer + 1) / 2)))];
  }
  let widest = sorted[0];
  let widestSize = 0;
  for (const e of sorted) {
    const r = bandRange(sorted, e.slotId, topLayer)!;
    if (r.end - r.start > widestSize) {
      widest = e;
      widestSize = r.end - r.start;
    }
  }
  if (widestSize >= 2) return insertInBand(sorted, widest.slotId, f, topLayer);
  return [...sorted, createSlot(f, topStart + 1)];
}

/** Same physical filament: same library entry, or same colour, TD and name when unsaved. */
export function filamentKey(f: StackFilament): string {
  return f.libraryId ?? `${f.colorHex.toLowerCase()}|${f.tdMm}|${f.name}`;
}

/** Distinct filaments of the stack, base first. */
export function filamentsInUse(stack: StackEntry[]): StackFilament[] {
  const seen = new Map<string, StackFilament>();
  for (const e of sortStack(stack)) if (!seen.has(filamentKey(e.filament))) seen.set(filamentKey(e.filament), e.filament);
  return [...seen.values()];
}

export function removeSlot(stack: StackEntry[], slotId: string): StackEntry[] {
  const sorted = sortStack(stack).filter((e) => e.slotId !== slotId);
  if (sorted.length > 0 && sorted[0].startLayer !== 0) sorted[0] = { ...sorted[0], startLayer: 0 };
  return sorted;
}

export function replaceFilament(stack: StackEntry[], slotId: string, filament: StackFilament): StackEntry[] {
  return stack.map((e) => (e.slotId === slotId ? { ...e, filament } : e));
}

/** Swap the filaments of two slots; each slot keeps its own layer range. */
export function swapFilaments(stack: StackEntry[], a: string, b: string): StackEntry[] {
  const fa = stack.find((e) => e.slotId === a)?.filament;
  const fb = stack.find((e) => e.slotId === b)?.filament;
  if (!fa || !fb || a === b) return stack;
  return stack.map((e) => (e.slotId === a ? { ...e, filament: fb } : e.slotId === b ? { ...e, filament: fa } : e));
}

/**
 * Move one slot's filament to position `toIndex` (base = 0) and shift the
 * filaments in between by one slot. Every slot keeps its own layer range.
 */
export function moveFilament(stack: StackEntry[], slotId: string, toIndex: number): StackEntry[] {
  const sorted = sortStack(stack);
  const from = sorted.findIndex((e) => e.slotId === slotId);
  const to = Math.max(0, Math.min(sorted.length - 1, toIndex));
  if (from < 0 || from === to) return stack;
  const filaments = sorted.map((e) => e.filament);
  const [moved] = filaments.splice(from, 1);
  filaments.splice(to, 0, moved);
  return sorted.map((e, i) => (e.filament === filaments[i] ? e : { ...e, filament: filaments[i] }));
}
