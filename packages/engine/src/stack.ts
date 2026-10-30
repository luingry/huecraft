import {
  filamentIndexAtLayer,
  layerTopZ,
  type PrintParams,
  type StackEntry,
  type StackFilament,
  type SwapCommand,
} from '@huecraft/project-schema';
import type { LayerFilament } from '@huecraft/optics';
import type { SwapInfo } from './protocol.js';

/** Used when the stack is empty so previews still render. */
export const FALLBACK_FILAMENT: StackFilament = { name: 'Default', brand: '', colorHex: '#d0d0d0', tdMm: 2 };

/** Stable copy sorted by startLayer, with entry 0 forced to start at layer 0. */
export function normalizeStack(stack: StackEntry[]): StackEntry[] {
  const sorted = stack
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.startLayer - b.e.startLayer || a.i - b.i)
    .map(({ e }) => ({ ...e, startLayer: Math.max(0, Math.round(e.startLayer)) }));
  if (sorted.length > 0) sorted[0] = { ...sorted[0], startLayer: 0 };
  return sorted;
}

/** Filament of every layer 0..totalLayers-1 (the swap is global for the whole print). */
export function layerFilaments(stack: StackEntry[], totalLayers: number): LayerFilament[] {
  const out: LayerFilament[] = new Array(totalLayers);
  if (stack.length === 0) {
    for (let k = 0; k < totalLayers; k++) out[k] = FALLBACK_FILAMENT;
    return out;
  }
  for (let k = 0; k < totalLayers; k++) out[k] = stack[filamentIndexAtLayer(stack, k)].filament;
  return out;
}

/**
 * Swaps actually printed: entries i > 0 that start inside the print and are not
 * shadowed by a later entry starting at the same layer. Expects a normalised stack.
 */
export function computeSwaps(stack: StackEntry[], print: PrintParams, totalLayers: number): SwapInfo[] {
  const swaps: SwapInfo[] = [];
  for (let i = 1; i < stack.length; i++) {
    const e = stack[i];
    if (e.startLayer <= 0 || e.startLayer >= totalLayers) continue;
    if (filamentIndexAtLayer(stack, e.startLayer) !== i) continue;
    swaps.push({
      layer: e.startLayer,
      slicerLayer: e.startLayer + 1,
      topZMm: round4(layerTopZ(print, e.startLayer)),
      pauseAtZMm: round4(layerTopZ(print, e.startLayer - 1)),
      slotId: e.slotId,
      filamentName: e.filament.name,
      colorHex: e.filament.colorHex,
    });
  }
  return swaps;
}

export function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/**
 * Re-spread the stack by pixel quantiles of the relief above the base.
 * Entry 0 starts at 0; entry i starts at the first layer L where the share of
 * relief pixels (columns taller than the base) with at most L layers reaches
 * i / N, so each filament ends up on the top of a similar share of the relief.
 * Starts are strictly increasing, >= baseLayers and < totalLayers whenever the
 * layer range allows it. Slots and order are preserved.
 */
export function autoDistributeStack(
  stack: StackEntry[],
  histogram: Uint32Array,
  baseLayers: number,
  totalLayers: number,
): StackEntry[] {
  const n = stack.length;
  if (n === 0) return [];
  const lo = Math.max(1, Math.min(baseLayers, totalLayers - 1));
  const hi = totalLayers - 1;
  let relief = 0;
  for (let c = lo + 1; c < histogram.length; c++) relief += histogram[c];
  const starts = new Array<number>(n).fill(0);
  if (relief === 0) {
    // Flat image: spread evenly over the available layers.
    for (let i = 1; i < n; i++) starts[i] = lo + Math.floor(((hi - lo + 1) * (i - 1)) / Math.max(1, n - 1));
  } else {
    let cum = 0;
    let c = lo;
    for (let i = 1; i < n; i++) {
      const target = (relief * i) / n;
      // Smallest L with count(columns with lo < count <= L) >= target.
      while (c < hi && cum < target) {
        c++;
        cum += histogram[c] ?? 0;
      }
      // Columns with <= c layers have their top below layer c, so starting the
      // filament at layer c leaves exactly that share on lower filaments.
      starts[i] = c;
    }
  }
  // Enforce strictly increasing starts inside [lo, hi].
  for (let i = 1; i < n; i++) starts[i] = Math.max(starts[i], i === 1 ? lo : starts[i - 1] + 1);
  for (let i = n - 1; i >= 1; i--) starts[i] = Math.min(starts[i], i === n - 1 ? hi : starts[i + 1] - 1);
  for (let i = 1; i < n; i++) starts[i] = Math.max(lo, Math.min(hi, starts[i]));
  return stack.map((e, i) => ({ ...e, startLayer: starts[i] }));
}

export interface SwapPlanInput {
  name: string;
  print: PrintParams;
  stack: StackEntry[];
  swaps: SwapInfo[];
  swapCommand: SwapCommand;
  totalLayers: number;
  baseLayers: number;
  sizeMm: { width: number; height: number; z: number };
}

/** Human-readable swap plan with 1-based slicer layer numbers and layer-top Z. */
export function formatSwapPlan(input: SwapPlanInput): string {
  const { print, swaps, stack } = input;
  const f3 = (v: number) => v.toFixed(3);
  const f2 = (v: number) => v.toFixed(2);
  const lines = [
    `hueCraft swap plan: ${input.name}`,
    `Size: ${f2(input.sizeMm.width)} × ${f2(input.sizeMm.height)} × ${f2(input.sizeMm.z)} mm`,
    `Layer height: ${f3(print.layerHeightMm)} mm, first layer: ${f3(print.firstLayerHeightMm)} mm, total layers: ${input.totalLayers}`,
    `Base: ${input.baseLayers} layers (to Z ${f3(layerTopZ(print, input.baseLayers - 1))} mm)`,
    `Swap command: ${input.swapCommand === 'pause' ? 'pause (Bambu M400 U1 / M601)' : 'colour change (M600)'}`,
    'Set the same layer height and first layer height in the slicer.',
    '',
  ];
  const first = stack[0]?.filament ?? FALLBACK_FILAMENT;
  lines.push(`Layer 1 (Z ${f3(layerTopZ(print, 0))} mm) → start with "${first.name}" ${first.colorHex}`);
  const verb = input.swapCommand === 'pause' ? 'pause, load' : 'colour change to';
  for (const s of swaps) {
    lines.push(`Layer ${s.slicerLayer} (Z ${f3(s.topZMm)} mm) → ${verb} "${s.filamentName}" ${s.colorHex}`);
  }
  if (swaps.length === 0) lines.push('No filament swaps.');
  lines.push('');
  return lines.join('\n');
}
