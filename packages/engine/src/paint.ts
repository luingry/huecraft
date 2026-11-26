import { layerTopZ, type PaintStroke, type StackEntry } from '@huecraft/project-schema';
import { heightForRelief, layerCountForHeight, type LayerModel } from '@huecraft/optics';
import { normalizeStack } from './stack.js';

/**
 * Layer count a painted filament reaches: the top of its band, where it is the
 * last filament printed. The top filament goes to the full height.
 */
export function paintTargetLayer(stack: StackEntry[], slotId: string, totalLayers: number): number | null {
  const sorted = normalizeStack(stack);
  const i = sorted.findIndex((e) => e.slotId === slotId);
  if (i < 0) return null;
  const next = sorted.slice(i + 1).find((e) => e.startLayer > sorted[i].startLayer);
  const top = next ? next.startLayer : totalLayers;
  return Math.max(1, Math.min(totalLayers, top));
}

/** Re-targets every stroke to its filament's current band (strokes whose slot is gone keep their layer). */
export function resolvePaintLayers(paint: PaintStroke[] | undefined, stack: StackEntry[], totalLayers: number): PaintStroke[] {
  if (!paint || paint.length === 0) return [];
  return paint.map((s) => {
    const layer = s.mode === 'paint' && s.kind !== 'select' ? paintTargetLayer(stack, s.slotId, totalLayers) : null;
    return layer === null || layer === s.layer ? s : { ...s, layer };
  });
}

