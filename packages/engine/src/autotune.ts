/**
 * Auto-tune: searches the stack (filament order + swap layers) and, optionally,
 * the relief tone (contrast / brightness / gamma / invert) for the settings
 * whose *predicted print* (the same TD model as the preview) is closest to the
 * source image.
 *
 * Error metric: mean squared OKLab distance between the source (area-averaged
 * in linear light onto a small grid) and the printed colour of each pixel,
 * weighted by alpha. Reported as RMS ΔE_ok × 100.
 *
 * Speed trick: once the relief is fixed, every pixel's colour depends only on
 * its layer count, so the error of any stack is computed from per-layer-count
 * sufficient statistics (Σw, Σw·lab, Σw·|lab|²) in O(totalLayers), not
 * O(pixels). That makes near-exhaustive searches over swap layers cheap.
 */
import type { PrintParams, ReliefParams, StackEntry } from '@huecraft/project-schema';
import { hexToRgb, layerOpacity, srgbToLinear, type LayerModel } from '@huecraft/optics';
import { adjustColorTarget, isNeutralTone, linToOklab, LUMA_PULL } from './colorHeight.js';

export interface AutoTuneOptions {
  /** Also try every order of the filaments (≤ 6 filaments). */
  reorder: boolean;
  /** Also tune contrast, brightness, gamma and invert. */
  tone: boolean;
  /**
   * Colour-driven heights strength to tune for (ReliefParams.colorMatch).
   * Missing = keep the relief's own value. Tone is not searched when > 0.
   */
  colorMatch?: number;
  /** Stop searching after this many milliseconds (best so far is kept). */
  timeBudgetMs?: number;
  /** Weight of colour borders in colour mode (see ColorScorer.edgeError). Missing = EDGE_WEIGHT. */
  edgeWeight?: number;
}

export interface AutoTuneParams {
  relief: ReliefParams;
  print: PrintParams;
  stack: StackEntry[];
  simulateLineWidth: boolean;
  options: AutoTuneOptions;
}

export interface AutoTuneResult {
  relief: ReliefParams;
  stack: StackEntry[];
  /** RMS ΔE_ok × 100 of the input settings and of the result. */
  errorBefore: number;
  errorAfter: number;
  evaluations: number;
  ms: number;
}

/** Target colours on the tuning grid, OKLab, with alpha as weight. */
export interface TuneTarget {
  width: number;
  height: number;
  lab: Float32Array; // 3 per pixel
  weight: Float32Array;
}

/* ---------- colour ---------- */


/**
 * Downsample an RGBA image onto `width × height` by binning, averaging in
 * linear light (what the eye sees from a distance), then convert to OKLab.
 */
export function buildTuneTarget(src: { width: number; height: number; rgba: Uint8ClampedArray }, width: number, height: number): TuneTarget {
  const n = width * height;
  const acc = new Float64Array(n * 3);
  const accA = new Float64Array(n);
  const cnt = new Uint32Array(n);
  const lin = new Float64Array(256);
  for (let i = 0; i < 256; i++) lin[i] = srgbToLinear(i / 255);
  const { width: iw, height: ih, rgba } = src;
  for (let y = 0; y < ih; y++) {
    const row = Math.min(height - 1, Math.floor((y * height) / ih)) * width;
    for (let x = 0; x < iw; x++) {
      const c = row + Math.min(width - 1, Math.floor((x * width) / iw));
      const o = (y * iw + x) * 4;
      const a = rgba[o + 3] / 255;
      acc[c * 3] += lin[rgba[o]] * a;
      acc[c * 3 + 1] += lin[rgba[o + 1]] * a;
      acc[c * 3 + 2] += lin[rgba[o + 2]] * a;
      accA[c] += a;
      cnt[c]++;
    }
  }
  const lab = new Float32Array(n * 3);
  const weight = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = accA[i];
    weight[i] = cnt[i] ? a / cnt[i] : 0;
    if (a > 1e-6) linToOklab(acc[i * 3] / a, acc[i * 3 + 1] / a, acc[i * 3 + 2] / a, lab, i * 3);
  }
  return { width, height, lab, weight };
}

/* ---------- sufficient statistics ---------- */

export interface LayerStats {
  total: number;
  w: Float64Array; // per layer count
  s: Float64Array; // 3 per layer count
  q: Float64Array; // per layer count
  hist: Uint32Array;
  wSum: number;
}

