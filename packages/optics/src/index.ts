/**
 * Optics for filament paintings.
 *
 * Model: a print is a column of layers. Layer k has a filament (global for the
 * whole print, set by the stack) and a thickness. Seen from the top, each layer
 * hides a fraction `a = 1 - exp(-t * ln(20) / TD)` of what lies below it, so a
 * layer as thick as the filament's transmission distance (TD) hides ~95 % of the
 * colour underneath — the HueForge TD convention. Colours are blended in linear
 * light. Because the colour of a column depends only on how many layers it has,
 * every colour is precomputed once per layer count (a LUT).
 */

const LN20 = Math.log(20);

export interface LayerFilament {
  colorHex: string;
  /** Transmission distance in mm (HueForge semantics). <= 0 means fully opaque. */
  tdMm: number;
}

/** Layer geometry needed to turn heights into layer counts. */
export interface LayerModel {
  firstLayerHeightMm: number;
  layerHeightMm: number;
  baseThicknessMm: number;
  maxHeightMm: number;
  /** Minimum layer count of any column (the solid base). */
  baseLayers: number;
  /** Maximum layer count of any column. */
  totalLayers: number;
}

/**
 * Fraction of the colour below that is still visible through a layer of
 * `thicknessMm` of a filament with transmission distance `tdMm`.
 * 0.05 at thickness = TD; 0 for opaque filament (TD <= 0).
 */
export function transmissionFactor(tdMm: number, thicknessMm: number): number {
  if (!(tdMm > 0)) return 0;
  return Math.exp((-thicknessMm * LN20) / tdMm);
}

