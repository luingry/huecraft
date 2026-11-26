/**
 * Mesh builders. All arrays are counted first and preallocated; no `number[]`.
 *
 * Coordinate system (both meshes): millimetres, x to the right (0..width),
 * y up with the top row of the image at y = height, z up from the bed (z = 0).
 */

export { buildTerracedSolidMesh, type TerracedSolidInput } from './terrace.js';
export { buildTextMesh, measureText, toFontText, type TextMeshOptions } from './text.js';

export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
  triangleCount: number;
}

export interface TerracedMesh extends MeshData {
  /** RGB 0..1 per vertex, same layout as positions. */
  printedColors: Float32Array;
  slicerColors: Float32Array;
}

export interface TerracedMeshInput {
  /** Layer count per cell, row-major, row 0 = top of the image. */
  field: Uint16Array;
  width: number;
  height: number;
  widthMm: number;
  heightMm: number;
  /** z of the plateau for layer count n (index n). */
  zOfCount: Float32Array;
  /** RGB bytes per layer count (index n). */
  printedLut: Uint8Array;
  slicerLut: Uint8Array;
}

/**
 * Terraced preview mesh, like a slicer's 3D preview: each run of equal layer
 * count in a row is one flat quad at its layer top, vertical walls separate
 * neighbours with different counts and close the border down to z = 0, and one
 * quad closes the bottom. Vertices are not shared between quads so colours
 * stay crisp (flat shading). Walls are split into horizontal bands, one per
 * layer (consecutive layers of the same colour merged), each in that layer's
 * colour: a wall from count m up to n shows layers m+1..n as they are printed,
 * not the top colour of the taller column all the way down.
 */