/** Relief value whose column is exactly `layer` layers tall (the plateau top). */
function reliefForLayer(layer: number, model: LayerModel): number {
  const z = layerTopZ(model, Math.max(0, layer - 1));
  const t = (z - model.baseThicknessMm) / (model.maxHeightMm - model.baseThicknessMm);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function signature(s: PaintStroke): string {
  return `${s.id}:${s.points.length}:${s.mode}:${s.blend ?? 'normal'}:${s.layer}:${s.radius}:${s.softness}:${s.opacity}:${s.sampleLayer ?? ''}:${s.tolerance ?? ''}:${s.kind ?? ''}:${s.contiguous ?? ''}:${s.selectOp ?? ''}`;
}

/** What colour-aware blends need: the layer geometry and the printed colour per layer count. */
export interface PaintContext {
  model: LayerModel;
  /** Printed RGB per layer count (index n), as the preview shows it. */
  colors: Uint8Array;
  /**
   * Side in pixels of the blocks the view averages to simulate the line width
   * (1 / missing = per pixel). Colour blends judge each block by the colour it
   * shows, so a small area that looks like the sampled colour is painted whole.
   */
  cell?: number;
}

// Same quantisation as computeLayerField, so blends see the layers the preview shows.
const RELIEF_STEPS = 8192;
// Amount steps of the brighten / darken lookup (coverage × opacity, 0..1).
const TONE_STEPS = 64;
// Cost of moving across the whole printable range, as a fraction of its luminance range:
// among layers with about the right colour, brighten / darken prefer the nearest height.
const TONE_DISTANCE = 0.25;

function luminance(c: Uint8Array, n: number): number {
  return 0.2126 * c[n * 3] + 0.7152 * c[n * 3 + 1] + 0.0722 * c[n * 3 + 2];
}

/** RGB distance of two layer colours, 0..1. */
function colorDistance(c: Uint8Array, a: number, b: number): number {
  const dr = c[a * 3] - c[b * 3];
  const dg = c[a * 3 + 1] - c[b * 3 + 1];
  const db = c[a * 3 + 2] - c[b * 3 + 2];
  return Math.sqrt(dr * dr + dg * dg + db * db) / 441.7;
}

/**
 * Relief with strokes applied one after another. Each stroke moves the current
 * relief towards its target by coverage × opacity; erasing moves it back towards
 * the unpainted `base`. Blends decide per column whether the stroke applies,
 * judged on the surface as it was before the stroke:
 * - raise / lower: only columns below / above the target height;
 * - onLight / onDark: only colours lighter / darker than the brush colour
 *   (Photoshop's Darken / Lighten);
 * - sampled: only colours close to the one under the brush when the stroke began.
 * Brighten / darken strokes have no target: each column moves to the layer whose
 * colour is closest to its own luminance ± coverage × opacity × the printable
 * luminance range (only lighter / darker layers, the nearest height on ties).
 * Fill strokes cover the colour at their seed (see `region`); select strokes
 * only change `selection`, which clips every stroke applied after them.
 */
export class PaintCanvas {
  readonly current: Float32Array;
  readonly sigs: string[] = [];
  /** Selected columns (1) while a selection exists; strokes only touch these. */
  selection: Uint8Array | null = null;
  private cov: Float32Array;
  /** Layer shown per pixel (line-width blocks applied); cleared when the surface changes. */
  private shownCache: Uint16Array | null = null;
  /** Layer count per quantised relief value. */
  private layerOf: Uint16Array;
  /** Relief of each layer count's plateau top. */
  private reliefTop: Float32Array;
  private toneTables = new Map<number, Uint16Array>();

  constructor(
    readonly base: Float32Array,
    readonly width: number,
    readonly height: number,
    readonly ctx: PaintContext,
  ) {
    this.current = base.slice();
    this.cov = new Float32Array(width * height);
    this.layerOf = new Uint16Array(RELIEF_STEPS + 1);
    for (let i = 0; i <= RELIEF_STEPS; i++) {
      this.layerOf[i] = layerCountForHeight(heightForRelief(i / RELIEF_STEPS, ctx.model), ctx.model);
    }
    this.reliefTop = new Float32Array(ctx.colors.length / 3);
    for (let n = 0; n < this.reliefTop.length; n++) this.reliefTop[n] = reliefForLayer(n, ctx.model);
  }

  /**
   * Brighten (dir 1) / darken (dir -1) lookup: entry n × (TONE_STEPS + 1) + k is
   * the layer count a column showing layer n moves to with amount k / TONE_STEPS.
   */
  private toneTable(dir: 1 | -1): Uint16Array {
    let table = this.toneTables.get(dir);
    if (table) return table;
    const { colors } = this.ctx;
    const maxN = colors.length / 3 - 1;
    const lo = Math.min(maxN, this.layerOf[0]);
    const hi = Math.min(maxN, this.layerOf[RELIEF_STEPS]);
    let minL = Infinity;
    let maxL = -Infinity;
    for (let m = lo; m <= hi; m++) {
      const l = luminance(colors, m);
      if (l < minL) minL = l;
      if (l > maxL) maxL = l;
    }
    const range = maxL - minL;
    const perLayer = hi > lo ? (TONE_DISTANCE * range) / (hi - lo) : 0;
    table = new Uint16Array((maxN + 1) * (TONE_STEPS + 1));
    for (let n = 0; n <= maxN; n++) {
      const l = luminance(colors, n);
      for (let k = 0; k <= TONE_STEPS; k++) {
        const goal = l + (dir * range * k) / TONE_STEPS;
        let best = n;
        let bestCost = Math.abs(goal - l);
        for (let m = lo; m <= hi; m++) {
          const lm = luminance(colors, m);
          if (dir * (lm - l) <= 0) continue;
          const cost = Math.abs(goal - lm) + perLayer * Math.abs(m - n);
          if (cost < bestCost) {
            bestCost = cost;
            best = m;
          }
        }
        table[n * (TONE_STEPS + 1) + k] = best;
      }
    }
    this.toneTables.set(dir, table);
    return table;
  }

  clone(): PaintCanvas {
    const c = new PaintCanvas(this.base, this.width, this.height, this.ctx);
    c.current.set(this.current);
    c.sigs.push(...this.sigs);
    c.selection = this.selection ? this.selection.slice() : null;
    return c;
  }

  /** True when the strokes already applied are the first strokes of `strokes`. */
  isPrefixOf(strokes: PaintStroke[]): boolean {
    if (this.sigs.length > strokes.length) return false;
    for (let i = 0; i < this.sigs.length; i++) if (this.sigs[i] !== signature(strokes[i])) return false;
    return true;
  }

  apply(stroke: PaintStroke): void {
    this.sigs.push(signature(stroke));
    if (stroke.kind === 'select') {
      this.select(stroke);
      return;
    }
    if (stroke.kind === 'fill') {
      this.fillInto(stroke, this.current);
      return;
    }
    if (stroke.points.length < 2 || !(stroke.opacity > 0)) return;
    const box = rasterizeStroke(stroke, this.width, this.height, this.cov, 0, null);
    if (box) this.paintInto(stroke, this.cov, box, this.current, true);
  }

  /**
   * Writes `stroke` with coverage `cov` inside `box` into `out`, judged on this
   * canvas's surface (the surface before the stroke). `out` may be `current`.
   * `consume` zeroes the coverage it reads, leaving `cov` clean for the next stroke.
   */
  paintInto(stroke: PaintStroke, cov: Float32Array, box: StrokeBox, out: Float32Array, consume: boolean): void {
    if (out === this.current) this.shownCache = null;
    const sel = this.selection;
    const { model, colors } = this.ctx;
    const { width: w, height: h, current, base } = this;
    const { x0, y0, x1, y1 } = box;
    const op = Math.min(1, stroke.opacity);
    const target = reliefForLayer(stroke.layer, model);
    const erase = stroke.mode === 'erase';
    const tone = stroke.mode === 'brighten' ? 1 : stroke.mode === 'darken' ? -1 : 0;
    const toneTable = tone ? this.toneTable(tone) : null;
    const reliefTop = this.reliefTop;
    const blend = erase || tone ? 'normal' : (stroke.blend ?? 'normal');
    const maxN = colors.length / 3 - 1;
    const targetN = Math.min(maxN, Math.max(0, stroke.layer));
    const targetLum = luminance(colors, targetN);
    const sampleN = Math.min(maxN, Math.max(0, stroke.sampleLayer ?? targetN));
    const tolerance = stroke.tolerance ?? (blend === 'sampled' ? 0.15 : 0);
    // onLight / onDark: how much lighter / darker than the brush a colour must be.
    const margin = tolerance * 255;
    const layerOf = this.layerOf;
    const colorBlend = blend === 'onLight' || blend === 'onDark' || blend === 'sampled';
    // Layer shown by each line-width block of the stroke's box, from the surface before the stroke.
    const f = colorBlend || toneTable ? Math.max(1, Math.round(this.ctx.cell ?? 1)) : 1;
    const cx0 = (x0 / f) | 0;
    const cy0 = (y0 / f) | 0;
    const cw = ((x1 / f) | 0) - cx0 + 1;
    let cellLayer: Uint16Array | null = null;
    if (f > 1) {
      const chh = ((y1 / f) | 0) - cy0 + 1;
      cellLayer = new Uint16Array(cw * chh);
      for (let cy = 0; cy < chh; cy++) {
        const ya = (cy0 + cy) * f;
        const yb = Math.min(h, ya + f);
        for (let cx = 0; cx < cw; cx++) {
          const xa = (cx0 + cx) * f;
          const xb = Math.min(w, xa + f);
          let sum = 0;
          for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) sum += current[y * w + x];
          const avg = sum / ((yb - ya) * (xb - xa));
          cellLayer[cy * cw + cx] = layerOf[((avg < 0 ? 0 : avg > 1 ? 1 : avg) * RELIEF_STEPS + 0.5) | 0];
        }
      }
    }
    for (let y = y0; y <= y1; y++) {
      const row = y * w;
      for (let x = x0; x <= x1; x++) {
        const i = row + x;
        const c = cov[i];
        if (c <= 0) continue;
        if (consume) cov[i] = 0;
        if (sel && !sel[i]) continue;
        const cur = current[i];
        // Layer the column shows (only the colour-aware strokes need it).
        const n = !toneTable && !colorBlend ? 0 : Math.min(maxN, cellLayer
          ? cellLayer[(((y / f) | 0) - cy0) * cw + (((x / f) | 0) - cx0)]
          : layerOf[((cur < 0 ? 0 : cur > 1 ? 1 : cur) * RELIEF_STEPS + 0.5) | 0]);
        if (toneTable) {
          const m = toneTable[n * (TONE_STEPS + 1) + ((c * op * TONE_STEPS + 0.5) | 0)];
          if (m !== n) out[i] = reliefTop[m];
          continue;
        }
        const goal = erase ? base[i] : target;
        if ((blend === 'raise' && goal <= cur) || (blend === 'lower' && goal >= cur)) continue;
        if (colorBlend) {
          if (blend === 'onLight' ? luminance(colors, n) - targetLum <= margin
            : blend === 'onDark' ? targetLum - luminance(colors, n) <= margin
            : colorDistance(colors, n, sampleN) > tolerance) continue;
        }
        out[i] = cur + (goal - cur) * c * op;
      }
    }
  }

  /** Layer count each pixel shows, judged like the colour blends (per line-width block). */
  private shownLayers(): Uint16Array {
    if (this.shownCache) return this.shownCache;
    const { width: w, height: h, current, layerOf } = this;
    const maxN = this.ctx.colors.length / 3 - 1;
    const f = Math.max(1, Math.round(this.ctx.cell ?? 1));
    const out = new Uint16Array(w * h);
    const q = (v: number) => Math.min(maxN, layerOf[((v < 0 ? 0 : v > 1 ? 1 : v) * RELIEF_STEPS + 0.5) | 0]);
    if (f === 1) {
      for (let i = 0; i < out.length; i++) out[i] = q(current[i]);
    } else {
      for (let ya = 0; ya < h; ya += f) {
        const yb = Math.min(h, ya + f);
        for (let xa = 0; xa < w; xa += f) {
          const xb = Math.min(w, xa + f);
          let sum = 0;
          for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) sum += current[y * w + x];
          const n = q(sum / ((yb - ya) * (xb - xa)));
          for (let y = ya; y < yb; y++) out.fill(n, y * w + xa, y * w + xb);
        }
      }
    }
    this.shownCache = out;
    return out;
  }

  /**
   * Pixels whose shown colour is within `stroke.tolerance` (colour distance,
   * default 0.15) of the colour at the seed points[0..1]: only those connected
   * to the seed (4-neighbours) unless `contiguous` is false. Never leaves `within`.
   */
  region(stroke: PaintStroke, within: Uint8Array | null): Uint8Array {
    const { width: w, height: h } = this;
    const out = new Uint8Array(w * h);
    const pts = stroke.points;
    if (pts.length < 2) return out;
    const sx = Math.min(w - 1, Math.max(0, Math.floor(pts[0] * w)));
    const sy = Math.min(h - 1, Math.max(0, Math.floor(pts[1] * h)));
    const seed = sy * w + sx;
    if (within && !within[seed]) return out;
    const shown = this.shownLayers();
    const { colors } = this.ctx;
    const tol = stroke.tolerance ?? 0.15;
    const match = new Uint8Array(colors.length / 3);
    for (let n = 0; n < match.length; n++) match[n] = colorDistance(colors, n, shown[seed]) <= tol + 1e-6 ? 1 : 0;
    if (stroke.contiguous === false) {
      for (let i = 0; i < out.length; i++) if (match[shown[i]] && (!within || within[i])) out[i] = 1;
      return out;
    }
    // Pixels are marked when pushed, so the stack never holds one twice.
    const stack = new Int32Array(w * h);
    let top = 0;
    out[seed] = 1;
    stack[top++] = seed;
    while (top > 0) {
      const i = stack[--top];
      const x = i % w;
      for (let k = 0; k < 4; k++) {
        const j = k === 0 ? (x > 0 ? i - 1 : -1) : k === 1 ? (x < w - 1 ? i + 1 : -1) : k === 2 ? i - w : i + w;
        if (j < 0 || j >= out.length || out[j] || !match[shown[j]] || (within && !within[j])) continue;
        out[j] = 1;
        stack[top++] = j;
      }
    }
    return out;
  }

  /** Combines the area a select stroke picks into the selection. An empty selection is no selection. */
  private select(stroke: PaintStroke): void {
    const op = stroke.selectOp ?? 'replace';
    const cur = this.selection;
    let next: Uint8Array | null;
    if (op === 'clear') next = null;
    else if (op === 'invert') next = cur ? cur.map((v) => 1 - v) : null;
    else if (op === 'subtract') {
      if (!cur) return;
      const r = this.region(stroke, cur);
      next = cur.map((v, i) => v & (1 - r[i]));
    } else {
      const r = this.region(stroke, null);
      next = op === 'add' && cur ? r.map((v, i) => v | cur[i]) : r;
    }
    this.selection = next && next.includes(1) ? next : null;
  }

  /** Paint bucket: `stroke` (paint / erase, normal blend) over its region, inside the selection. */
  fillInto(stroke: PaintStroke, out: Float32Array): void {
    if (!(stroke.opacity > 0)) return;
    const w = this.width;
    const reg = this.region(stroke, this.selection);
    let box: StrokeBox | null = null;
    for (let i = 0; i < reg.length; i++) {
      if (!reg[i]) continue;
      this.cov[i] = 1;
      const x = i % w;
      const y = (i / w) | 0;
      if (!box) box = { x0: x, y0: y, x1: x, y1: y };
      else {
        if (x < box.x0) box.x0 = x;
        if (x > box.x1) box.x1 = x;
        box.y1 = y;
      }
    }
    if (box) this.paintInto({ ...stroke, kind: 'brush', blend: 'normal' }, this.cov, box, out, true);
  }

  /** Copy of the painted relief. */
  composite(): Float32Array {
    return this.current.slice();
  }
}