export function layerStats(field: Uint16Array, target: TuneTarget, totalLayers: number): LayerStats {
  const w = new Float64Array(totalLayers + 1);
  const s = new Float64Array((totalLayers + 1) * 3);
  const q = new Float64Array(totalLayers + 1);
  const hist = new Uint32Array(totalLayers + 1);
  let wSum = 0;
  const { lab, weight } = target;
  for (let i = 0; i < field.length; i++) {
    const n = field[i] > totalLayers ? totalLayers : field[i];
    hist[n]++;
    const wi = weight[i];
    if (wi <= 0) continue;
    const L = lab[i * 3];
    const A = lab[i * 3 + 1];
    const B = lab[i * 3 + 2];
    w[n] += wi;
    s[n * 3] += wi * L;
    s[n * 3 + 1] += wi * A;
    s[n * 3 + 2] += wi * B;
    q[n] += wi * (L * L + A * A + B * B);
    wSum += wi;
  }
  return { total: totalLayers, w, s, q, hist, wSum };
}

/* ---------- stack evaluation ---------- */

interface Fil {
  lin: [number, number, number];
  /** Opacity of one regular layer. */
  a: number;
}

interface Scorer {
  evaluations: number;
  /** Pixel count per luma layer count (for quantile seeding). */
  readonly hist: Uint32Array;
  /** Search objective (lower is better). */
  score(order: number[], starts: number[]): number;
  /** Colour-only mean squared ΔE_ok of a choice (what is reported). */
  colorMse(order: number[], starts: number[]): number;
}

/** OKLab of the printed colour for every layer count, written into `out` (3 per count). */
function printedLab(fils: Fil[], order: number[], starts: number[], total: number, out: Float64Array): void {
  let j = 0;
  let f = fils[order[0]];
  let r = f.lin[0];
  let g = f.lin[1];
  let b = f.lin[2];
  linToOklab(r, g, b, out, 0);
  linToOklab(r, g, b, out, 3);
  for (let k = 1; k < total; k++) {
    while (j + 1 < order.length && starts[j + 1] <= k) j++;
    f = fils[order[j]];
    const a = f.a;
    r += (f.lin[0] - r) * a;
    g += (f.lin[1] - g) * a;
    b += (f.lin[2] - b) * a;
    linToOklab(r, g, b, out, (k + 1) * 3);
  }
}

/** Weight of the border term (ColorScorer.edgeError) against the mean per-pixel cost. */
export const EDGE_WEIGHT = 0.5;
/** Neighbours further apart than this (ΔE_ok) count as a border between colours. */
const EDGE_MIN_DE = 0.12;
/**
 * Only borders between two near-neutral colours (black / grey / white) are
 * scored. Those are the ones a stack ruins by putting a hue between them
 * (orange specks on a black figure over a white page). A border between a
 * neutral and a hue (black bird on an orange sun) crosses some other filament
 * in any order where the hue sits on top, so scoring it only fights the colour
 * fidelity of the hue.
 */
const EDGE_NEUTRAL_CHROMA = 0.05;

/** Neighbouring pixel pairs across a border between two neutral colours, merged per bin pair. */
function collectEdges(binOf: Int32Array, width: number, height: number, orig: Float64Array) {
  const map = new Map<number, number>();
  const a: number[] = [];
  const b: number[] = [];
  const w: number[] = [];
  const min2 = EDGE_MIN_DE * EDGE_MIN_DE;
  const c2 = EDGE_NEUTRAL_CHROMA * EDGE_NEUTRAL_CHROMA;
  const neutral = (k: number) => orig[k * 3 + 1] * orig[k * 3 + 1] + orig[k * 3 + 2] * orig[k * 3 + 2] < c2;
  const add = (p: number, q: number) => {
    if (p < 0 || q < 0 || p === q || !neutral(p) || !neutral(q)) return;
    const dl = orig[p * 3] - orig[q * 3];
    const da = orig[p * 3 + 1] - orig[q * 3 + 1];
    const db = orig[p * 3 + 2] - orig[q * 3 + 2];
    if (dl * dl + da * da + db * db < min2) return;
    const lo = p < q ? p : q;
    const hi = p < q ? q : p;
    const key = lo * 4294967296 + hi;
    let e = map.get(key);
    if (e === undefined) {
      e = w.length;
      map.set(key, e);
      a.push(lo);
      b.push(hi);
      w.push(0);
    }
    w[e]++;
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (x + 1 < width) add(binOf[i], binOf[i + 1]);
      if (y + 1 < height) add(binOf[i], binOf[i + width]);
    }
  let wSum = 0;
  for (const v of w) wSum += v;
  return { a: Uint32Array.from(a), b: Uint32Array.from(b), w: Float64Array.from(w), count: w.length, wSum };
}