export function buildTerracedMesh(input: TerracedMeshInput): TerracedMesh {
  const { field, width: w, height: h, zOfCount } = input;
  const px = input.widthMm / w;
  const py = input.heightMm / h;
  const lutP = toFloatLut(input.printedLut);
  const lutS = toFloatLut(input.slicerLut);
  const counts = zOfCount.length;
  // sameAsBelow[k]: layer k has the same colour as layer k-1 in both LUTs.
  const sameAsBelow = new Uint8Array(counts);
  for (let k = 2; k < counts; k++) {
    let same = 1;
    for (let ch = 0; ch < 3 && same; ch++) {
      if (input.printedLut[k * 3 + ch] !== input.printedLut[(k - 1) * 3 + ch]) same = 0;
      if (input.slicerLut[k * 3 + ch] !== input.slicerLut[(k - 1) * 3 + ch]) same = 0;
    }
    sameAsBelow[k] = same;
  }
  // newBands[n]: colour bands starting in layers 1..n (prefix sum).
  const newBands = new Uint32Array(counts);
  for (let k = 1; k < counts; k++) newBands[k] = newBands[k - 1] + (k === 1 || !sameAsBelow[k] ? 1 : 0);
  /** Bands of a wall covering layers lo+1..hi. */
  const bandCount = (lo: number, hi: number) => (hi <= lo ? 0 : newBands[hi] - newBands[lo + 1] + 1);

  // Pass 1: count quads.
  let quads = 1; // bottom
  for (let y = 0; y < h; y++) {
    const row = y * w;
    // Top runs and vertical x-walls at run boundaries.
    let prev = field[row];
    quads++;
    for (let x = 1; x < w; x++) {
      const a = field[row + x];
      if (a === prev) continue;
      quads++;
      quads += bandCount(Math.min(a, prev), Math.max(a, prev));
      prev = a;
    }
    quads += bandCount(0, field[row]) + bandCount(0, field[row + w - 1]); // left and right border walls
    // y-walls between this row and the next (merged along x by equal pair).
    if (y + 1 < h) {
      const next = row + w;
      let prevA = -1;
      let prevB = -1;
      for (let x = 0; x < w; x++) {
        const a = field[row + x];
        const b = field[next + x];
        if (a === b) {
          prevA = -1;
          continue;
        }
        if (a !== prevA || b !== prevB) quads += bandCount(Math.min(a, b), Math.max(a, b));
        prevA = a;
        prevB = b;
      }
    }
  }
  // Top and bottom border walls (merged by equal count).
  for (const row of [0, (h - 1) * w]) borderRuns(field, row, w, (_x0, _x1, n) => (quads += bandCount(0, n)));

  const positions = new Float32Array(quads * 12);
  const printedColors = new Float32Array(quads * 12);
  const slicerColors = new Float32Array(quads * 12);
  const indices = new Uint32Array(quads * 6);

  let q = 0;
  // Emit a quad given 4 corners in CCW order as seen from outside.
  const quad = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
    n: number,
  ) => {
    const o = q * 12;
    positions[o] = ax; positions[o + 1] = ay; positions[o + 2] = az;
    positions[o + 3] = bx; positions[o + 4] = by; positions[o + 5] = bz;
    positions[o + 6] = cx; positions[o + 7] = cy; positions[o + 8] = cz;
    positions[o + 9] = dx; positions[o + 10] = dy; positions[o + 11] = dz;
    const c = n * 3;
    for (let v = 0; v < 12; v += 3) {
      printedColors[o + v] = lutP[c]; printedColors[o + v + 1] = lutP[c + 1]; printedColors[o + v + 2] = lutP[c + 2];
      slicerColors[o + v] = lutS[c]; slicerColors[o + v + 1] = lutS[c + 1]; slicerColors[o + v + 2] = lutS[c + 2];
    }
    const base = q * 4;
    const io = q * 6;
    indices[io] = base; indices[io + 1] = base + 1; indices[io + 2] = base + 2;
    indices[io + 3] = base; indices[io + 4] = base + 2; indices[io + 5] = base + 3;
    q++;
  };

  /**
   * A vertical wall over layers lo+1..hi, cut into colour bands. `band` emits
   * one quad between za (bottom) and zb (top) in the colour of layer k.
   */
  const wall = (lo: number, hi: number, band: (za: number, zb: number, k: number) => void) => {
    let k = lo + 1;
    while (k <= hi) {
      let e = k;
      while (e + 1 <= hi && sameAsBelow[e + 1]) e++;
      band(zOfCount[k - 1], zOfCount[e], e);
      k = e + 1;
    }
  };

  for (let y = 0; y < h; y++) {
    const row = y * w;
    const yTop = (h - y) * py;
    const yBot = (h - 1 - y) * py;
    let runStart = 0;
    for (let x = 1; x <= w; x++) {
      if (x < w && field[row + x] === field[row + runStart]) continue;
      const n = field[row + runStart];
      const z = zOfCount[n];
      const x0 = runStart * px;
      const x1 = x * px;
      // Plateau (normal +z): CCW from above.
      quad(x0, yBot, z, x1, yBot, z, x1, yTop, z, x0, yTop, z, n);
      if (x < w) {
        // x-wall between this run and the next one.
        const m = field[row + x];
        if (n > m) wall(m, n, (za, zb, k) => quad(x1, yBot, za, x1, yTop, za, x1, yTop, zb, x1, yBot, zb, k)); // faces +x
        else wall(n, m, (za, zb, k) => quad(x1, yTop, zb, x1, yBot, zb, x1, yBot, za, x1, yTop, za, k)); // faces -x
      }
      runStart = x;
    }
    // Left (-x) and right (+x) border walls.
    wall(0, field[row], (za, zb, k) => quad(0, yTop, za, 0, yBot, za, 0, yBot, zb, 0, yTop, zb, k));
    const xr = w * px;
    wall(0, field[row + w - 1], (za, zb, k) => quad(xr, yBot, za, xr, yTop, za, xr, yTop, zb, xr, yBot, zb, k));
    // y-walls between row y and y+1 at y = yBot.
    if (y + 1 < h) {
      const next = row + w;
      let x = 0;
      while (x < w) {
        const a = field[row + x];
        const b = field[next + x];
        if (a === b) {
          x++;
          continue;
        }
        let e = x + 1;
        while (e < w && field[row + e] === a && field[next + e] === b) e++;
        const x0 = x * px;
        const x1 = e * px;
        if (a > b) wall(b, a, (za, zb, k) => quad(x0, yBot, za, x1, yBot, za, x1, yBot, zb, x0, yBot, zb, k)); // upper row taller: faces -y
        else wall(a, b, (za, zb, k) => quad(x1, yBot, za, x0, yBot, za, x0, yBot, zb, x1, yBot, zb, k)); // lower row taller: faces +y
        x = e;
      }
    }
  }
  // Top border (y = height, faces +y) and bottom border (y = 0, faces -y).
  const yMax = h * py;
  borderRuns(field, 0, w, (x0, x1, n) =>
    wall(0, n, (za, zb, k) => quad(x1 * px, yMax, za, x0 * px, yMax, za, x0 * px, yMax, zb, x1 * px, yMax, zb, k)),
  );
  borderRuns(field, (h - 1) * w, w, (x0, x1, n) =>
    wall(0, n, (za, zb, k) => quad(x0 * px, 0, za, x1 * px, 0, za, x1 * px, 0, zb, x0 * px, 0, zb, k)),
  );
  // Bottom (faces -z), coloured like the base.
  const nb = input.printedLut.length >= 6 ? 1 : 0; // n = 1: colour of the first layer
  quad(0, 0, 0, 0, yMax, 0, w * px, yMax, 0, w * px, 0, 0, nb);

  if (q !== quads) throw new Error(`buildTerracedMesh: counted ${quads} quads, emitted ${q}`);
  return { positions, indices, printedColors, slicerColors, triangleCount: q * 2 };
}