/** Pixel bounds (inclusive) a stroke's coverage touches. */
export interface StrokeBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Coverage of a stroke = max over its segments (capsules), so overlapping
 * parts of one stroke never build up past its opacity. Rasterises segments
 * from `from` on into `cov` and returns `box` grown to cover them (null if
 * nothing is covered yet).
 */
function rasterizeStroke(stroke: PaintStroke, w: number, h: number, cov: Float32Array, from: number, box: StrokeBox | null): StrokeBox | null {
  const pts = stroke.points;
  const r = Math.max(0.5, stroke.radius * w);
  const inner = r * (1 - Math.min(1, Math.max(0, stroke.softness)));
  const feather = r - inner;
  const n = pts.length >> 1;
  for (let k = from; k < n; k++) {
    const ax = pts[k * 2] * w;
    const ay = pts[k * 2 + 1] * h;
    const bx = k + 1 < n ? pts[k * 2 + 2] * w : ax;
    const by = k + 1 < n ? pts[k * 2 + 3] * h : ay;
    if (k + 1 >= n && n > 1) break;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const sx0 = Math.max(0, Math.floor(Math.min(ax, bx) - r));
    const sy0 = Math.max(0, Math.floor(Math.min(ay, by) - r));
    const sx1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r));
    const sy1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r));
    if (sx0 > sx1 || sy0 > sy1) continue;
    if (!box) box = { x0: sx0, y0: sy0, x1: sx1, y1: sy1 };
    else {
      if (sx0 < box.x0) box.x0 = sx0;
      if (sy0 < box.y0) box.y0 = sy0;
      if (sx1 > box.x1) box.x1 = sx1;
      if (sy1 > box.y1) box.y1 = sy1;
    }
    for (let y = sy0; y <= sy1; y++) {
      const py = y + 0.5;
      const row = y * w;
      for (let x = sx0; x <= sx1; x++) {
        const px = x + 0.5;
        let u = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const ex = px - (ax + u * dx);
        const ey = py - (ay + u * dy);
        const d = Math.sqrt(ex * ex + ey * ey);
        if (d >= r) continue;
        let c = 1;
        if (d > inner) {
          const s = 1 - (d - inner) / feather;
          c = s * s * (3 - 2 * s);
        }
        if (c > cov[row + x]) cov[row + x] = c;
      }
    }
  }
  return box;
}

