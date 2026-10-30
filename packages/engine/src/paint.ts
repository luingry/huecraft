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
    const layer = s.mode === 'paint' ? paintTargetLayer(stack, s.slotId, totalLayers) : null;
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
  return `${s.id}:${s.points.length}:${s.mode}:${s.blend ?? 'normal'}:${s.layer}:${s.radius}:${s.softness}:${s.opacity}:${s.sampleLayer ?? ''}:${s.tolerance ?? ''}`;
}

/** What colour-aware blends need: the layer geometry and the printed colour per layer count. */
export interface PaintContext {
  model: LayerModel;
  /** Printed RGB per layer count (index n), as the preview shows it. */
  colors: Uint8Array;
}

// Same quantisation as computeLayerField, so blends see the layers the preview shows.
const RELIEF_STEPS = 8192;

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
 */
export class PaintCanvas {
  readonly current: Float32Array;
  readonly sigs: string[] = [];
  private cov: Float32Array;
  /** Layer count per quantised relief value. */
  private layerOf: Uint16Array;

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
  }

  clone(): PaintCanvas {
    const c = new PaintCanvas(this.base, this.width, this.height, this.ctx);
    c.current.set(this.current);
    c.sigs.push(...this.sigs);
    return c;
  }

  /** True when the strokes already applied are the first strokes of `strokes`. */
  isPrefixOf(strokes: PaintStroke[]): boolean {
    if (this.sigs.length > strokes.length) return false;
    for (let i = 0; i < this.sigs.length; i++) if (this.sigs[i] !== signature(strokes[i])) return false;
    return true;
  }

  apply(stroke: PaintStroke): void {
    const { model, colors } = this.ctx;
    this.sigs.push(signature(stroke));
    const { width: w, height: h, cov, current, base } = this;
    const pts = stroke.points;
    if (pts.length < 2 || !(stroke.opacity > 0)) return;
    const r = Math.max(0.5, stroke.radius * w);
    const inner = r * (1 - Math.min(1, Math.max(0, stroke.softness)));
    const feather = r - inner;

    // Coverage of the whole stroke = max over its segments (capsules), so
    // overlapping parts of one stroke never build up past its opacity.
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    const n = pts.length >> 1;
    for (let k = 0; k < n; k++) {
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
      if (sx0 < x0) x0 = sx0;
      if (sy0 < y0) y0 = sy0;
      if (sx1 > x1) x1 = sx1;
      if (sy1 > y1) y1 = sy1;
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
    if (x1 < 0) return;

    const op = Math.min(1, stroke.opacity);
    const target = reliefForLayer(stroke.layer, model);
    const erase = stroke.mode === 'erase';
    const blend = erase ? 'normal' : (stroke.blend ?? 'normal');
    const maxN = colors.length / 3 - 1;
    const targetN = Math.min(maxN, Math.max(0, stroke.layer));
    const targetLum = luminance(colors, targetN);
    const sampleN = Math.min(maxN, Math.max(0, stroke.sampleLayer ?? targetN));
    const tolerance = stroke.tolerance ?? (blend === 'sampled' ? 0.15 : 0);
    // onLight / onDark: how much lighter / darker than the brush a colour must be.
    const margin = tolerance * 255;
    const layerOf = this.layerOf;
    const colorBlend = blend === 'onLight' || blend === 'onDark' || blend === 'sampled';
    for (let y = y0; y <= y1; y++) {
      const row = y * w;
      for (let x = x0; x <= x1; x++) {
        const i = row + x;
        const c = cov[i];
        if (c <= 0) continue;
        cov[i] = 0;
        const cur = current[i];
        const goal = erase ? base[i] : target;
        if ((blend === 'raise' && goal <= cur) || (blend === 'lower' && goal >= cur)) continue;
        if (colorBlend) {
          const n = Math.min(maxN, layerOf[((cur < 0 ? 0 : cur > 1 ? 1 : cur) * RELIEF_STEPS + 0.5) | 0]);
          if (blend === 'onLight' ? luminance(colors, n) - targetLum <= margin
            : blend === 'onDark' ? targetLum - luminance(colors, n) <= margin
            : colorDistance(colors, n, sampleN) > tolerance) continue;
        }
        current[i] = cur + (goal - cur) * c * op;
      }
    }
  }

  /** Copy of the painted relief. */
  composite(): Float32Array {
    return this.current.slice();
  }
}

/** Uncached: paints every stroke over `t` on a fresh canvas. */
export function applyPaint(t: Float32Array, width: number, height: number, strokes: PaintStroke[], ctx: PaintContext): Float32Array {
  if (strokes.length === 0) return t;
  const canvas = new PaintCanvas(t, width, height, ctx);
  for (const s of strokes) canvas.apply(s);
  return canvas.current;
}