/**
 * Colour-driven heights: every pixel takes its best layer count (argmin of
 * match + luma pull, as colorHeightField does), and a stack is scored by the
 * colour error of those picks against the source plus the border term
 * (edgeError). Pixels are binned by (OKLab cell, luma layer count) to keep
 * each evaluation small.
 */
class ColorScorer implements Scorer {
  evaluations = 0;
  private labs: Float64Array;
  /** `lab`: the colour each bin aims for (tone applied); `orig`: the source colour the error is reported against. */
  private bins: { w: Float64Array; lab: Float64Array; orig: Float64Array; nl: Uint16Array; count: number };
  private wSum = 0;
  private pull: number;
  private lastColor = 0;
  /** Borders between distinct colours: bin pair, weight, and the colour their mixture should print. */
  private edges: { a: Uint32Array; b: Uint32Array; w: Float64Array; count: number; wSum: number };
  private bestN: Uint16Array;
  constructor(
    readonly fils: Fil[],
    readonly model: LayerModel,
    target: TuneTarget,
    lumaCounts: Uint16Array,
    readonly strength: number,
    readonly hist: Uint32Array,
    /** Tone-adjusted target the heights follow (defaults to `target`). */
    aim: TuneTarget = target,
    readonly edgeWeight = EDGE_WEIGHT,
  ) {
    this.labs = new Float64Array((model.totalLayers + 1) * 3);
    this.pull = ((1 - strength) * LUMA_PULL) / Math.max(1, model.totalLayers) ** 2;
    const Q = 48;
    const map = new Map<number, number>();
    const w: number[] = [];
    const lab: number[] = [];
    const orig: number[] = [];
    const nl: number[] = [];
    const binOf = new Int32Array(lumaCounts.length).fill(-1);
    for (let i = 0; i < lumaCounts.length; i++) {
      const wi = target.weight[i];
      if (wi < 0.5) continue;
      const L = aim.lab[i * 3];
      const A = aim.lab[i * 3 + 1];
      const B = aim.lab[i * 3 + 2];
      const key = ((Math.round(L * Q) * 128 + Math.round(A * Q) + 64) * 128 + Math.round(B * Q) + 64) * 2048 + lumaCounts[i];
      let k = map.get(key);
      if (k === undefined) {
        k = w.length;
        map.set(key, k);
        w.push(0);
        lab.push(0, 0, 0);
        orig.push(0, 0, 0);
        nl.push(lumaCounts[i]);
      }
      binOf[i] = k;
      w[k] += wi;
      lab[k * 3] += wi * L;
      lab[k * 3 + 1] += wi * A;
      lab[k * 3 + 2] += wi * B;
      for (let c = 0; c < 3; c++) orig[k * 3 + c] += wi * target.lab[i * 3 + c];
      this.wSum += wi;
    }
    for (let k = 0; k < w.length; k++)
      for (let c = 0; c < 3; c++) {
        lab[k * 3 + c] /= w[k] || 1;
        orig[k * 3 + c] /= w[k] || 1;
      }
    this.bins = { w: Float64Array.from(w), lab: Float64Array.from(lab), orig: Float64Array.from(orig), nl: Uint16Array.from(nl), count: w.length };
    this.bestN = new Uint16Array(w.length);
    this.edges = collectEdges(binOf, target.width, target.height, this.bins.orig);
  }