function borderRuns(field: Uint16Array, row: number, w: number, emit: (x0: number, x1: number, n: number) => void): void {
  let start = 0;
  for (let x = 1; x <= w; x++) {
    if (x < w && field[row + x] === field[row + start]) continue;
    emit(start, x, field[row + start]);
    start = x;
  }
}

function toFloatLut(lut: Uint8Array): Float32Array {
  const out = new Float32Array(lut.length);
  for (let i = 0; i < lut.length; i++) out[i] = lut[i] / 255;
  return out;
}

export interface SolidHeightfieldInput {
  /** Top surface z in mm per grid sample, row-major, row 0 = top of the image. */
  heights: Float32Array;
  width: number;
  height: number;
  widthMm: number;
  heightMm: number;
  /**
   * Largest vertical distance (mm) allowed between a grid sample and the
   * RTIN surface. Default 0: every sample stays exactly on the surface and
   * only coplanar triangles are merged (lossless).
   */
  maxErrorMm?: number;
}

/** "Exact": far below Float32 noise on heights of a few mm and the 0.1 µm the 3MF keeps. */
const EXACT_EPSILON_MM = 1e-5;

/**
 * Watertight, manifold solid for printing: the top surface is the heightfield
 * spanning exactly widthMm × heightMm, side walls run along the four borders
 * down to z = 0, and the bottom is a fan of the perimeter vertices around a
 * single centre vertex (no full bottom grid, no T-junctions). Triangles are CCW
 * seen from outside (outward normals).
 *
 * The top is a right-triangulated irregular network (RTIN, as in Martini): the
 * grid is covered by a binary tree of right triangles, and a triangle is split
 * only where a sample under it lies more than `maxErrorMm` off its plane. Both
 * triangles of a hypotenuse share the split decision, so there are no cracks.
 * Snapped reliefs are flat plateaus, which collapse into few large triangles
 * while every contour keeps one vertex per sample. Every sample stays on the
 * surface, but inside a cell whose corners are not coplanar the RTIN diagonal
 * alternates (4-8 pattern) instead of always running a–d, so contours there
 * differ slightly from a fixed-diagonal grid (buildTerracedSolidMesh slices
 * exactly like the a–d grid).
 */
