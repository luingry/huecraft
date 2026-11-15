/**
 * Colour-driven heights ("altura pela cor").
 *
 * The default relief derives each column's height from the pixel's luma, so
 * two different colours with the same brightness (red text over a dark-blue
 * background) always get the same layer count, hence the same printed colour.
 * Here each pixel instead picks the layer count whose *printed* colour (TD
 * model, current stack) is closest to the pixel's colour in OKLab, with a pull
 * towards the luma height so the relief stays coherent:
 *
 *   cost(n) = s · ΔE_ok(lut[n], pixel)² + (1 − s) · K · ((n − n_luma) / T)²
 *
 * `s` = ReliefParams.colorMatch in (0, 1]; s = 1 ignores luma entirely.
 */
import { srgbToLinear, type LayerModel } from '@huecraft/optics';
import type { TuneTarget } from './autotune.js';

/** Linear sRGB → OKLab, written at out[o..o+2]. */
export function linToOklab(r: number, g: number, b: number, out: { [i: number]: number }, o: number): void {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  out[o] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  out[o + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  out[o + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
}

/** Weight of the luma pull: a full-range deviation costs ΔE_ok ≈ 0.32 at s = 0.5. */
export const LUMA_PULL = 0.1;

/** OKLab of every entry of an sRGB byte LUT (3 per entry). */
export function lutToOklab(lut: Uint8Array): Float64Array {
  const n = lut.length / 3;
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    linToOklab(srgbToLinear(lut[i * 3] / 255), srgbToLinear(lut[i * 3 + 1] / 255), srgbToLinear(lut[i * 3 + 2] / 255), out, i * 3);
  }
  return out;
}

/** Relief value t whose column the slicer prints with exactly `n` layers (n ≥ baseLayers). */
export function reliefForCount(n: number, model: LayerModel): number {
  if (n <= 0) return 0;
  // A quarter layer below the top of layer n-1: safely between the mid-planes of n-1 and n.
  const top = n === 1 ? model.firstLayerHeightMm : model.firstLayerHeightMm + (n - 1) * model.layerHeightMm;
  const h = top - (n === 1 ? model.firstLayerHeightMm : model.layerHeightMm) / 4;
  const span = model.maxHeightMm - model.baseThicknessMm;
  const t = span > 0 ? (h - model.baseThicknessMm) / span : 0;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Relief field where each pixel takes the layer count of best colour match.
 * `lumaCounts` is the layer count the luma relief would give (the pull target);
 * transparent pixels keep `lumaT`.
 */
export function colorHeightField(
  target: TuneTarget,
  lumaT: Float32Array,
  lumaCounts: Uint16Array,
  lutLab: Float64Array,
  model: LayerModel,
  strength: number,
): Float32Array {
  const s = strength > 1 ? 1 : strength;
  const pull = ((1 - s) * LUMA_PULL) / Math.max(1, model.totalLayers) ** 2;
  const lo = model.baseLayers;
  const hi = model.totalLayers;
  const tOf = new Float32Array(hi + 1);
  for (let n = lo; n <= hi; n++) tOf[n] = reliefForCount(n, model);
  const out = new Float32Array(lumaT.length);
  const { lab, weight } = target;
  for (let i = 0; i < out.length; i++) {
    if (weight[i] < 0.5) {
      out[i] = lumaT[i];
      continue;
    }
    const L = lab[i * 3];
    const A = lab[i * 3 + 1];
    const B = lab[i * 3 + 2];
    const nl = lumaCounts[i];
    let best = nl;
    let bestCost = Infinity;
    for (let n = lo; n <= hi; n++) {
      const dl = lutLab[n * 3] - L;
      const da = lutLab[n * 3 + 1] - A;
      const db = lutLab[n * 3 + 2] - B;
      const dn = n - nl;
      const c = s * (dl * dl + da * da + db * db) + pull * dn * dn;
      if (c < bestCost) {
        bestCost = c;
        best = n;
      }
    }
    out[i] = tOf[best];
  }
  return out;
}
