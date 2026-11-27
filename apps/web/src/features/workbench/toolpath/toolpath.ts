/**
 * Simplified slicer: turns the preview layer field into the extrusion paths a
 * slicer would print, for the 3D "lines" view. Per layer it takes the area
 * printed there (columns taller than the layer), offsets its outline inwards
 * for the perimeters and fills the rest with straight lines: solid near the
 * bottom and under each column's top, sparse elsewhere. Directions alternate
 * ±45° per layer. No seams, travel, gap fill or variable width.
 *
 * Works on a Euclidean distance transform of the layer mask, so offsets are
 * iso-lines of one scalar field (marching squares) instead of polygon clipping.
 */

export interface ToolpathInput {
  /** Layer count per pixel, row 0 = image top. */
  field: Uint16Array;
  width: number;
  height: number;
  widthMm: number;
  heightMm: number;
  totalLayers: number;
  lineWidthMm: number;
  /** Top Z (mm) of each layer, index = layer. */
  layerTopZ: Float32Array;
  /** Height (mm) of each layer, index = layer. */
  layerHeight: Float32Array;
  perimeters?: number;
  topShells?: number;
  bottomShells?: number;
  /** Sparse infill density, 0..1. */
  sparseDensity?: number;
}

export const enum PathKind {
  OuterWall = 0,
  InnerWall = 1,
  SolidInfill = 2,
  SparseInfill = 3,
}

export interface Toolpaths {
  /** x0, y0, x1, y1 (mm, model space: y up, origin at the image's bottom-left) per segment. */
  segments: Float32Array;
  /** z top, layer height (mm) per segment. */
  z: Float32Array;
  /** Layer index per segment (segments are sorted by layer). */
  layer: Uint16Array;
  kind: Uint8Array;
  /** layerStart[k] = first segment of layer k; layerStart[totalLayers] = count. */
  layerStart: Uint32Array;
  count: number;
}

/** Growable float buffer. */
class FBuf {
  a = new Float32Array(1 << 16);
  n = 0;
  push4(x0: number, y0: number, x1: number, y1: number) {
    if (this.n + 4 > this.a.length) {
      const b = new Float32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    const a = this.a;
    a[this.n++] = x0;
    a[this.n++] = y0;
    a[this.n++] = x1;
    a[this.n++] = y1;
  }
}

const INF = 1e20;

/** 1D squared distance transform (Felzenszwalb & Huttenlocher). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/**
 * Distance (pixels) from each inside pixel centre to the outline, on a grid
 * padded by one outside pixel; outside pixels get -0.5. Iso-line 0 ≈ the outline.
 */
function insideDistance(mask: Uint8Array, W: number, H: number, out: Float32Array, tmp: Float64Array) {
  const n = Math.max(W, H);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = mask[y * W + x] ? INF : 0;
    edt1d(f, H, d, v, z);
    for (let y = 0; y < H; y++) tmp[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) f[x] = tmp[row + x];
    edt1d(f, W, d, v, z);
    for (let x = 0; x < W; x++) out[row + x] = mask[row + x] ? Math.sqrt(d[x]) - 0.5 : -0.5;
  }
}

const SMOOTH_PASSES = 3;

/** In-place separable [1 2 1] / 4 blur (edges clamp). */
function blur121(f: Float32Array, W: number, H: number, tmp: Float64Array) {
  for (let y = 0; y < H; y++) {
    const r = y * W;
    for (let x = 0; x < W; x++) tmp[r + x] = (f[r + Math.max(0, x - 1)] + 2 * f[r + x] + f[r + Math.min(W - 1, x + 1)]) * 0.25;
  }
  for (let y = 0; y < H; y++) {
    const up = Math.max(0, y - 1) * W;
    const dn = Math.min(H - 1, y + 1) * W;
    const r = y * W;
    for (let x = 0; x < W; x++) f[r + x] = (tmp[up + x] + 2 * tmp[r + x] + tmp[dn + x]) * 0.25;
  }
}