export function buildSolidHeightfieldMesh(input: SolidHeightfieldInput): MeshData {
  if (input.width < 2 || input.height < 2) throw new Error('Heightfield needs at least 2×2 samples');
  return closeSolid(buildRtinTop(input), input);
}

/** Open top sheet: positions of the used samples and the perimeter ring (vertex ids, CCW from above). */
interface TopSheet {
  positions: Float32Array;
  indices: Uint32Array;
  ring: Uint32Array;
}

function buildRtinTop(input: SolidHeightfieldInput): TopSheet {
  const { heights, width: w, height: h } = input;
  const maxError = Math.max(EXACT_EPSILON_MM, input.maxErrorMm ?? 0);
  const sx = input.widthMm / (w - 1);
  const sy = input.heightMm / (h - 1);
  const w1 = w - 1;
  const h1 = h - 1;
  const tile = rtinTile(w, h);
  const size = tile + 1;
  const errors = rtinErrors(heights, w, h, tile);

  // Two walks over the same triangle tree: the first marks the samples used and
  // counts triangles, the second writes them once the arrays are allocated.
  const vertexOf = new Int32Array(w * h).fill(-1);
  let indices = new Uint32Array(0);
  let t = 0;
  let triangles = 0;
  let emit = false;
  const visit = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): void => {
    if (Math.min(ax, bx, cx) >= w1 || Math.min(ay, by, cy) >= h1) return; // padding
    const mx = (ax + bx) >> 1;
    const my = (ay + by) >> 1;
    if (Math.abs(ax - cx) + Math.abs(ay - cy) > 1 && errors[my * size + mx] > maxError) {
      visit(cx, cy, ax, ay, mx, my);
      visit(bx, by, cx, cy, mx, my);
      return;
    }
    if (!emit) {
      mark(ay * w + ax);
      mark(by * w + bx);
      mark(cy * w + cx);
      triangles++;
      return;
    }
    // Grid y points down and world y up: CCW from above is a negative grid cross product.
    const flip = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) > 0;
    indices[t++] = vertex(ax, ay);
    indices[t++] = flip ? vertex(cx, cy) : vertex(bx, by);
    indices[t++] = flip ? vertex(bx, by) : vertex(cx, cy);
  };
  let used = 0;
  const mark = (i: number) => {
    if (vertexOf[i] === -1) {
      vertexOf[i] = -2;
      used++;
    }
  };
  // Vertices are numbered in the order triangles first use them, so indices
  // grow in small steps and the 3MF deflates well.
  let positions = new Float32Array(0);
  let next = 0;
  const vertex = (x: number, y: number): number => {
    const i = y * w + x;
    let v = vertexOf[i];
    if (v < 0) {
      v = vertexOf[i] = next++;
      positions[v * 3] = x * sx;
      positions[v * 3 + 1] = (h1 - y) * sy;
      positions[v * 3 + 2] = heights[i];
    }
    return v;
  };
  visit(0, 0, tile, tile, tile, 0);
  visit(tile, tile, 0, 0, 0, tile);

  positions = new Float32Array(used * 3);
  indices = new Uint32Array(triangles * 3);
  emit = true;
  visit(0, 0, tile, tile, tile, 0);
  visit(tile, tile, 0, 0, 0, tile);

  // Perimeter, CCW seen from above: bottom edge (world y = 0, image row h-1) left→right,
  // right edge upwards, top edge right→left, left edge downwards. Only samples the
  // top uses, so the walls meet it without T-junctions.
  const ring = new Uint32Array(2 * w1 + 2 * h1);
  let perimeter = 0;
  const keep = (i: number) => {
    if (vertexOf[i] >= 0) ring[perimeter++] = vertexOf[i];
  };
  for (let x = 0; x < w1; x++) keep(h1 * w + x);
  for (let y = h1; y > 0; y--) keep(y * w + w1);
  for (let x = w1; x > 0; x--) keep(x);
  for (let y = 0; y < h1; y++) keep(y * w);
  return { positions, indices, ring: ring.slice(0, perimeter) };
}