/**
 * The stroke being drawn, painted over a canvas of the settled strokes. Its
 * coverage is kept between calls: while points are only appended, just the new
 * segments are rasterised, so a long stroke costs the same per update as a
 * short one. Gives exactly what PaintCanvas.apply would.
 */
export class LiveStroke {
  private readonly cov: Float32Array;
  private readonly out: Float32Array;
  private box: StrokeBox | null = null;
  private key = '';
  private points: number[] = [];

  constructor(readonly width: number, readonly height: number) {
    this.cov = new Float32Array(width * height);
    this.out = new Float32Array(width * height);
  }

  /** Relief of `canvas` with `stroke` painted on top. The array is reused by the next call. */
  render(canvas: PaintCanvas, stroke: PaintStroke): Float32Array {
    const pts = stroke.points;
    const key = `${stroke.id}:${stroke.radius}:${stroke.softness}`;
    let from = 0;
    if (key === this.key && this.points.length >= 2 && isPrefix(this.points, pts)) {
      // The last segment drawn ended at the previous last point; continue from there.
      from = (this.points.length >> 1) - 1;
    } else {
      this.cov.fill(0);
      this.box = null;
    }
    this.key = key;
    this.points = pts.slice();
    this.out.set(canvas.current);
    if (pts.length < 2 || !(stroke.opacity > 0)) return this.out;
    this.box = rasterizeStroke(stroke, this.width, this.height, this.cov, from, this.box);
    if (this.box) canvas.paintInto(stroke, this.cov, this.box, this.out, false);
    return this.out;
  }
}

function isPrefix(a: number[], b: number[]): boolean {
  if (a.length > b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Uncached: paints every stroke over `t` on a fresh canvas. */
export function applyPaint(t: Float32Array, width: number, height: number, strokes: PaintStroke[], ctx: PaintContext): Float32Array {
  if (strokes.length === 0) return t;
  const canvas = new PaintCanvas(t, width, height, ctx);
  for (const s of strokes) canvas.apply(s);
  return canvas.current;
}