  score(order: number[], starts: number[]): number {
    this.evaluations++;
    if (this.wSum <= 0) return 0;
    const { totalLayers: hi, baseLayers: lo } = this.model;
    printedLab(this.fils, order, starts, hi, this.labs);
    const labs = this.labs;
    const s = this.strength;
    const pull = this.pull;
    const { w, lab, orig, nl, count } = this.bins;
    let color = 0;
    for (let k = 0; k < count; k++) {
      const L = lab[k * 3];
      const A = lab[k * 3 + 1];
      const B = lab[k * 3 + 2];
      const n0 = nl[k];
      let best = Infinity;
      let bestN = n0;
      for (let n = lo; n <= hi; n++) {
        const dl = labs[n * 3] - L;
        const da = labs[n * 3 + 1] - A;
        const db = labs[n * 3 + 2] - B;
        const d = dl * dl + da * da + db * db;
        const dn = n - n0;
        const c = s * d + pull * dn * dn;
        if (c < best) {
          best = c;
          bestN = n;
        }
      }
      this.bestN[k] = bestN;
      const ol = labs[bestN * 3] - orig[k * 3];
      const oa = labs[bestN * 3 + 1] - orig[k * 3 + 1];
      const ob = labs[bestN * 3 + 2] - orig[k * 3 + 2];
      color += w[k] * (ol * ol + oa * oa + ob * ob);
    }
    this.lastColor = color / this.wSum;
    // The match + luma-pull cost only picks each bin's height. The stack is
    // judged by how close the print gets to the source: scoring the pull too
    // made the search trade colour for heights near the luma relief (a sun's
    // yellow squeezed to one layer when the stack puts the sun on top).
    return this.lastColor + (this.edgeWeight > 0 ? this.edgeWeight * this.edgeError(labs) : 0);
  }

  /**
   * Mean squared ΔE_ok between what a border between two colours prints and
   * what it should look like. A line-width block (or a slicer line) straddling
   * the border ends at a height between the two sides, so it prints the colour
   * of the layers in between: with black and white at opposite ends of the
   * stack every such block shows the filaments stacked between them (orange
   * specks on a black-and-white figure). A layer in between looks right when
   * it is a mix of the two sides, i.e. close to the OKLab segment joining
   * them (greys between black and white). Per-pixel error alone barely sees
   * this (borders are a small share of the area), so it never preferred
   * stacks where colours that touch also sit next to each other in height.
   */
  private edgeError(labs: Float64Array): number {
    const { a, b, w, count, wSum } = this.edges;
    if (wSum <= 0) return 0;
    const bestN = this.bestN;
    const orig = this.bins.orig;
    let err = 0;
    for (let e = 0; e < count; e++) {
      const na = bestN[a[e]];
      const nb = bestN[b[e]];
      if (nb - na <= 1 && na - nb <= 1) continue;
      const lo = na < nb ? na : nb;
      const hi = na < nb ? nb : na;
      const pa = a[e] * 3;
      const pb = b[e] * 3;
      const ux = orig[pb] - orig[pa];
      const uy = orig[pb + 1] - orig[pa + 1];
      const uz = orig[pb + 2] - orig[pa + 2];
      const uu = ux * ux + uy * uy + uz * uz || 1;
      let sum = 0;
      for (let n = lo + 1; n < hi; n++) {
        const vx = labs[n * 3] - orig[pa];
        const vy = labs[n * 3 + 1] - orig[pa + 1];
        const vz = labs[n * 3 + 2] - orig[pa + 2];
        let t = (vx * ux + vy * uy + vz * uz) / uu;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = vx - t * ux;
        const dy = vy - t * uy;
        const dz = vz - t * uz;
        sum += dx * dx + dy * dy + dz * dz;
      }
      err += (w[e] * sum) / (hi - lo - 1);
    }
    return err / wSum;
  }

  colorMse(order: number[], starts: number[]): number {
    this.score(order, starts);
    return this.lastColor;
  }
}

/**
 * Evaluator for a fixed set of filaments and layer stats. `order[j]` is the
 * filament index of stack position j, `starts[j]` its first layer.
 */
class StackScorer implements Scorer {
  evaluations = 0;
  private lab = new Float32Array(3);
  constructor(
    readonly fils: Fil[],
    readonly stats: LayerStats,
  ) {}

  get hist(): Uint32Array {
    return this.stats.hist;
  }

  colorMse(order: number[], starts: number[]): number {
    return this.score(order, starts);
  }

