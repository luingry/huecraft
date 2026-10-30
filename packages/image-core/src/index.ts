import type { ReliefMode, ReliefParams } from '@huecraft/project-schema';

export interface ImageData {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export interface HeightField {
  width: number;
  height: number;
  heights: Float32Array;
}

export function decodeImageData(
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
): ImageData {
  return { width, height, rgba };
}

export function resizeImageData(img: ImageData, maxEdge: number): ImageData {
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  if (scale >= 1) return img;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.floor((x / w) * img.width);
      const sy = Math.floor((y / h) * img.height);
      const si = (sy * img.width + sx) * 4;
      const di = (y * w + x) * 4;
      rgba[di] = img.rgba[si];
      rgba[di + 1] = img.rgba[si + 1];
      rgba[di + 2] = img.rgba[si + 2];
      rgba[di + 3] = img.rgba[si + 3];
    }
  }
  return { width: w, height: h, rgba };
}

function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function colorDistance(
  r: number,
  g: number,
  b: number,
  hex: string,
): number {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  const tr = (n >> 16) & 255;
  const tg = (n >> 8) & 255;
  const tb = n & 255;
  const dr = r - tr;
  const dg = g - tg;
  const db = b - tb;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function computeHeightField(
  img: ImageData,
  params: ReliefParams,
  maxHeight: number,
): HeightField {
  const { width, height, rgba } = img;
  const heights = new Float32Array(width * height);
  const mode: ReliefMode = params.mode;

  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const r = rgba[o];
    const g = rgba[o + 1];
    const b = rgba[o + 2];
    let t = 0;

    switch (mode) {
      case 'luminance':
        t = luminance(r, g, b);
        break;
      case 'contrast': {
        let lum = luminance(r, g, b);
        lum = (lum - 0.5) * params.contrast + 0.5;
        t = Math.min(1, Math.max(0, lum));
        t = Math.pow(t, params.gamma);
        break;
      }
      case 'palette': {
        if (params.paletteColors.length === 0) {
          t = luminance(r, g, b);
        } else {
          let best = Infinity;
          let idx = 0;
          params.paletteColors.forEach((hex, pi) => {
            const d = colorDistance(r, g, b, hex);
            if (d < best) {
              best = d;
              idx = pi;
            }
          });
          t = idx / Math.max(1, params.paletteColors.length - 1);
        }
        break;
      }
      case 'reference': {
        if (params.referenceAnchors.length === 0) {
          t = luminance(r, g, b);
        } else {
          let best = Infinity;
          let h = 0;
          for (const anchor of params.referenceAnchors) {
            const hr = parseInt(anchor.color.slice(1, 3), 16);
            const hg = parseInt(anchor.color.slice(3, 5), 16);
            const hb = parseInt(anchor.color.slice(5, 7), 16);
            const d = colorDistance(r, g, b, anchor.color);
            if (d < best) {
              best = d;
              h = anchor.height;
            }
            void hr;
            void hg;
            void hb;
          }
          t = h;
        }
        break;
      }
    }

    heights[i] = t * maxHeight;
  }

  return { width, height, heights };
}