/** Adds the side walls and the bottom fan under a top sheet. */
function closeSolid(top: TopSheet, input: SolidHeightfieldInput): MeshData {
  const topCount = top.positions.length / 3;
  const topTriangles = top.indices.length / 3;
  const perimeter = top.ring.length;
  const vertexCount = topCount + perimeter + 1;
  const triangleCount = topTriangles + 3 * perimeter;
  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(triangleCount * 3);
  positions.set(top.positions);
  indices.set(top.indices);
  let t = top.indices.length;

  const bottomStart = topCount;
  for (let i = 0; i < perimeter; i++) {
    const src = top.ring[i] * 3;
    const o = (bottomStart + i) * 3;
    positions[o] = positions[src];
    positions[o + 1] = positions[src + 1];
    positions[o + 2] = 0;
  }
  const centre = bottomStart + perimeter;
  positions[centre * 3] = input.widthMm / 2;
  positions[centre * 3 + 1] = input.heightMm / 2;
  positions[centre * 3 + 2] = 0;

  for (let i = 0; i < perimeter; i++) {
    const j = i + 1 === perimeter ? 0 : i + 1;
    const tp = top.ring[i];
    const tq = top.ring[j];
    const bp = bottomStart + i;
    const bq = bottomStart + j;
    // Side wall, outward.
    indices[t++] = bp; indices[t++] = bq; indices[t++] = tq;
    indices[t++] = bp; indices[t++] = tq; indices[t++] = tp;
    // Bottom fan, facing -z.
    indices[t++] = centre; indices[t++] = bq; indices[t++] = bp;
  }

  return { positions, indices, triangleCount };
}

/** Side (in cells) of the power-of-two RTIN tile covering a w×h sample grid. */
function rtinTile(w: number, h: number): number {
  let tile = 2;
  while (tile < Math.max(w, h) - 1) tile *= 2;
  return tile;
}

/**
 * RTIN error per sample of the padded (tile + 1)² grid, stored at the midpoint
 * of each triangle's hypotenuse: the largest distance between a sample and the
 * plane of the triangles that splitting there would refine, children included.
 * Triangles crossing the grid border get Infinity so they always split down to
 * pieces entirely inside or outside; triangles in the padding are skipped.
 *
 * Hypotenuse midpoints come in two kinds per square size s (s = 2, 4 … tile):
 * edge midpoints, whose two triangles lie on either side of an edge of length
 * s with the right angle at the neighbouring square centres; and square
 * centres, whose two triangles share a diagonal of the square (alternating
 * with the square's parity, as in a 4-8 mesh). Walking the levels from the
 * smallest up makes every child final before its parent reads it.
 */