  /** Mean squared ΔE_ok. Mirrors buildPrintedLut (layer 0 is the opaque base). */
  score(order: number[], starts: number[]): number {
    this.evaluations++;
    const { w, s, q, total, wSum } = this.stats;
    if (wSum <= 0) return 0;
    const lab = this.lab;
    let j = 0;
    let f = this.fils[order[0]];
    let r = f.lin[0];
    let g = f.lin[1];
    let b = f.lin[2];
    let err = 0;
    const add = (n: number) => {
      const wn = w[n];
      if (wn <= 0) return;
      linToOklab(r, g, b, lab, 0);
      err += q[n] - 2 * (lab[0] * s[n * 3] + lab[1] * s[n * 3 + 1] + lab[2] * s[n * 3 + 2]) + wn * (lab[0] * lab[0] + lab[1] * lab[1] + lab[2] * lab[2]);
    };
    add(0);
    add(1);
    for (let k = 1; k < total; k++) {
      while (j + 1 < order.length && starts[j + 1] <= k) j++;
      f = this.fils[order[j]];
      const a = f.a;
      r += (f.lin[0] - r) * a;
      g += (f.lin[1] - g) * a;
      b += (f.lin[2] - b) * a;
      add(k + 1);
    }
    return Math.max(0, err / wSum);
  }
}

/** Swap-layer range: [lo, hi], as autoDistributeStack uses. */
function startRange(model: LayerModel): [number, number] {
  const lo = Math.max(1, Math.min(model.baseLayers, model.totalLayers - 1));
  return [lo, model.totalLayers - 1];
}

/** Quantile starts over the relief (like autoDistributeStack). */
function quantileStarts(n: number, hist: Uint32Array, lo: number, hi: number): number[] {
  const starts = new Array<number>(n).fill(0);
  let relief = 0;
  for (let c = lo + 1; c < hist.length; c++) relief += hist[c];
  let cum = 0;
  let c = lo;
  for (let i = 1; i < n; i++) {
    if (relief === 0) starts[i] = lo + Math.floor(((hi - lo + 1) * (i - 1)) / Math.max(1, n - 1));
    else {
      const target = (relief * i) / n;
      while (c < hi && cum < target) {
        c++;
        cum += hist[c] ?? 0;
      }
      starts[i] = c;
    }
  }
  return fixStarts(starts, lo, hi);
}

/** Strictly increasing starts inside [lo, hi] (when the range allows it). */
function fixStarts(starts: number[], lo: number, hi: number): number[] {
  const n = starts.length;
  const out = starts.slice();
  out[0] = 0;
  for (let i = 1; i < n; i++) out[i] = Math.max(out[i], i === 1 ? lo : out[i - 1] + 1);
  for (let i = n - 1; i >= 1; i--) out[i] = Math.min(out[i], i === n - 1 ? hi : out[i + 1] - 1);
  for (let i = 1; i < n; i++) out[i] = Math.max(lo, Math.min(hi, out[i]));
  return out;
}

/** Coordinate descent: each start moves to its best layer between its neighbours, until stable. */
function descend(sc: Scorer, order: number[], init: number[], lo: number, hi: number, maxSweeps = 12): { starts: number[]; err: number } {
  const starts = init.slice();
  let err = sc.score(order, starts);
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let improved = false;
    for (let i = 1; i < starts.length; i++) {
      const a = i === 1 ? lo : starts[i - 1] + 1;
      const b = i === starts.length - 1 ? hi : starts[i + 1] - 1;
      const keep = starts[i];
      let best = keep;
      for (let v = a; v <= b; v++) {
        if (v === keep) continue;
        starts[i] = v;
        const e = sc.score(order, starts);
        if (e < err - 1e-12) {
          err = e;
          best = v;
          improved = true;
        }
      }
      starts[i] = best;
    }
    if (!improved) break;
  }
  return { starts, err };
}

function permutations(n: number): number[][] {
  const out: number[][] = [];
  const cur: number[] = [];
  const used = new Array<boolean>(n).fill(false);
  const rec = () => {
    if (cur.length === n) {
      out.push(cur.slice());
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = true;
      cur.push(i);
      rec();
      cur.pop();
      used[i] = false;
    }
  };
  rec();
  return out;
}

interface StackChoice {
  order: number[];
  starts: number[];
  err: number;
}

