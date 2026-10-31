import type { ReliefParams } from '@huecraft/project-schema';

/** Plain RGBA image (sRGB, straight alpha). */
export interface RgbaImage {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

/**
 * Two float channels derived once from the source image:
 * - `luma`: sRGB luma premultiplied by alpha, in [0, 1].
 * - `alpha`: coverage in [0, 1].
 * Keeping luma premultiplied makes area averaging of partially transparent
 * pixels correct; `reliefField` divides it back out.
 */
export interface LumaAlpha {
  width: number;
  height: number;
  luma: Float32Array;
  alpha: Float32Array;
}

export interface GridSize {
  width: number;
  height: number;
}

/**
 * Smoothing radii are expressed in pixels of a reference grid whose longest
 * edge is this many pixels. The radius is rescaled to the actual grid so the
 * physical blur is identical in a 320 px preview, a 640 px preview and the
 * full-resolution export.
 */
export const SMOOTHING_REFERENCE_EDGE = 640;

// Rec.709 luma weights applied to gamma-encoded sRGB values (Y', not linear Y).
// Luma tracks perceived lightness far better than linear luminance, which is
// what a lithophane-style relief wants, and it is linear in the encoded values
// so it can be computed before area averaging.
const KR = 0.2126 / 255;
const KG = 0.7152 / 255;
const KB = 0.0722 / 255;

/** Extract premultiplied luma + alpha from an RGBA image. O(pixels). */
export function extractLumaAlpha(img: RgbaImage): LumaAlpha {
  const n = img.width * img.height;
  const luma = new Float32Array(n);
  const alpha = new Float32Array(n);
  const src = img.rgba;
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const a = src[o + 3] / 255;
    alpha[i] = a;
    luma[i] = (KR * src[o] + KG * src[o + 1] + KB * src[o + 2]) * a;
  }
  return { width: img.width, height: img.height, luma, alpha };
}

/** Grid size for a preview: longest edge = maxEdge, never upscaled. */
export function previewGridSize(srcWidth: number, srcHeight: number, maxEdge: number): GridSize {
  const longest = Math.max(srcWidth, srcHeight);
  const edge = Math.max(2, Math.min(longest, Math.round(maxEdge)));
  const scale = edge / longest;
  return {
    width: Math.max(2, Math.round(srcWidth * scale)),
    height: Math.max(2, Math.round(srcHeight * scale)),
  };
}

/** Grid size for an export: one sample every `resolutionMm`, capped at the source width. */
export function exportGridSize(srcWidth: number, srcHeight: number, widthMm: number, resolutionMm: number): GridSize {
  const wanted = Math.round(widthMm / Math.max(1e-3, resolutionMm));
  const width = Math.max(2, Math.min(srcWidth, wanted));
  return { width, height: Math.max(2, Math.round((width * srcHeight) / srcWidth)) };
}

interface AxisWeights {
  /** Per output sample: first index into src/w arrays (length outCount + 1). */
  start: Int32Array;
  src: Int32Array;
  w: Float32Array;
}

/** Box-filter weights mapping `inCount` samples onto `outCount` (area coverage, normalised). */
function axisWeights(inCount: number, outCount: number): AxisWeights {
  const scale = inCount / outCount;
  // Each output covers at most ceil(scale) + 1 inputs.
  const cap = outCount * (Math.ceil(scale) + 2);
  const start = new Int32Array(outCount + 1);
  const src = new Int32Array(cap);
  const w = new Float32Array(cap);
  let k = 0;
  for (let o = 0; o < outCount; o++) {
    start[o] = k;
    const a = o * scale;
    const b = (o + 1) * scale;
    if (scale <= 1) {
      // Upsampling (or 1:1): nearest sample, an area filter degenerates to it.
      src[k] = Math.min(inCount - 1, Math.floor((a + b) / 2));
      w[k++] = 1;
      continue;
    }
    const i0 = Math.floor(a);
    const i1 = Math.min(inCount, Math.ceil(b));
    const inv = 1 / (b - a);
    for (let i = i0; i < i1; i++) {
      const cover = Math.min(b, i + 1) - Math.max(a, i);
      if (cover <= 0) continue;
      src[k] = i;
      w[k++] = cover * inv;
    }
  }
  start[outCount] = k;
  return { start, src, w };
}

/**
 * Area-average (box filter) resample of the luma/alpha channels to `size`.
 * Separable: horizontal pass then vertical pass, O(in + out) per row/column.
 */
