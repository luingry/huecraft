import type { HeightField } from '@huecraft/image-core';

export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
  triangleCount: number;
}

/** Vertex colors aligned with buildHeightfieldMesh layout (top = optics preview, bottom = dimmed). */
export function buildMeshVertexColors(
  width: number,
  height: number,
  previewRgba: Uint8ClampedArray,
): Float32Array {
  const vertexCount = width * height * 2;
  const colors = new Float32Array(vertexCount * 3);
  const grid = width * height;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pi = (y * width + x) * 4;
      const r = previewRgba[pi] / 255;
      const g = previewRgba[pi + 1] / 255;
      const b = previewRgba[pi + 2] / 255;

      const top = (y * width + x) * 3;
      colors[top] = r;
      colors[top + 1] = g;
      colors[top + 2] = b;

      const bot = (grid + y * width + x) * 3;
      colors[bot] = r * 0.22;
      colors[bot + 1] = g * 0.22;
      colors[bot + 2] = b * 0.22;
    }
  }

  return colors;
}

export function buildHeightfieldMesh(
  field: HeightField,
  mmPerPixel: number,
  baseThicknessMm: number,
): MeshData {
  const { width, height, heights } = field;
  const vertexCount = width * height * 2;
  const positions = new Float32Array(vertexCount * 3);
  const indices: number[] = [];

  const zAt = (x: number, y: number, top: boolean): number => {
    const h = heights[y * width + x];
    return top ? baseThicknessMm + h : 0;
  };

  let vi = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x * mmPerPixel;
      const py = (height - 1 - y) * mmPerPixel;
      positions[vi++] = px;
      positions[vi++] = py;
      positions[vi++] = zAt(x, y, true);
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x * mmPerPixel;
      const py = (height - 1 - y) * mmPerPixel;
      positions[vi++] = px;
      positions[vi++] = py;
      positions[vi++] = zAt(x, y, false);
    }
  }

  const topOffset = 0;
  const botOffset = width * height;

  const idx = (x: number, y: number, top: boolean) =>
    (top ? topOffset : botOffset) + y * width + x;

  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const a = idx(x, y, true);
      const b = idx(x + 1, y, true);
      const c = idx(x, y + 1, true);
      const d = idx(x + 1, y + 1, true);
      indices.push(a, b, c, b, d, c);
    }
  }

  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const a = idx(x, y, false);
      const b = idx(x + 1, y, false);
      const c = idx(x, y + 1, false);
      const d = idx(x + 1, y + 1, false);
      indices.push(a, c, b, b, c, d);
    }
  }

  const addSide = (x0: number, y0: number, x1: number, y1: number) => {
    const t0 = idx(x0, y0, true);
    const t1 = idx(x1, y1, true);
    const b0 = idx(x0, y0, false);
    const b1 = idx(x1, y1, false);
    indices.push(t0, b0, t1, t1, b0, b1);
  };

  for (let x = 0; x < width - 1; x++) {
    addSide(x, 0, x + 1, 0);
    addSide(x + 1, height - 1, x, height - 1);
  }
  for (let y = 0; y < height - 1; y++) {
    addSide(0, y + 1, 0, y);
    addSide(width - 1, y, width - 1, y + 1);
  }

  return {
    positions,
    indices: new Uint32Array(indices),
    triangleCount: indices.length / 3,
  };
}