/** Best order + starts for fixed stats. */
function searchStack(sc: Scorer, model: LayerModel, n: number, seed: StackChoice, reorder: boolean, deadline: number): StackChoice {
  const [lo, hi] = startRange(model);
  let best: StackChoice = { ...seed, err: sc.score(seed.order, seed.starts) };
  const consider = (order: number[], init: number[], sweeps?: number) => {
    const r = descend(sc, order, init, lo, hi, sweeps);
    const c = { order, starts: r.starts, err: r.err };
    if (c.err < best.err - 1e-12) best = c;
    return c;
  };
  const q = (_order: number[]) => quantileStarts(n, sc.hist, lo, hi);
  consider(seed.order, seed.starts);
  consider(seed.order, q(seed.order));
  if (reorder && n >= 2 && n <= 6) {
    // Screen every order with a short descent from the quantile spread, then
    // refine the most promising ones fully.
    const screened = permutations(n)
      .map((order) => {
        if (performance.now() > deadline) return null;
        return consider(order, q(order), 2);
      })
      .filter((c): c is StackChoice => c !== null)
      .sort((a, b) => a.err - b.err)
      .slice(0, 6);
    for (const c of screened) {
      if (performance.now() > deadline) break;
      consider(c.order, c.starts);
    }
  }
  return best;
}

/* ---------- tone search ---------- */

interface Tone {
  contrast: number;
  brightness: number;
  gamma: number;
}

const toVec = (t: Tone) => [Math.log(t.contrast), t.brightness, Math.log(t.gamma)];
const fromVec = (v: number[]): Tone => ({
  contrast: clamp(Math.exp(v[0]), 0.3, 3),
  brightness: clamp(v[1], -0.5, 0.5),
  gamma: clamp(Math.exp(v[2]), 0.4, 2.5),
});
function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

/** Plain Nelder–Mead minimiser. */
function nelderMead(f: (v: number[]) => number, x0: number[], step: number[], maxIter: number, deadline: number): { x: number[]; fx: number } {
  const dim = x0.length;
  let simplex = [x0.slice()];
  for (let i = 0; i < dim; i++) {
    const p = x0.slice();
    p[i] += step[i];
    simplex.push(p);
  }
  let values = simplex.map(f);
  for (let it = 0; it < maxIter && performance.now() < deadline; it++) {
    const idx = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
    simplex = idx.map((i) => simplex[i]);
    values = idx.map((i) => values[i]);
    if (Math.abs(values[dim] - values[0]) < 1e-7) break;
    const centroid = new Array(dim).fill(0);
    for (let i = 0; i < dim; i++) for (let d = 0; d < dim; d++) centroid[d] += simplex[i][d] / dim;
    const at = (t: number) => centroid.map((c, d) => c + t * (simplex[dim][d] - c));
    const xr = at(-1);
    const fr = f(xr);
    if (fr < values[0]) {
      const xe = at(-2);
      const fe = f(xe);
      if (fe < fr) {
        simplex[dim] = xe;
        values[dim] = fe;
      } else {
        simplex[dim] = xr;
        values[dim] = fr;
      }
    } else if (fr < values[dim - 1]) {
      simplex[dim] = xr;
      values[dim] = fr;
    } else {
      const xc = fr < values[dim] ? at(-0.5) : at(0.5);
      const fc = f(xc);
      if (fc < Math.min(fr, values[dim])) {
        simplex[dim] = xc;
        values[dim] = fc;
      } else {
        for (let i = 1; i <= dim; i++) {
          simplex[i] = simplex[i].map((x, d) => simplex[0][d] + 0.5 * (x - simplex[0][d]));
          values[i] = f(simplex[i]);
        }
      }
    }
  }
  let bi = 0;
  for (let i = 1; i < values.length; i++) if (values[i] < values[bi]) bi = i;
  return { x: simplex[bi], fx: values[bi] };
}

/* ---------- driver ---------- */

export interface AutoTuneContext {
  model: LayerModel;
  target: TuneTarget;
  /** Layer field on the tuning grid for a relief (cached by the caller if useful). */
  fieldFor: (relief: ReliefParams) => Uint16Array;
}

const toRms = (mse: number) => Math.sqrt(mse) * 100;