function rtinErrors(heights: Float32Array, w: number, h: number, tile: number): Float32Array {
  const size = tile + 1;
  const w1 = w - 1;
  const h1 = h - 1;
  const errors = new Float32Array(size * size);
  const height = (x: number, y: number) => heights[y * w + x];
  // 0 = inside the grid, 1 = in the padding, 2 = crossing the border.
  const classify = (x0: number, y0: number, x1: number, y1: number) =>
    x0 >= w1 || y0 >= h1 ? 1 : x1 <= w1 && y1 <= h1 ? 0 : 2;

  // Edge a–b with midpoint m; triangles with the right angle at m ± (dx, dy).
  const edge = (ax: number, ay: number, bx: number, by: number, mx: number, my: number, dx: number, dy: number, leaf: boolean) => {
    let e = 0;
    let inside = false;
    for (let side = -1; side <= 1; side += 2) {
      const cx = mx + side * dx;
      const cy = my + side * dy;
      if (cx < 0 || cy < 0 || cx > tile || cy > tile) continue;
      const k = classify(Math.min(ax, cx), Math.min(ay, cy), Math.max(bx, cx), Math.max(by, cy));
      if (k === 1) continue;
      if (k === 2) {
        errors[my * size + mx] = Infinity;
        return;
      }
      inside = true;
      if (leaf) continue;
      // Children: centres of the two half-size squares between the edge and c.
      const l = errors[((ay + cy) >> 1) * size + ((ax + cx) >> 1)];
      const r = errors[((by + cy) >> 1) * size + ((bx + cx) >> 1)];
      if (l > e) e = l;
      if (r > e) e = r;
    }
    if (!inside) return;
    const d = Math.abs((height(ax, ay) + height(bx, by)) / 2 - height(mx, my));
    errors[my * size + mx] = d > e ? d : e;
  };

  for (let s = 2; s <= tile; s *= 2) {
    const half = s >> 1;
    const leaf = s === 2;
    for (let y = 0; y <= tile; y += s) for (let x = half; x < tile; x += s) edge(x - half, y, x + half, y, x, y, 0, half, leaf);
    for (let y = half; y < tile; y += s) for (let x = 0; x <= tile; x += s) edge(x, y - half, x, y + half, x, y, half, 0, leaf);
    for (let y = half; y < tile; y += s) {
      for (let x = half; x < tile; x += s) {
        const x0 = x - half;
        const y0 = y - half;
        const x1 = x + half;
        const y1 = y + half;
        const k = classify(x0, y0, x1, y1);
        if (k === 1) continue;
        const m = y * size + x;
        if (k === 2) {
          errors[m] = Infinity;
          continue;
        }
        const main = ((x0 / s + y0 / s) & 1) === 0;
        let e = Math.abs((main ? height(x0, y0) + height(x1, y1) : height(x1, y0) + height(x0, y1)) / 2 - height(x, y));
        // Children: the four edge midpoints of the square.
        const n = errors[y0 * size + x];
        const so = errors[y1 * size + x];
        const we = errors[y * size + x0];
        const ea = errors[y * size + x1];
        if (n > e) e = n;
        if (so > e) e = so;
        if (we > e) e = we;
        if (ea > e) e = ea;
        errors[m] = e;
      }
    }
  }
  return errors;
}

/**
 * Every undirected edge used by exactly two triangles, in opposite directions
 * (consistent orientation). Directed edges are sorted as numeric keys, so this
 * stays fast enough to run on every export.
 */
export function checkWatertight(mesh: MeshData): { ok: boolean; badEdges: number } {
  const { indices, triangleCount } = mesh;
  const n = mesh.positions.length / 3;
  const keys = new Float64Array(triangleCount * 3);
  for (let t = 0, k = 0; t < triangleCount; t++) {
    for (let e = 0; e < 3; e++) keys[k++] = indices[t * 3 + e] * n + indices[t * 3 + ((e + 1) % 3)];
  }
  keys.sort();
  let bad = 0;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if ((i > 0 && keys[i - 1] === k) || (i + 1 < keys.length && keys[i + 1] === k)) {
      bad++;
      continue;
    }
    const a = Math.floor(k / n);
    if (!hasKey(keys, (k - a * n) * n + a)) bad++;
  }
  return { ok: bad === 0, badEdges: bad };
}

function hasKey(sorted: Float64Array, key: number): boolean {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = sorted[mid];
    if (v === key) return true;
    if (v < key) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

/** Signed volume via the divergence theorem (positive for outward normals). */
export function signedVolume(mesh: MeshData): number {
  const { positions: p, indices: ix, triangleCount } = mesh;
  let v = 0;
  for (let t = 0; t < triangleCount; t++) {
    const a = ix[t * 3] * 3;
    const b = ix[t * 3 + 1] * 3;
    const c = ix[t * 3 + 2] * 3;
    v +=
      p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
      p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
      p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}