/**
 * Iso-line `t` of `f` (pixel-centre samples) as closed/open polylines in grid
 * coordinates (pixel centre of (x, y) = (x, y)).
 */
function isoLines(f: Float32Array, W: number, H: number, t: number): Float32Array[] {
  // Crossing points on edges: horizontal edge (x,y)-(x+1,y) id = (y*W+x)*2, vertical (x,y)-(x,y+1) id = ... +1.
  const px = new Float32Array(W * H * 2);
  const py = new Float32Array(W * H * 2);
  // next[edge] = edge the walk continues to (one direction per segment); -1 none.
  const link = new Int32Array(W * H * 2).fill(-1);
  const linkB = new Int32Array(W * H * 2).fill(-1);
  const edgePoint = (x0: number, y0: number, x1: number, y1: number, id: number) => {
    const a = f[y0 * W + x0];
    const b = f[y1 * W + x1];
    const s = (t - a) / (b - a);
    px[id] = x0 + (x1 - x0) * s;
    py[id] = y0 + (y1 - y0) * s;
  };
  const connect = (e0: number, e1: number) => {
    if (link[e0] < 0) link[e0] = e1;
    else linkB[e0] = e1;
    if (link[e1] < 0) link[e1] = e0;
    else linkB[e1] = e0;
  };
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const i = y * W + x;
      const a = f[i] >= t ? 1 : 0;
      const b = f[i + 1] >= t ? 1 : 0;
      const c = f[i + W + 1] >= t ? 1 : 0;
      const d = f[i + W] >= t ? 1 : 0;
      const code = a | (b << 1) | (c << 2) | (d << 3);
      if (code === 0 || code === 15) continue;
      const eT = i * 2; // top: (x,y)-(x+1,y)
      const eB = (i + W) * 2; // bottom: (x,y+1)-(x+1,y+1)
      const eL = i * 2 + 1; // left: (x,y)-(x,y+1)
      const eR = (i + 1) * 2 + 1; // right: (x+1,y)-(x+1,y+1)
      if (a !== b) edgePoint(x, y, x + 1, y, eT);
      if (d !== c) edgePoint(x, y + 1, x + 1, y + 1, eB);
      if (a !== d) edgePoint(x, y, x, y + 1, eL);
      if (b !== c) edgePoint(x + 1, y, x + 1, y + 1, eR);
      switch (code) {
        case 1: case 14: connect(eL, eT); break;
        case 2: case 13: connect(eT, eR); break;
        case 3: case 12: connect(eL, eR); break;
        case 4: case 11: connect(eR, eB); break;
        case 6: case 9: connect(eT, eB); break;
        case 7: case 8: connect(eL, eB); break;
        case 5: case 10: {
          // Saddle: decide by the centre value.
          const mid = (f[i] + f[i + 1] + f[i + W] + f[i + W + 1]) / 4 >= t ? 1 : 0;
          if ((code === 5) === (mid === 1)) {
            connect(eL, eB);
            connect(eT, eR);
          } else {
            connect(eL, eT);
            connect(eR, eB);
          }
          break;
        }
      }
    }
  }
  // Every crossing edge is shared by two cells and the padding keeps the grid
  // border outside, so each edge has exactly two links: all lines are loops.
  const used = new Uint8Array(W * H * 2);
  const lines: Float32Array[] = [];
  const pts: number[] = [];
  const walk = (start: number) => {
    pts.length = 0;
    let prev = -1;
    let cur = start;
    for (;;) {
      used[cur] = 1;
      pts.push(px[cur], py[cur]);
      const n = link[cur] !== prev ? link[cur] : linkB[cur];
      if (n === start) {
        pts.push(px[start], py[start]);
        break;
      }
      if (n < 0 || used[n]) break;
      prev = cur;
      cur = n;
    }
    if (pts.length >= 4) lines.push(Float32Array.from(pts));
  };
  for (let e = 0; e < link.length; e++) if (link[e] >= 0 && !used[e]) walk(e);
  return lines;
}

