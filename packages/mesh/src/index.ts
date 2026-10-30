/**
 * Mesh builders. All arrays are counted first and preallocated; no `number[]`.
 *
 * Coordinate system (both meshes): millimetres, x to the right (0..width),
 * y up with the top row of the image at y = height, z up from the bed (z = 0).
 */

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
 * stay crisp (flat shading). Walls take the colour of the taller column.
 */
export function buildTerracedMesh(input: TerracedMeshInput): TerracedMesh {
  const { field, width: w, height: h, zOfCount } = input;
  const px = input.widthMm / w;
  const py = input.heightMm / h;

  // Pass 1: count quads.
  let quads = 1; // bottom
  for (let y = 0; y < h; y++) {
    const row = y * w;
    // Top runs and vertical x-walls at run boundaries.
    let runs = 1;
    for (let x = 1; x < w; x++) if (field[row + x] !== field[row + x - 1]) runs++;
    quads += runs * 2 - 1; // runs + (runs - 1) x-walls
    quads += 2; // left and right border walls
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
        if (a !== prevA || b !== prevB) quads++;
        prevA = a;
        prevB = b;
      }
    }
  }
  // Top and bottom border walls (merged by equal count).
  for (const row of [0, (h - 1) * w]) {
    quads++;
    for (let x = 1; x < w; x++) if (field[row + x] !== field[row + x - 1]) quads++;
  }

  const positions = new Float32Array(quads * 12);
  const printedColors = new Float32Array(quads * 12);
  const slicerColors = new Float32Array(quads * 12);
  const indices = new Uint32Array(quads * 6);
  const lutP = toFloatLut(input.printedLut);
  const lutS = toFloatLut(input.slicerLut);

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
        // x-wall between this run and the next one, owned by the taller column.
        const m = field[row + x];
        const zm = zOfCount[m];
        if (n > m) quad(x1, yBot, zm, x1, yTop, zm, x1, yTop, z, x1, yBot, z, n); // faces +x
        else quad(x1, yTop, z, x1, yBot, z, x1, yBot, zm, x1, yTop, zm, m); // faces -x
      }
      runStart = x;
    }
    // Left (-x) and right (+x) border walls.
    const nl = field[row];
    const zl = zOfCount[nl];
    quad(0, yTop, 0, 0, yBot, 0, 0, yBot, zl, 0, yTop, zl, nl);
    const nr = field[row + w - 1];
    const zr = zOfCount[nr];
    const xr = w * px;
    quad(xr, yBot, 0, xr, yTop, 0, xr, yTop, zr, xr, yBot, zr, nr);
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
        const za = zOfCount[a];
        const zb = zOfCount[b];
        const x0 = x * px;
        const x1 = e * px;
        if (a > b) quad(x0, yBot, zb, x1, yBot, zb, x1, yBot, za, x0, yBot, za, a); // upper row taller: faces -y
        else quad(x1, yBot, za, x0, yBot, za, x0, yBot, zb, x1, yBot, zb, b); // lower row taller: faces +y
        x = e;
      }
    }
  }
  // Top border (y = height, faces +y) and bottom border (y = 0, faces -y).
  const yMax = h * py;
  borderRuns(field, 0, w, (x0, x1, n) => {
    const z = zOfCount[n];
    quad(x1 * px, yMax, 0, x0 * px, yMax, 0, x0 * px, yMax, z, x1 * px, yMax, z, n);
  });
  borderRuns(field, (h - 1) * w, w, (x0, x1, n) => {
    const z = zOfCount[n];
    quad(x0 * px, 0, 0, x1 * px, 0, 0, x1 * px, 0, z, x0 * px, 0, z, n);
  });
  // Bottom (faces -z), coloured like the base.
  const nb = input.printedLut.length >= 6 ? 1 : 0; // n = 1: colour of the first layer
  quad(0, 0, 0, 0, yMax, 0, w * px, yMax, 0, w * px, 0, 0, nb);

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
}

/**
 * Watertight, manifold solid for printing: the top surface is the heightfield
 * (one vertex per grid sample spanning exactly widthMm × heightMm), side walls
 * run along the four borders down to z = 0, and the bottom is a fan of the
 * perimeter vertices around a single centre vertex (no full bottom grid, no
 * T-junctions). Triangles are CCW seen from outside (outward normals).
 */
export function buildSolidHeightfieldMesh(input: SolidHeightfieldInput): MeshData {
  const { heights, width: w, height: h } = input;
  if (w < 2 || h < 2) throw new Error('Heightfield needs at least 2×2 samples');
  const sx = input.widthMm / (w - 1);
  const sy = input.heightMm / (h - 1);
  const topCount = w * h;
  const perimeter = 2 * (w - 1) + 2 * (h - 1);
  const vertexCount = topCount + perimeter + 1;
  const triangleCount = 2 * (w - 1) * (h - 1) + 3 * perimeter;
  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(triangleCount * 3);

  for (let y = 0, o = 0; y < h; y++) {
    const py = (h - 1 - y) * sy;
    for (let x = 0; x < w; x++, o += 3) {
      positions[o] = x * sx;
      positions[o + 1] = py;
      positions[o + 2] = heights[y * w + x];
    }
  }

  let t = 0;
  // Top: cell corners a=(x,y) b=(x+1,y) c=(x,y+1) d=(x+1,y+1); row y+1 is lower in world y.
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const a = y * w + x;
      const b = a + 1;
      const c = a + w;
      const d = c + 1;
      indices[t++] = a; indices[t++] = c; indices[t++] = d;
      indices[t++] = a; indices[t++] = d; indices[t++] = b;
    }
  }

  // Perimeter, CCW seen from above: bottom edge (world y = 0, image row h-1) left→right,
  // right edge upwards, top edge right→left, left edge downwards.
  const ring = new Uint32Array(perimeter);
  let k = 0;
  for (let x = 0; x < w - 1; x++) ring[k++] = (h - 1) * w + x;
  for (let y = h - 1; y > 0; y--) ring[k++] = y * w + (w - 1);
  for (let x = w - 1; x > 0; x--) ring[k++] = x;
  for (let y = 0; y < h - 1; y++) ring[k++] = y * w;

  const bottomStart = topCount;
  for (let i = 0; i < perimeter; i++) {
    const src = ring[i] * 3;
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
    const tp = ring[i];
    const tq = ring[j];
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

/** Every undirected edge used by exactly two triangles, in opposite directions (consistent orientation). */
export function checkWatertight(mesh: MeshData): { ok: boolean; badEdges: number } {
  const directed = new Map<string, number>();
  const { indices, triangleCount } = mesh;
  for (let t = 0; t < triangleCount; t++) {
    for (let e = 0; e < 3; e++) {
      const a = indices[t * 3 + e];
      const b = indices[t * 3 + ((e + 1) % 3)];
      const k = `${a},${b}`;
      directed.set(k, (directed.get(k) ?? 0) + 1);
    }
  }
  let bad = 0;
  for (const [k, n] of directed) {
    const [a, b] = k.split(',');
    if (n !== 1 || directed.get(`${b},${a}`) !== 1) bad++;
  }
  return { ok: bad === 0, badEdges: bad };
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
