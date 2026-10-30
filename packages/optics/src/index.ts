import type { FilamentRecord } from '@huecraft/filament-db';
import type { HeightField } from '@huecraft/image-core';

export interface LayerSlice {
  filament: FilamentRecord;
  thicknessMm: number;
}

export interface OpticsPreview {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

/** Beer-Lambert style transmission: fraction of light passing through thickness t given TD */
export function transmissionFactor(tdMm: number, thicknessMm: number): number {
  if (tdMm <= 0.01) return 0;
  return Math.exp(-thicknessMm / tdMm);
}

export function labToRgb(l: number, a: number, b: number): { r: number; g: number; b: number } {
  const y = (l + 16) / 116;
  const x = a / 500 + y;
  const z = y - b / 200;
  const xr = invF(x) * 0.95047;
  const yr = invF(y);
  const zr = invF(z) * 1.08883;
  const r = linearToSrgb(3.2404542 * xr - 1.5371385 * yr - 0.4985314 * zr);
  const g = linearToSrgb(-0.969266 * xr + 1.8760108 * yr + 0.041556 * zr);
  const bl = linearToSrgb(0.0556434 * xr - 0.2040259 * yr + 1.0572252 * zr);
  return {
    r: Math.round(Math.min(255, Math.max(0, r * 255))),
    g: Math.round(Math.min(255, Math.max(0, g * 255))),
    b: Math.round(Math.min(255, Math.max(0, bl * 255))),
  };
}

function invF(t: number): number {
  const d = 6 / 29;
  return t > d ? t ** 3 : 3 * d * d * (t - 4 / 29);
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function blendRgb(
  base: { r: number; g: number; b: number },
  top: { r: number; g: number; b: number },
  transmit: number,
): { r: number; g: number; b: number } {
  const absorb = 1 - transmit;
  return {
    r: base.r * transmit + top.r * absorb,
    g: base.g * transmit + top.g * absorb,
    b: base.b * transmit + top.b * absorb,
  };
}

export function buildLayerStack(
  filaments: FilamentRecord[],
  layerCounts: number[],
  layerHeightMm: number,
): LayerSlice[] {
  const stack: LayerSlice[] = [];
  for (let i = 0; i < filaments.length; i++) {
    const count = layerCounts[i] ?? 1;
    for (let c = 0; c < count; c++) {
      stack.push({ filament: filaments[i], thicknessMm: layerHeightMm });
    }
  }
  return stack;
}

function filamentIndexAtZ(
  z: number,
  reliefH: number,
  baseThicknessMm: number,
  filamentCount: number,
): number {
  if (filamentCount === 0) return 0;
  if (z < baseThicknessMm) return 0;
  if (reliefH <= 0.0001) return 0;
  const reliefZ = z - baseThicknessMm;
  return Math.min(filamentCount - 1, Math.floor((reliefZ / reliefH) * filamentCount));
}

function filamentForLayerAtZ(
  z: number,
  reliefH: number,
  baseThicknessMm: number,
  filaments: FilamentRecord[],
): FilamentRecord {
  return filaments[filamentIndexAtZ(z, reliefH, baseThicknessMm, filaments.length)];
}

export function computeOpticsPreview(
  field: HeightField,
  filaments: FilamentRecord[],
  layerHeightMm: number,
  baseThicknessMm: number,
): OpticsPreview {
  const { width, height, heights } = field;
  const rgba = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    const h = heights[i];
    const totalZ = baseThicknessMm + h;
    let color = { r: 255, g: 255, b: 255 };
    let z = 0;
    while (z < totalZ - 0.0001) {
      const zTop = Math.min(totalZ, z + layerHeightMm);
      const thick = zTop - z;
      const filament = filamentForLayerAtZ(z, h, baseThicknessMm, filaments);
      const tf = transmissionFactor(filament.tdMm, thick);
      const filamentRgb = labToRgb(filament.lab.l, filament.lab.a, filament.lab.b);
      color = blendRgb(color, filamentRgb, tf);
      z = zTop;
    }

    const o = i * 4;
    rgba[o] = color.r;
    rgba[o + 1] = color.g;
    rgba[o + 2] = color.b;
    rgba[o + 3] = 255;
  }

  return { width, height, rgba };
}

function maxInHeights(heights: Float32Array): number {
  let max = 0;
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i];
    if (h > max) max = h;
  }
  return Math.max(0.001, max);
}

export function assignLayersFromHeight(
  field: HeightField,
  filaments: FilamentRecord[],
  layerHeightMm: number,
  baseThicknessMm: number,
): { layerCounts: number[]; swapLayers: number[] } {
  if (filaments.length === 0) return { layerCounts: [], swapLayers: [] };

  const maxHeight = maxInHeights(field.heights);
  const maxZ = baseThicknessMm + maxHeight;
  const totalLayers = Math.ceil(maxZ / layerHeightMm);
  const layerFilamentIdx = new Int32Array(totalLayers).fill(filaments.length - 1);

  for (let y = 0; y < field.height; y++) {
    for (let x = 0; x < field.width; x++) {
      const h = field.heights[y * field.width + x];
      const z = baseThicknessMm + h;
      const layerIdx = Math.min(totalLayers - 1, Math.floor(z / layerHeightMm));
      const zBottom = layerIdx * layerHeightMm;
      layerFilamentIdx[layerIdx] = filamentIndexAtZ(
        zBottom,
        h,
        baseThicknessMm,
        filaments.length,
      );
    }
  }

  const layerCounts = filaments.map(() => 0);
  for (let i = 0; i < totalLayers; i++) {
    layerCounts[layerFilamentIdx[i]]++;
  }

  const swapLayers: number[] = [];
  for (let i = 1; i < totalLayers; i++) {
    if (layerFilamentIdx[i] !== layerFilamentIdx[i - 1]) swapLayers.push(i);
  }

  return { layerCounts, swapLayers };
}