export function resizeLumaAlpha(input: LumaAlpha, size: GridSize): LumaAlpha {
  const { width: iw, height: ih } = input;
  const { width: ow, height: oh } = size;
  if (iw === ow && ih === oh) {
    return { width: ow, height: oh, luma: input.luma.slice(), alpha: input.alpha.slice() };
  }
  const hx = axisWeights(iw, ow);
  const hy = axisWeights(ih, oh);
  // Horizontal pass: ih rows × ow columns.
  const tmpL = new Float32Array(ow * ih);
  const tmpA = new Float32Array(ow * ih);
  const inL = input.luma;
  const inA = input.alpha;
  for (let y = 0; y < ih; y++) {
    const row = y * iw;
    const orow = y * ow;
    for (let x = 0; x < ow; x++) {
      let sl = 0;
      let sa = 0;
      for (let k = hx.start[x], e = hx.start[x + 1]; k < e; k++) {
        const i = row + hx.src[k];
        const wk = hx.w[k];
        sl += inL[i] * wk;
        sa += inA[i] * wk;
      }
      tmpL[orow + x] = sl;
      tmpA[orow + x] = sa;
    }
  }
  // Vertical pass: accumulate whole rows so memory access stays sequential.
  const luma = new Float32Array(ow * oh);
  const alpha = new Float32Array(ow * oh);
  for (let y = 0; y < oh; y++) {
    const orow = y * ow;
    for (let k = hy.start[y], e = hy.start[y + 1]; k < e; k++) {
      const srow = hy.src[k] * ow;
      const wk = hy.w[k];
      for (let x = 0; x < ow; x++) {
        luma[orow + x] += tmpL[srow + x] * wk;
        alpha[orow + x] += tmpA[srow + x] * wk;
      }
    }
  }
  return { width: ow, height: oh, luma, alpha };
}

/** Smoothing radius in pixels of a grid, see SMOOTHING_REFERENCE_EDGE. */
export function smoothingRadiusForGrid(smoothing: number, size: GridSize): number {
  if (!(smoothing > 0)) return 0;
  return Math.round((smoothing * Math.max(size.width, size.height)) / SMOOTHING_REFERENCE_EDGE);
}

/**
 * Relief parameter t in [0, 1] per grid pixel.
 * luma → +brightness → contrast around 0.5 → clamp → gamma → optional invert
 * → × alpha (transparent = 0, i.e. base only) → optional box blur
 * → optional posterize into `posterize` flat steps.
 */
export function reliefField(input: LumaAlpha, relief: ReliefParams): Float32Array {
  const { width, height, luma, alpha } = input;
  const n = width * height;
  const out = new Float32Array(n);
  const brightness = Number.isFinite(relief.brightness) ? relief.brightness : 0;
  const contrast = Number.isFinite(relief.contrast) ? relief.contrast : 1;
  const gamma = relief.gamma > 0 ? relief.gamma : 1;
  const invert = !!relief.invert;
  // Quantise the non-linear transfer into a LUT: 4096 steps is far below one layer.
  const LUT_SIZE = 4096;
  const lut = new Float32Array(LUT_SIZE + 1);
  for (let i = 0; i <= LUT_SIZE; i++) {
    let v = i / LUT_SIZE + brightness;
    v = (v - 0.5) * contrast + 0.5;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    if (gamma !== 1) v = Math.pow(v, gamma);
    lut[i] = invert ? 1 - v : v;
  }
  for (let i = 0; i < n; i++) {
    const a = alpha[i];
    if (a <= 1e-4) {
      out[i] = 0;
      continue;
    }
    let l = luma[i] / a;
    l = l < 0 ? 0 : l > 1 ? 1 : l;
    out[i] = lut[(l * LUT_SIZE + 0.5) | 0] * (a > 1 ? 1 : a);
  }
  const r = smoothingRadiusForGrid(relief.smoothing, input);
  if (r > 0) boxBlur(out, width, height, r);
  const steps = Math.floor(relief.posterize ?? 0);
  if (steps >= 2) {
    const s = steps - 1;
    for (let i = 0; i < n; i++) out[i] = Math.round(out[i] * s) / s;
  }
  return out;
}

/** In-place separable box blur with clamped edges. O(pixels), independent of radius. */
export function boxBlur(data: Float32Array, width: number, height: number, radius: number): void {
  const r = Math.max(0, Math.floor(radius));
  if (r === 0) return;
  const tmp = new Float32Array(Math.max(width, height));
  const inv = 1 / (2 * r + 1);
  // Horizontal.
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += data[row + clampIndex(k, width)];
    for (let x = 0; x < width; x++) {
      tmp[x] = acc * inv;
      acc += data[row + clampIndex(x + r + 1, width)] - data[row + clampIndex(x - r, width)];
    }
    data.set(tmp.subarray(0, width), row);
  }
  // Vertical.
  for (let x = 0; x < width; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += data[clampIndex(k, height) * width + x];
    for (let y = 0; y < height; y++) {
      tmp[y] = acc * inv;
      acc += data[clampIndex(y + r + 1, height) * width + x] - data[clampIndex(y - r, height) * width + x];
    }
    for (let y = 0; y < height; y++) data[y * width + x] = tmp[y];
  }
}

function clampIndex(i: number, n: number): number {
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}