export function autoTune(params: AutoTuneParams, ctx: AutoTuneContext): AutoTuneResult {
  const t0 = performance.now();
  const deadline = t0 + (params.options.timeBudgetMs ?? 6000);
  const { model, target } = ctx;
  const { print } = params;
  const stack = params.stack
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.startLayer - b.e.startLayer || a.i - b.i)
    .map(({ e }) => e);
  const n = stack.length;
  if (n === 0) throw new Error('Empty stack');
  const fils: Fil[] = stack.map((e) => ({
    lin: hexToRgb(e.filament.colorHex).map((v) => srgbToLinear(v / 255)) as [number, number, number],
    a: layerOpacity(e.filament.tdMm, print.layerHeightMm),
  }));
  const [lo, hi] = startRange(model);
  const identity = stack.map((_, i) => i);
  const initStarts = fixStarts(
    stack.map((e) => e.startLayer),
    lo,
    hi,
  );

  let evaluations = 0;
  const scorerFor = (relief: ReliefParams): Scorer => {
    const counts = ctx.fieldFor(relief);
    const stats = layerStats(counts, target, model.totalLayers);
    const cm = relief.colorMatch ?? 0;
    return cm > 0 ? new ColorScorer(fils, model, target, counts, Math.min(1, cm), stats.hist, adjustColorTarget(target, relief), params.options.edgeWeight) : new StackScorer(fils, stats);
  };

  // Before: the settings exactly as given.
  const before = scorerFor(params.relief).colorMse(identity, stack.map((e, i) => (i === 0 ? 0 : e.startLayer)));

  let relief: ReliefParams = { ...params.relief, colorMatch: params.options.colorMatch ?? params.relief.colorMatch ?? 0 };
  const colorMode = (relief.colorMatch ?? 0) > 0;
  let sc0 = scorerFor(relief);
  let best = searchStack(sc0, model, n, { order: identity, starts: initStarts, err: Infinity }, params.options.reorder, deadline);
  evaluations += sc0.evaluations;

  // Colour mode aims at the tone-adjusted image, so a contrast / gamma left
  // over from a luma tune or a manual edit drags the result towards black and
  // white. Also try the untouched image (neutral tone) and keep whichever
  // prints closer to the source.
  if (colorMode && !isNeutralTone({ ...relief, smoothing: 0 })) {
    const neutral: ReliefParams = { ...relief, brightness: 0, contrast: 1, gamma: 1 };
    const sc1 = scorerFor(neutral);
    const alt = searchStack(sc1, model, n, best, params.options.reorder, Math.max(deadline, performance.now() + 1500));
    evaluations += sc1.evaluations;
    // Ties go to the neutral tone: nothing is gained by keeping the leftover.
    if (sc1.colorMse(alt.order, alt.starts) <= sc0.colorMse(best.order, best.starts) + 1e-9) {
      relief = neutral;
      sc0 = sc1;
      best = alt;
    }
  }

  if (params.options.tone && !colorMode && n >= 1) {
    for (let round = 0; round < 2 && performance.now() < deadline; round++) {
      const order = best.order;
      let seedStarts = best.starts;
      let roundBest = { relief, choice: best };
      for (const invert of [relief.invert, !relief.invert]) {
        if (performance.now() > deadline) break;
        const f = (v: number[]) => {
          const tone = fromVec(v);
          const r: ReliefParams = { ...relief, ...tone, invert };
          const sc = scorerFor(r);
          const d = descend(sc, order, quantileOr(seedStarts, sc, lo, hi, n), lo, hi, 4);
          evaluations += sc.evaluations;
          if (d.err < roundBest.choice.err - 1e-12) {
            roundBest = { relief: r, choice: { order, starts: d.starts, err: d.err } };
            seedStarts = d.starts;
          }
          return d.err;
        };
        const start = invert === relief.invert ? toVec(relief) : toVec({ contrast: 1, brightness: 0, gamma: 1 });
        nelderMead(f, start, [0.35, 0.12, 0.35], 60, deadline);
      }
      relief = roundBest.relief;
      // Re-search order + starts at the new tone.
      sc0 = scorerFor(relief);
      best = searchStack(sc0, model, n, roundBest.choice, params.options.reorder, deadline);
      evaluations += sc0.evaluations;
    }
  }

  const outStack = best.order.map((fi, j) => ({ ...stack[fi], startLayer: best.starts[j] }));
  return {
    relief: roundTone(relief),
    stack: outStack,
    errorBefore: toRms(before),
    errorAfter: toRms(sc0.colorMse(best.order, best.starts)),
    evaluations,
    ms: performance.now() - t0,
  };
}

/** Seed starts for a new relief: the current ones, or the quantile spread if better. */
function quantileOr(seed: number[], sc: Scorer, lo: number, hi: number, n: number): number[] {
  return seed.length === n ? seed : quantileStarts(n, sc.hist, lo, hi);
}

function roundTone(r: ReliefParams): ReliefParams {
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return { ...r, contrast: r3(r.contrast), brightness: r3(r.brightness), gamma: r3(r.gamma) };
}
