import { rgbToLab, type FilamentRecord } from '@huecraft/filament-db';
import type { SourceImage } from '@huecraft/engine';
import type { ReliefParams, StackFilament } from '@huecraft/project-schema';
import { toStackFilament } from './stack';

type Lab = { l: number; a: number; b: number };

export interface DominantColor {
  hex: string;
  lab: Lab;
  /** Share of the opaque pixels in this cluster, 0..1. */
  share: number;
}

/** Pixels sampled for clustering; plenty for 4 clusters and fast on the main thread. */
const SAMPLE_COUNT = 20000;
const ITERATIONS = 20;
/** CIE76 ΔE under which a library filament counts as the same colour. */
export const MATCH_DELTA_E = 15;

function deltaE(p: Lab, q: Lab): number {
  return Math.hypot(p.l - q.l, p.a - q.a, p.b - q.b);
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * The `k` predominant colours of the image (k-means in Lab over a pixel sample,
 * transparent pixels skipped), most frequent first. Deterministic.
 */
export function dominantColors(img: SourceImage, k = 4): DominantColor[] {
  const total = img.width * img.height;
  const stride = Math.max(1, Math.floor(total / SAMPLE_COUNT));
  const labs: Lab[] = [];
  const rgbs: number[] = [];
  for (let i = 0; i < total; i += stride) {
    const o = i * 4;
    if (img.rgba[o + 3] < 128) continue;
    const r = img.rgba[o], g = img.rgba[o + 1], b = img.rgba[o + 2];
    labs.push(rgbToLab(r, g, b));
    rgbs.push(r, g, b);
  }
  const n = labs.length;
  if (n === 0) return [];

  // k-means++ seeding, deterministic: always take the farthest remaining sample.
  const centers: Lab[] = [labs[0]];
  const dist = labs.map((p) => deltaE(p, centers[0]));
  while (centers.length < k) {
    let far = 0;
    for (let i = 1; i < n; i++) if (dist[i] > dist[far]) far = i;
    if (dist[far] < 1) break; // fewer distinct colours than k
    centers.push(labs[far]);
    for (let i = 0; i < n; i++) dist[i] = Math.min(dist[i], deltaE(labs[i], labs[far]));
  }

  const assign = new Int32Array(n);
  for (let it = 0; it < ITERATIONS; it++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = deltaE(labs[i], centers[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        moved = true;
      }
    }
    const sums = centers.map(() => ({ l: 0, a: 0, b: 0, count: 0 }));
    for (let i = 0; i < n; i++) {
      const s = sums[assign[i]];
      s.l += labs[i].l;
      s.a += labs[i].a;
      s.b += labs[i].b;
      s.count++;
    }
    for (let c = 0; c < centers.length; c++) {
      const s = sums[c];
      if (s.count > 0) centers[c] = { l: s.l / s.count, a: s.a / s.count, b: s.b / s.count };
    }
    if (!moved) break;
  }

  // Report each cluster's mean sRGB colour (no Lab → sRGB round trip needed).
  const acc = centers.map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
  for (let i = 0; i < n; i++) {
    const s = acc[assign[i]];
    s.r += rgbs[i * 3];
    s.g += rgbs[i * 3 + 1];
    s.b += rgbs[i * 3 + 2];
    s.count++;
  }
  return acc
    .filter((s) => s.count > 0)
    .map((s) => {
      const r = s.r / s.count, g = s.g / s.count, b = s.b / s.count;
      return { hex: toHex(r, g, b), lab: rgbToLab(Math.round(r), Math.round(g), Math.round(b)), share: s.count / n };
    })
    .sort((p, q) => q.share - p.share);
}

/** Rough TD guess for a colour not in the library: dark filaments block light sooner. */
function estimateTd(lab: Lab): number {
  return Math.round((0.6 + (lab.l / 100) ** 2 * 4) * 10) / 10;
}

export interface AutoColorPick {
  filament: StackFilament;
  /** True when an existing library filament was close enough. */
  fromLibrary: boolean;
}

/**
 * Filaments for the image's dominant colours: the closest library filament when
 * within `matchDeltaE`, otherwise a new (unsaved) filament with that colour.
 * Duplicates collapse. Ordered for the stack: darkest at the base, lightest on
 * top, reversed for an inverted relief (where dark pixels are the tall ones).
 */
export function pickAutoColors(
  colors: DominantColor[],
  library: FilamentRecord[],
  invert: boolean,
  matchDeltaE = MATCH_DELTA_E,
): AutoColorPick[] {
  const picks: (AutoColorPick & { l: number })[] = [];
  const used = new Set<string>();
  for (const c of colors) {
    let best: FilamentRecord | null = null;
    let bestD = Infinity;
    for (const f of library) {
      const d = deltaE(c.lab, f.lab);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    if (best && bestD <= matchDeltaE) {
      if (used.has(best.id)) continue;
      used.add(best.id);
      picks.push({ filament: toStackFilament(best), fromLibrary: true, l: best.lab.l });
    } else {
      const key = c.hex.toLowerCase();
      if (used.has(key)) continue;
      used.add(key);
      picks.push({
        filament: { name: `Cor ${c.hex.toUpperCase()}`, brand: '', colorHex: c.hex, tdMm: estimateTd(c.lab) },
        fromLibrary: false,
        l: c.lab.l,
      });
    }
  }
  picks.sort((p, q) => (invert ? q.l - p.l : p.l - q.l));
  return picks.map(({ filament, fromLibrary }) => ({ filament, fromLibrary }));
}

export type ColorPresetId = 'faithful' | 'balanced' | 'simple';

/** How an image is read into filaments and relief when it is opened. */
export interface ColorPreset {
  id: ColorPresetId;
  /** Predominant colours extracted. */
  colors: number;
  /** ΔE under which a library filament replaces the image colour. */
  matchDeltaE: number;
  /** Relief settings the preset applies; the others stay as they are. */
  relief: Pick<ReliefParams, 'smoothing' | 'posterize'>;
}

export const COLOR_PRESETS: ColorPreset[] = [
  // More colours, exact hues and the full tonal range: closest to the photo.
  { id: 'faithful', colors: 6, matchDeltaE: 8, relief: { smoothing: 0, posterize: 0 } },
  { id: 'balanced', colors: 4, matchDeltaE: MATCH_DELTA_E, relief: { smoothing: 0, posterize: 0 } },
  // Few colours, library filaments preferred, smoothed and cut into flat steps
  // (two per colour) so each filament prints as a clean area with little shading.
  { id: 'simple', colors: 3, matchDeltaE: 25, relief: { smoothing: 2, posterize: 6 } },
];

export const DEFAULT_COLOR_PRESET: ColorPresetId = 'balanced';

export interface ColorPresetResult {
  preset: ColorPreset;
  picks: AutoColorPick[];
}

/** Every preset's filaments for the image (one clustering pass per preset). */
export function readColorPresets(img: SourceImage, library: FilamentRecord[], invert: boolean): ColorPresetResult[] {
  return COLOR_PRESETS.map((preset) => ({
    preset,
    picks: pickAutoColors(dominantColors(img, preset.colors), library, invert, preset.matchDeltaE),
  }));
}