/** Fraction of the colour below hidden by one layer (1 - transmissionFactor). */
export function layerOpacity(tdMm: number, thicknessMm: number): number {
  return 1 - transmissionFactor(tdMm, thicknessMm);
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Parse #rgb / #rrggbb (case-insensitive, '#' optional). Invalid input → black. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = (hex ?? '').trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n) || h.length < 6) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * Printed colour for every layer count n (index n, RGB bytes, length (total + 1) * 3).
 * `layers[k]` is the filament of layer k, `thicknessOf(k)` its thickness in mm.
 * The first layer is the base seen from the top (not backlit), so the stack starts
 * fully at the colour of layer 0's filament. Index 0 (no material) repeats it.
 */
export function buildPrintedLut(layers: LayerFilament[], thicknessOf: (k: number) => number): Uint8Array {
  const total = layers.length;
  const lut = new Uint8Array((total + 1) * 3);
  if (total === 0) return lut;
  const lin = layers.map((f) => hexToRgb(f.colorHex).map((v) => srgbToLinear(v / 255)) as [number, number, number]);
  let r = lin[0][0];
  let g = lin[0][1];
  let b = lin[0][2];
  const write = (n: number) => {
    lut[n * 3] = Math.round(linearToSrgb(r) * 255);
    lut[n * 3 + 1] = Math.round(linearToSrgb(g) * 255);
    lut[n * 3 + 2] = Math.round(linearToSrgb(b) * 255);
  };
  write(0);
  write(1);
  for (let k = 1; k < total; k++) {
    const a = layerOpacity(layers[k].tdMm, thicknessOf(k));
    const f = lin[k];
    r = r * (1 - a) + f[0] * a;
    g = g * (1 - a) + f[1] * a;
    b = b * (1 - a) + f[2] * a;
    write(k + 1);
  }
  return lut;
}

/** Slicer colour per layer count: exactly the hex of the top layer's filament. */
export function buildSlicerLut(layers: LayerFilament[]): Uint8Array {
  const total = layers.length;
  const lut = new Uint8Array((total + 1) * 3);
  for (let n = 0; n <= total; n++) {
    const f = layers[Math.max(0, Math.min(total - 1, n - 1))];
    if (!f) continue;
    const [r, g, b] = hexToRgb(f.colorHex);
    lut[n * 3] = r;
    lut[n * 3 + 1] = g;
    lut[n * 3 + 2] = b;
  }
  return lut;
}

/** Column height in mm for relief parameter t in [0, 1]. */
export function heightForRelief(t: number, model: LayerModel): number {
  return model.baseThicknessMm + t * (model.maxHeightMm - model.baseThicknessMm);
}

/**
 * Layer count of a column of height `h`, as the slicer will print it: the slicer
 * cuts each layer at its mid-plane, so layer k exists when z_mid(k) < h, with
 * z_mid(0) = first / 2 and z_mid(k) = first + (k - 0.5) * layer. Clamped to
 * [baseLayers, totalLayers].
 */
export function layerCountForHeight(h: number, model: LayerModel): number {
  const first = model.firstLayerHeightMm;
  let n: number;
  if (h <= first / 2) n = 0;
  else {
    const x = (h - first) / model.layerHeightMm + 0.5;
    n = 1 + Math.max(0, Math.ceil(x - 1e-9) - 1);
  }
  return n < model.baseLayers ? model.baseLayers : n > model.totalLayers ? model.totalLayers : n;
}

/** Layer count per pixel from a relief field. */
export function computeLayerField(t: Float32Array, model: LayerModel): Uint16Array {
  const out = new Uint16Array(t.length);
  // Map t through a fine LUT: 8192 steps is far finer than a layer.
  const STEPS = 8192;
  const lut = new Uint16Array(STEPS + 1);
  for (let i = 0; i <= STEPS; i++) lut[i] = layerCountForHeight(heightForRelief(i / STEPS, model), model);
  for (let i = 0; i < t.length; i++) {
    const v = t[i];
    out[i] = lut[((v < 0 ? 0 : v > 1 ? 1 : v) * STEPS + 0.5) | 0];
  }
  return out;
}

/**
 * Nozzle detail limit: features narrower than one extrusion line cannot be
 * printed, so the relief is averaged over blocks of `factor` × `factor` pixels
 * (≈ one line width), quantised to layers, and expanded back (nearest).
 */
export function computeLineLimitedLayerField(
  t: Float32Array,
  width: number,
  height: number,
  factor: number,
  model: LayerModel,
): Uint16Array {
  const f = Math.max(1, Math.round(factor));
  if (f <= 1) return computeLayerField(t, model);
  const cw = Math.ceil(width / f);
  const ch = Math.ceil(height / f);
  const sums = new Float32Array(cw * ch);
  const counts = new Uint32Array(cw * ch);
  for (let y = 0; y < height; y++) {
    const crow = ((y / f) | 0) * cw;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const c = crow + ((x / f) | 0);
      sums[c] += t[row + x];
      counts[c]++;
    }
  }
  for (let i = 0; i < sums.length; i++) sums[i] /= counts[i] || 1;
  const coarse = computeLayerField(sums, model);
  const out = new Uint16Array(width * height);
  for (let y = 0; y < height; y++) {
    const crow = ((y / f) | 0) * cw;
    const row = y * width;
    for (let x = 0; x < width; x++) out[row + x] = coarse[crow + ((x / f) | 0)];
  }
  return out;
}

/** Pixel count per layer count (length totalLayers + 1). */
export function layerHistogram(field: Uint16Array, totalLayers: number): Uint32Array {
  const hist = new Uint32Array(totalLayers + 1);
  for (let i = 0; i < field.length; i++) {
    const n = field[i];
    hist[n > totalLayers ? totalLayers : n]++;
  }
  return hist;
}

/** Expand a layer field through an RGB LUT into an opaque RGBA image. */
export function layerFieldToRgba(field: Uint16Array, lut: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(field.length * 4);
  // Pack the LUT as little-endian RGBA words so the hot loop is one store per pixel.
  const entries = lut.length / 3;
  const packed = new Uint32Array(entries);
  for (let n = 0; n < entries; n++) {
    packed[n] = (255 << 24) | (lut[n * 3 + 2] << 16) | (lut[n * 3 + 1] << 8) | lut[n * 3];
  }
  const words = new Uint32Array(out.buffer, out.byteOffset, field.length);
  const last = entries - 1;
  for (let i = 0; i < field.length; i++) {
    const n = field[i];
    words[i] = packed[n > last ? last : n];
  }
  return out;
}