/** Douglas–Peucker on a flat xy array; returns kept point indices. */
function simplify(p: Float32Array, tol: number): number[] {
  const n = p.length / 2;
  if (n <= 2) return n === 2 ? [0, 1] : [0];
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  const tol2 = tol * tol;
  while (stack.length) {
    const b = stack.pop()!;
    const a = stack.pop()!;
    const ax = p[a * 2], ay = p[a * 2 + 1];
    const dx = p[b * 2] - ax, dy = p[b * 2 + 1] - ay;
    const len2 = dx * dx + dy * dy;
    let best = -1;
    let bestD = tol2;
    for (let i = a + 1; i < b; i++) {
      const ex = p[i * 2] - ax, ey = p[i * 2 + 1] - ay;
      let d2: number;
      if (len2 < 1e-12) d2 = ex * ex + ey * ey;
      else {
        const c = ex * dy - ey * dx;
        d2 = (c * c) / len2;
      }
      if (d2 > bestD) {
        bestD = d2;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push(a, best, best, b);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

export function buildToolpaths(input: ToolpathInput): Toolpaths {
  const { field, width: w, height: h, totalLayers } = input;
  const perimeters = input.perimeters ?? 2;
  const topShells = input.topShells ?? 4;
  const bottomShells = input.bottomShells ?? 3;
  const density = input.sparseDensity ?? 0.15;
  // Padded grid: one outside pixel on every side so every outline closes.
  const W = w + 2;
  const H = h + 2;
  const pxMm = input.widthMm / w;
  const pyMm = input.heightMm / h;
  const pMm = (pxMm + pyMm) / 2;
  const lwPx = input.lineWidthMm / pMm;
  // Grid point (gx, gy) (padded, pixel-centre units) → model mm.
  const toX = (gx: number) => (gx - 0.5) * pxMm;
  const toY = (gy: number) => input.heightMm - (gy - 0.5) * pyMm;

  const mask = new Uint8Array(W * H);
  const dist = new Float32Array(W * H);
  const tmp = new Float64Array(W * H);
  // topOf[i] = top layer index of the column (padded), -1 outside.
  const topOf = new Int32Array(W * H).fill(-1);
  const hist = new Uint32Array(totalLayers + 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = field[y * w + x];
      topOf[(y + 1) * W + x + 1] = c - 1;
      hist[Math.min(c, totalLayers + 1)]++;
    }
  }

  const seg = new FBuf();
  const zs: number[] = [];
  const layers: number[] = [];
  const kinds: number[] = [];
  const layerStart = new Uint32Array(totalLayers + 1);
  let count = 0;
  const emit = (x0: number, y0: number, x1: number, y1: number, k: number, kind: PathKind) => {
    seg.push4(toX(x0), toY(y0), toX(x1), toY(y1));
    zs.push(input.layerTopZ[k], input.layerHeight[k]);
    layers.push(k);
    kinds.push(kind);
    count++;
  };

  // Sparse lines sit on every m-th solid line, so the two kinds join seamlessly.
  const sparseEvery = Math.max(1, Math.round(1 / Math.max(0.01, density)));
  const tInfill = (perimeters - 0.15) * lwPx;
  let haveDist = false;
  let pixelsLeft = w * h - hist[0];

  for (let k = 0; k < totalLayers; k++) {
    layerStart[k] = count;
    // Columns with exactly k layers drop out at layer k; skip the transform when none do.
    const dropping = k > 0 ? hist[k] : 0;
    pixelsLeft -= dropping;
    if (pixelsLeft <= 0) {
      layerStart.fill(count, k);
      break;
    }
    if (!haveDist || dropping > 0) {
      for (let i = 0; i < W * H; i++) mask[i] = topOf[i] >= k ? 1 : 0;
      insideDistance(mask, W, H, dist, tmp);
      // The preview grid is coarse (and line-width blocky): soften the stair steps
      // the way the slicer sees the smoother exported surface.
      for (let s = 0; s < SMOOTH_PASSES; s++) blur121(dist, W, H, tmp);
      haveDist = true;
    }

    // Perimeters: iso-lines of the inside distance at (i + ½) line widths.
    for (let p = 0; p < perimeters; p++) {
      const t = (p + 0.5) * lwPx;
      for (const line of isoLines(dist, W, H, t)) {
        const keep = simplify(line, 0.3);
        for (let j = 1; j < keep.length; j++) {
          const a = keep[j - 1] * 2;
          const b = keep[j] * 2;
          emit(line[a], line[a + 1], line[b], line[b + 1], k, p === 0 ? PathKind.OuterWall : PathKind.InnerWall);
        }
      }
    }

    // Infill: straight lines at ±45°, one line width apart where solid.
    const angle = k % 2 === 0 ? Math.PI / 4 : -Math.PI / 4;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const nx = -uy;
    const ny = ux;
    let nMin = Infinity, nMax = -Infinity, uMin = Infinity, uMax = -Infinity;
    for (const [cx, cy] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]]) {
      const nv = cx * nx + cy * ny;
      const uv = cx * ux + cy * uy;
      nMin = Math.min(nMin, nv); nMax = Math.max(nMax, nv);
      uMin = Math.min(uMin, uv); uMax = Math.max(uMax, uv);
    }
    const step = 0.4;
    const isSolid = (topIdx: number) => k < bottomShells || topIdx - k < topShells;
    for (let j = Math.ceil(nMin / lwPx); j * lwPx <= nMax; j++) {
      const off = j * lwPx;
      const sparseLine = ((j % sparseEvery) + sparseEvery) % sparseEvery === 0;
      // u can be negative: NaN marks "no run".
      let runStart = NaN;
      let runKind = PathKind.SolidInfill;
      let lastU = 0;
      const close = (uEnd: number) => {
        if (uEnd - runStart > 0.5) {
          emit(off * nx + runStart * ux, off * ny + runStart * uy, off * nx + uEnd * ux, off * ny + uEnd * uy, k, runKind);
        }
        runStart = NaN;
      };
      for (let u = uMin; u <= uMax; u += step) {
        const gx = off * nx + u * ux;
        const gy = off * ny + u * uy;
        const x0 = Math.floor(gx), y0 = Math.floor(gy);
        let on = false;
        let kind = PathKind.SolidInfill;
        if (x0 >= 0 && y0 >= 0 && x0 < W - 1 && y0 < H - 1) {
          const fx = gx - x0, fy = gy - y0;
          const i = y0 * W + x0;
          const d = (dist[i] * (1 - fx) + dist[i + 1] * fx) * (1 - fy) + (dist[i + W] * (1 - fx) + dist[i + W + 1] * fx) * fy;
          if (d >= tInfill) {
            const top = topOf[Math.round(gy) * W + Math.round(gx)];
            if (isSolid(top)) on = true;
            else if (sparseLine) {
              on = true;
              kind = PathKind.SparseInfill;
            }
          }
        }
        const inRun = !Number.isNaN(runStart);
        if (on && inRun && kind !== runKind) {
          close(u);
          runStart = u;
          runKind = kind;
        } else if (on && !inRun) {
          runStart = u;
          runKind = kind;
        } else if (!on && inRun) close(lastU);
        lastU = u;
      }
      close(lastU);
    }
  }
  layerStart[totalLayers] = count;

  return {
    segments: seg.a.slice(0, count * 4),
    z: Float32Array.from(zs),
    layer: Uint16Array.from(layers),
    kind: Uint8Array.from(kinds),
    layerStart,
    count,
  };
}
