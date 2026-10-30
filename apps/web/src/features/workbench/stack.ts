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

/** Append a filament on top of the stack, halfway between the current top swap and the last layer. */
export function addOnTop(stack: StackEntry[], f: FilamentRecord | StackFilament, totalLayers: number): StackEntry[] {
  const sorted = sortStack(stack);
  if (sorted.length === 0) return [createSlot(f, 0)];
  const topStart = sorted[sorted.length - 1].startLayer;
  const start = Math.min(totalLayers - 1, Math.max(topStart + 1, Math.round((topStart + totalLayers) / 2)));
  return [...sorted, createSlot(f, start)];
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
