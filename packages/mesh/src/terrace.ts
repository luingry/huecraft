import earcut from 'earcut';
import type { MeshData } from './index.js';

export interface TerracedSolidInput {
  /** Layer count per grid sample, row-major, row 0 = top of the image. */
  field: Uint16Array;
  width: number;
  height: number;
  widthMm: number;
  heightMm: number;
  /** z of the plateau for layer count n (index n). */
  zOfCount: Float32Array;
  /**
   * Give up (return null) once the contours show the mesh would need more
   * triangles than this, before the costly face triangulation.
   */
  maxTriangles?: number;
  /**
   * Layer range of the solid (default 0 and unbounded): it fills layers
   * [minCount, min(count, maxCount)) of each sample, i.e. from the plateau of
   * minCount up to the plateau of the clamped count. Samples at or below
   * minCount hold no material. Contours stay those of the raw field, so solids
   * cut from one field at adjacent ranges share their surfaces exactly.
   */
  minCount?: number;
  maxCount?: number;
}

/**
 * Watertight solid made of flat terraces with vertical walls, slicing exactly
 * like the snapped heightfield of `buildSolidHeightfieldMesh`.
 *
 * A slicer only sees the cross-sections at mid-layer planes. On the
 * heightfield (cells split along the a–d diagonal, interpolated linearly) the
 * cross-section between layers n-1 and n is the level set "count = n - ½",
 * which marching triangles traces exactly. Each such contour becomes a wall
 * from the plateau of n-1 to the plateau of n, and the regions between
 * consecutive contours become flat faces. Contour points that are collinear
 * with their neighbours carry no shape and are dropped, so long smooth
 * contours keep only their corners: the slices stay identical while the mesh
 * shrinks by several times on smooth reliefs. Noisy reliefs (contours around
 * single samples) can come out larger than the heightfield: pass the
 * heightfield's triangle count as `maxTriangles` to bail out early.
 *
 * Coordinates as in the heightfield mesh: grid samples span widthMm × heightMm,
 * world y up (image row 0 at y = heightMm), z up from the bed.
 */
export function buildTerracedSolidMesh(input: TerracedSolidInput): MeshData | null {
  const { field, width: w, height: h, zOfCount } = input;
  if (w < 2 || h < 2) throw new Error('Field needs at least 2×2 samples');
  const w1 = w - 1;
  const h1 = h - 1;
  const sx = input.widthMm / w1;
  const sy = input.heightMm / h1;
  const out = new MeshBuilder();
  const lo = Math.max(0, Math.floor(input.minCount ?? 0));

  let nMin = 0xffff;
  let nMax = 0;
  for (let i = 0; i < field.length; i++) {
    const v = field[i];
    if (v < nMin) nMin = v;
    if (v > nMax) nMax = v;
  }
  nMax = Math.min(nMax, input.maxCount ?? Infinity);
  if (nMax <= lo) throw new Error('Terrace mesh: no sample above minCount');
  nMin = Math.min(Math.max(nMin, lo), nMax);
  const clamp = (v: number) => (v < lo ? lo : v > nMax ? nMax : v);
  // Some samples are empty: the bottom follows the material instead of filling the rectangle.
  const holes = nMin === lo;

  // --- Contour segments per level (level n = the set "count = n - ½"). ---
  // Edge ids: horizontal (x,y)–(x+1,y) = 3i, vertical (x,y)–(x,y+1) = 3i+1,
  // diagonal (x,y)–(x+1,y+1) = 3i+2, with i = y·w + x. Each segment runs from
  // one crossed edge to the other with the higher side on its left (world).
  const segs: U32Grow[] = [];
  for (let n = 0; n <= nMax; n++) segs.push(new U32Grow());
  const tri = (v0: number, v1: number, v2: number, e01: number, e12: number, e02: number) => {
    const from = Math.max(Math.min(v0, v1, v2), lo);
    const to = Math.min(Math.max(v0, v1, v2), nMax);
    for (let n = from + 1; n <= to; n++) {
      const m = n - 0.5;
      const h0 = v0 > m;
      const h1v = v1 > m;
      const h2 = v2 > m;
      // Lone vertex L and the other two in the triangle's cyclic order (L, a, b).
      let eLa: number, eLb: number, lHigh: boolean;
      if (h0 !== h1v && h0 !== h2) {
        eLa = e01; eLb = e02; lHigh = h0;
      } else if (h1v !== h0 && h1v !== h2) {
        eLa = e12; eLb = e01; lHigh = h1v;
      } else {
        eLa = e02; eLb = e12; lHigh = h2;
      }
      // Both cell triangles are clockwise in world coordinates, which puts L on
      // the right of La→Lb.
      if (lHigh) segs[n].push2(eLb, eLa);
      else segs[n].push2(eLa, eLb);
    }
  };
  for (let y = 0; y < h1; y++) {
    for (let x = 0; x < w1; x++) {
      const i = y * w + x;
      const a = field[i];
      const b = field[i + 1];
      const c = field[i + w];
      const d = field[i + w + 1];
      if (a === b && a === c && a === d) continue;
      // (a, b, d): edges H(x,y), V(x+1,y), D(x,y). (a, d, c): D(x,y), H(x,y+1), V(x,y).
      tri(a, b, d, i * 3, (i + 1) * 3 + 1, i * 3 + 2);
      tri(a, d, c, i * 3 + 2, (i + w) * 3, i * 3 + 1);
    }
  }

  const edgePoint = (e: number, n: number, p: Float64Array, k: number) => {
    const kind = e % 3;
    const i = (e - kind) / 3;
    const x = i % w;
    const y = (i - x) / w;
    const x2 = kind === 1 ? x : x + 1;
    const y2 = kind === 0 ? y : y + 1;
    const va = field[i];
    const t = (n - 0.5 - va) / (field[y2 * w + x2] - va);
    p[k] = (x + t * (x2 - x)) * sx;
    p[k + 1] = (h1 - (y + t * (y2 - y))) * sy;
  };

  // --- Chains per level, collinear points dropped. ---
  const chains: Chain[] = [];
  // Each kept point is on two faces and two wall quads: about 4 triangles.
  const budget = input.maxTriangles ?? Infinity;
  let keptPoints = 0;
  const nextSeg = new Int32Array(3 * w * h).fill(-1);
  const isEnd = new Uint8Array(3 * w * h);
  for (let n = nMin + 1; n <= nMax; n++) {
    const s = segs[n];
    const count = s.length >> 1;
    if (count === 0) continue;
    const a = s.data;
    for (let k = 0; k < count; k++) {
      nextSeg[a[2 * k]] = k;
      isEnd[a[2 * k + 1]] = 1;
    }
    const done = new Uint8Array(count);
    const walk = (k0: number, closed: boolean) => {
      const edges: number[] = [a[2 * k0]];
      let k = k0;
      for (;;) {
        done[k] = 1;
        const end = a[2 * k + 1];
        const nk = nextSeg[end];
        if (nk < 0 || done[nk]) {
          if (!closed) edges.push(end);
          break;
        }
        edges.push(end);
        k = nk;
      }
      const pts = new Float64Array(edges.length * 2);
      for (let j = 0; j < edges.length; j++) edgePoint(edges[j], n, pts, j * 2);
      const kept = dropCollinear(pts, closed);
      const len = kept.length >> 1;
      const low = new Int32Array(len);
      const high = new Int32Array(len);
      for (let j = 0; j < len; j++) {
        low[j] = out.vertex(kept[2 * j], kept[2 * j + 1], zOfCount[n - 1]);
        high[j] = out.vertex(kept[2 * j], kept[2 * j + 1], zOfCount[n]);
      }
      const chain: Chain = { level: n, closed, pts: kept, low, high, startS: 0, endS: 0 };
      if (!closed) {
        chain.startS = perimeterParam(kept[0] / sx, h1 - kept[1] / sy, w1, h1);
        chain.endS = perimeterParam(kept[(len - 1) * 2] / sx, h1 - kept[(len - 1) * 2 + 1] / sy, w1, h1);
      }
      chains.push(chain);
      keptPoints += len;
    };
    // Open chains start on the border, at an edge no segment ends on.
    for (let k = 0; k < count; k++) {
      if (!isEnd[a[2 * k]]) walk(k, false);
      if (4 * keptPoints > budget) return null;
    }
    for (let k = 0; k < count; k++) {
      if (!done[k]) walk(k, true);
      if (4 * keptPoints > budget) return null;
    }
    for (let k = 0; k < count; k++) {
      nextSeg[a[2 * k]] = -1;
      isEnd[a[2 * k + 1]] = 0;
    }
  }

  // --- Perimeter: corners and contour ends, CCW from the world origin. ---
  const perimeterLength = 2 * w1 + 2 * h1;
  const cornerS = [0, w1, w1 + h1, 2 * w1 + h1];
  const cornerXY = [
    [0, 0],
    [input.widthMm, 0],
    [input.widthMm, input.heightMm],
    [0, input.heightMm],
  ];
  const cornerIds = new Map<number, number>();
  const cornerId = (c: number, n: number) => {
    const key = n * 4 + c;
    let id = cornerIds.get(key);
    if (id === undefined) {
      id = out.vertex(cornerXY[c][0], cornerXY[c][1], zOfCount[n]);
      cornerIds.set(key, id);
    }
    return id;
  };
  // Count interpolated along the border at parameter s.
  const borderValue = (s: number) => {
    let gx: number, gy: number;
    if (s < w1) { gx = s; gy = h1; }
    else if (s < w1 + h1) { gx = w1; gy = h1 - (s - w1); }
    else if (s < 2 * w1 + h1) { gx = w1 - (s - w1 - h1); gy = 0; }
    else { gx = 0; gy = s - 2 * w1 - h1; }
    const x0 = Math.min(w1 - 1, Math.floor(gx));
    const y0 = Math.min(h1 - 1, Math.floor(gy));
    const fx = gx - x0;
    const fy = gy - y0;
    const i = y0 * w + x0;
    // On the border one of fx / fy is 0 or 1, so this is a 1D interpolation.
    const top = field[i] + (field[i + 1] - field[i]) * fx;
    const bottom = field[i + w] + (field[i + w + 1] - field[i + w]) * fx;
    return clamp(top + (bottom - top) * fy);
  };

  // --- Faces: the region between contours n and n+1, at z of n. ---
  const byLevel: Chain[][] = [];
  for (let n = 0; n <= nMax + 1; n++) byLevel.push([]);
  for (const c of chains) byLevel[c.level].push(c);
  for (let f = holes ? lo + 1 : nMin; f <= nMax; f++) {
    const loops: Loop[] = [];
    const arcs: Arc[] = [];
    for (const c of byLevel[f]) {
      const ids = Array.from(c.high);
      const xy = Array.from(c.pts);
      if (c.closed) loops.push({ ids, xy });
      else arcs.push({ ids, xy, startS: c.startS, endS: c.endS, used: false });
    }
    for (const c of f + 1 <= nMax ? byLevel[f + 1] : []) {
      const ids = Array.from(c.low).reverse();
      const xy = reversePoints(c.pts);
      if (c.closed) loops.push({ ids, xy });
      else arcs.push({ ids, xy, startS: c.endS, endS: c.startS, used: false });
    }
    if (arcs.length > 0) {
      arcs.sort((p, q) => p.startS - q.startS);
      for (const first of arcs) {
        if (first.used) continue;
        const loop: Loop = { ids: [], xy: [] };
        let cur = first;
        do {
          cur.used = true;
          loop.ids.push(...cur.ids);
          loop.xy.push(...cur.xy);
          const next = nextArc(arcs, cur.endS);
          // Corners passed walking CCW from cur's end to next's start.
          const span = (next.startS - cur.endS + perimeterLength) % perimeterLength;
          const corners: number[] = [];
          for (let c = 0; c < 4; c++) {
            const d = (cornerS[c] - cur.endS + perimeterLength) % perimeterLength;
            if (d > 0 && d < span) corners.push(c);
          }
          corners.sort((p, q) => ((cornerS[p] - cur.endS + perimeterLength) % perimeterLength) - ((cornerS[q] - cur.endS + perimeterLength) % perimeterLength));
          for (const c of corners) {
            loop.ids.push(cornerId(c, f));
            loop.xy.push(cornerXY[c][0], cornerXY[c][1]);
          }
          cur = next;
        } while (cur !== first);
        loops.push(loop);
      }
    } else if (clamp(field[0]) === f && !borderHasCrossing(chains, f)) {
      loops.push({ ids: [0, 1, 2, 3].map((c) => cornerId(c, f)), xy: cornerXY.flat() });
    }
    if (loops.length > 0) triangulateFace(loops, out, sy, h1);
  }

  // --- Walls along every contour: from the plateau of n-1 up to n, facing the lower side. ---
  for (const c of chains) {
    const len = c.low.length;
    const segCount = c.closed ? len : len - 1;
    for (let j = 0; j < segCount; j++) {
      const k = j + 1 === len ? 0 : j + 1;
      out.triangle(c.low[j], c.low[k], c.high[k]);
      out.triangle(c.low[j], c.high[k], c.high[j]);
    }
  }

  // --- Border walls and bottom. ---
  type PerimeterPoint = { s: number; corner: number; chain: Chain | null; bottom: number; x: number; y: number };
  const perimeter: PerimeterPoint[] = [];
  for (let c = 0; c < 4; c++) perimeter.push({ s: cornerS[c], corner: c, chain: null, bottom: -1, x: cornerXY[c][0], y: cornerXY[c][1] });
  for (const c of chains) {
    if (c.closed) continue;
    const last = c.pts.length - 2;
    perimeter.push({ s: c.startS, corner: -1, chain: c, bottom: -1, x: c.pts[0], y: c.pts[1] });
    perimeter.push({ s: c.endS, corner: -1, chain: c, bottom: -1, x: c.pts[last], y: c.pts[last + 1] });
  }
  perimeter.sort((p, q) => p.s - q.s);
  const zBottom = zOfCount[lo];
  for (const p of perimeter) {
    // The lowest contour's bottom vertex is shared: its wall and the bottom both end on it.
    if (p.chain && p.chain.level === lo + 1) p.bottom = p.chain.low[chainEnd(p, p.chain)];
    else p.bottom = out.vertex(p.x, p.y, zBottom);
  }
  // Vertical run of vertices at a perimeter point for a border piece at level f.
  const column = (p: PerimeterPoint, f: number): number[] => {
    if (p.chain === null) return [p.bottom, cornerId(p.corner, f)];
    const c = p.chain;
    const at = chainEnd(p, c);
    if (c.level === lo + 1) return [p.bottom, c.high[at]];
    return f === c.level ? [p.bottom, c.low[at], c.high[at]] : [p.bottom, c.low[at]];
  };
  for (let i = 0; i < perimeter.length; i++) {
    const p = perimeter[i];
    const q = perimeter[(i + 1) % perimeter.length];
    const span = (q.s - p.s + perimeterLength) % perimeterLength;
    const f = Math.round(borderValue((p.s + span / 2) % perimeterLength));
    if (f === lo) continue; // empty: no wall
    const left = column(p, f);
    const right = column(q, f);
    // Zip the two vertical runs by height; seen from outside they go left → right.
    let a = 0;
    let b = 0;
    while (a < left.length - 1 || b < right.length - 1) {
      const za = a < left.length - 1 ? out.z(left[a + 1]) : Infinity;
      const zb = b < right.length - 1 ? out.z(right[b + 1]) : Infinity;
      if (zb <= za) {
        out.triangle(left[a], right[b], right[b + 1]);
        b++;
      } else {
        out.triangle(left[a], right[b], left[a + 1]);
        a++;
      }
    }
  }
  if (!holes) {
    const centre = out.vertex(input.widthMm / 2, input.heightMm / 2, zBottom);
    for (let i = 0; i < perimeter.length; i++) {
      const j = (i + 1) % perimeter.length;
      out.triangle(centre, perimeter[j].bottom, perimeter[i].bottom);
    }
    return out.finish();
  }

  // --- Bottom with holes: the region left of the lowest contours, facing down. ---
  // Built like a face, but along the border it takes every perimeter point so
  // the border walls meet it without T-junctions.
  const loops: Loop[] = [];
  const arcs: Arc[] = [];
  for (const c of byLevel[lo + 1]) {
    const ids = Array.from(c.low);
    const xy = Array.from(c.pts);
    if (c.closed) loops.push({ ids, xy });
    else arcs.push({ ids, xy, startS: c.startS, endS: c.endS, used: false });
  }
  // Appends the perimeter points strictly between s0 and s1, walking CCW.
  const between = (s0: number, s1: number, loop: Loop) => {
    const span = (s1 - s0 + perimeterLength) % perimeterLength;
    const pts = perimeter
      .map((p) => ({ p, d: (p.s - s0 + perimeterLength) % perimeterLength }))
      .filter((e) => e.d > 0 && e.d < span)
      .sort((a, b) => a.d - b.d);
    for (const { p } of pts) {
      loop.ids.push(p.bottom);
      loop.xy.push(p.x, p.y);
    }
  };
  if (arcs.length > 0) {
    arcs.sort((p, q) => p.startS - q.startS);
    for (const first of arcs) {
      if (first.used) continue;
      const loop: Loop = { ids: [], xy: [] };
      let cur = first;
      do {
        cur.used = true;
        loop.ids.push(...cur.ids);
        loop.xy.push(...cur.xy);
        const next = nextArc(arcs, cur.endS);
        between(cur.endS, next.startS, loop);
        cur = next;
      } while (cur !== first);
      loops.push(loop);
    }
  } else if (clamp(field[0]) > lo) {
    loops.push({ ids: perimeter.map((p) => p.bottom), xy: perimeter.flatMap((p) => [p.x, p.y]) });
  }
  const firstBottom = out.triangleCount;
  if (loops.length > 0) triangulateFace(loops, out, sy, h1);
  out.flipFrom(firstBottom);

  return out.finish();
}

interface Chain {
  level: number;
  closed: boolean;
  /** World x, y per kept point. */
  pts: Float64Array;
  /** Vertex ids at the plateau below (level - 1) and above (level). */
  low: Int32Array;
  high: Int32Array;
  /** Perimeter parameter of the first / last point (open chains). */
  startS: number;
  endS: number;
}

interface Loop {
  ids: number[];
  xy: number[];
}

interface Arc extends Loop {
  startS: number;
  endS: number;
  used: boolean;
}

/** Index of the chain point a perimeter point sits on (its first or last). */
function chainEnd(p: { s: number; x: number; y: number }, c: Chain): number {
  return p.s === c.startS && p.x === c.pts[0] && p.y === c.pts[1] ? 0 : c.low.length - 1;
}

/** Position along the border, CCW in world coordinates, from grid coordinates on the border. */
function perimeterParam(gx: number, gy: number, w1: number, h1: number): number {
  const eps = 1e-9;
  if (Math.abs(gy - h1) < eps) return gx;
  if (Math.abs(gx - w1) < eps) return w1 + (h1 - gy);
  if (Math.abs(gy) < eps) return w1 + h1 + (w1 - gx);
  return 2 * w1 + h1 + gy;
}

function nextArc(arcs: Arc[], s: number): Arc {
  // First arc starting after s (cyclically); arcs are sorted by startS.
  let lo = 0;
  let hi = arcs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arcs[mid].startS > s) hi = mid;
    else lo = mid + 1;
  }
  return arcs[lo === arcs.length ? 0 : lo];
}

function borderHasCrossing(chains: Chain[], f: number): boolean {
  for (const c of chains) if (!c.closed && (c.level === f || c.level === f + 1)) return true;
  return false;
}

function reversePoints(p: Float64Array): number[] {
  const n = p.length >> 1;
  const out = new Array<number>(p.length);
  for (let i = 0; i < n; i++) {
    out[2 * i] = p[2 * (n - 1 - i)];
    out[2 * i + 1] = p[2 * (n - 1 - i) + 1];
  }
  return out;
}

/** Points with every point collinear with its kept neighbours removed (ends of open chains kept). */
function dropCollinear(p: Float64Array, closed: boolean): Float64Array {
  const n = p.length >> 1;
  const collinear = (a: number, b: number, c: number) => {
    const ux = p[2 * b] - p[2 * a];
    const uy = p[2 * b + 1] - p[2 * a + 1];
    const vx = p[2 * c] - p[2 * b];
    const vy = p[2 * c + 1] - p[2 * b + 1];
    const cross = ux * vy - uy * vx;
    return Math.abs(cross) <= 1e-9 * Math.hypot(ux, uy) * Math.hypot(vx, vy) && ux * vx + uy * vy > 0;
  };
  const order: number[] = [];
  if (closed) {
    // Start at a real corner so the wrap-around is handled like an open chain.
    let start = 0;
    while (start < n && collinear((start + n - 1) % n, start, (start + 1) % n)) start++;
    if (start === n) start = 0;
    for (let k = 0; k <= n; k++) order.push((start + k) % n);
  } else {
    for (let k = 0; k < n; k++) order.push(k);
  }
  const kept: number[] = [order[0]];
  for (let k = 1; k < order.length - 1; k++) {
    if (!collinear(kept[kept.length - 1], order[k], order[k + 1])) kept.push(order[k]);
  }
  if (!closed) kept.push(order[order.length - 1]);
  const r = new Float64Array(kept.length * 2);
  for (let k = 0; k < kept.length; k++) {
    r[2 * k] = p[2 * kept[k]];
    r[2 * k + 1] = p[2 * kept[k] + 1];
  }
  return r;
}

/** Deterministic offset in ±1e-8 for the k-th coordinate. */
function nudge(k: number): number {
  const x = Math.sin(k * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2e-8;
}

function signedArea(xy: number[]): number {
  let a = 0;
  const n = xy.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) a += (xy[2 * j] - xy[2 * i]) * (xy[2 * j + 1] + xy[2 * i + 1]);
  return a / 2;
}

/**
 * Triangulates one face (all its loops share a z): CCW loops are outer
 * boundaries, CW loops holes. Each hole joins the loop met first by a ray cast
 * leftwards from its leftmost point (that loop bounds the same piece of face).
 */
function triangulateFace(loops: Loop[], out: MeshBuilder, sy: number, h1: number): void {
  const outer = loops.map((l) => signedArea(l.xy) > 0);
  const parent = loops.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  if (outer.some((o) => !o)) {
    // Edges bucketed by grid row band.
    const rows = h1;
    const buckets: number[][] = Array.from({ length: rows }, () => []);
    const ex: number[] = [];
    for (let l = 0; l < loops.length; l++) {
      const xy = loops[l].xy;
      const n = xy.length >> 1;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const y0 = xy[2 * i + 1];
        const y1 = xy[2 * j + 1];
        if (y0 === y1) continue;
        const e = ex.length / 5;
        ex.push(xy[2 * i], y0, xy[2 * j], y1, l);
        const r0 = Math.max(0, Math.min(rows - 1, Math.floor(Math.min(y0, y1) / sy)));
        const r1 = Math.max(0, Math.min(rows - 1, Math.floor(Math.max(y0, y1) / sy)));
        for (let r = r0; r <= r1; r++) buckets[r].push(e);
      }
    }
    for (let l = 0; l < loops.length; l++) {
      if (outer[l]) continue;
      const xy = loops[l].xy;
      let px = Infinity;
      let py = 0;
      for (let i = 0; i < xy.length; i += 2) {
        if (xy[i] < px || (xy[i] === px && xy[i + 1] < py)) {
          px = xy[i];
          py = xy[i + 1];
        }
      }
      const r = Math.max(0, Math.min(rows - 1, Math.floor(py / sy)));
      let best = -Infinity;
      let hit = -1;
      for (const e of buckets[r]) {
        const owner = ex[e * 5 + 4];
        if (owner === l) continue;
        const x0 = ex[e * 5];
        const y0 = ex[e * 5 + 1];
        const x1 = ex[e * 5 + 2];
        const y1 = ex[e * 5 + 3];
        if (y0 > py === y1 > py) continue;
        const x = x0 + ((py - y0) * (x1 - x0)) / (y1 - y0);
        if (x < px && x > best) {
          best = x;
          hit = owner;
        }
      }
      if (hit < 0) throw new Error('Terrace mesh: hole without an enclosing loop');
      parent[find(l)] = find(hit);
    }
  }
  const groups = new Map<number, number[]>();
  for (let l = 0; l < loops.length; l++) {
    const root = find(l);
    let g = groups.get(root);
    if (!g) groups.set(root, (g = []));
    g.push(l);
  }
  for (const g of groups.values()) {
    g.sort((a, b) => Number(outer[b]) - Number(outer[a])); // the outer loop first
    const coords: number[] = [];
    const ids: number[] = [];
    const holes: number[] = [];
    const starts: number[] = [];
    for (let k = 0; k < g.length; k++) {
      const loop = loops[g[k]];
      if (k > 0) holes.push(ids.length);
      starts.push(ids.length);
      // Triangulated on coordinates nudged by ~1e-8 mm (far below any contour
      // spacing): with exactly collinear points of different loops earcut can run
      // a diagonal straight through a vertex, leaving a T-junction. The nudge
      // turns that into a zero-area triangle that still shares its edges.
      for (let v = 0; v < loop.xy.length; v++) coords.push(loop.xy[v] + nudge(coords.length));
      for (const id of loop.ids) ids.push(id);
    }
    starts.push(ids.length);
    const raw = earcut(coords, holes);
    // Orient CCW (facing +z) and index directed edges.
    const edgeTri = new Map<number, number>();
    const n = ids.length;
    const tris: number[] = [];
    for (let t = 0; t < raw.length; t += 3) {
      const a = raw[t], b = raw[t + 1], c = raw[t + 2];
      const area = (coords[2 * b] - coords[2 * a]) * (coords[2 * c + 1] - coords[2 * a + 1]) - (coords[2 * b + 1] - coords[2 * a + 1]) * (coords[2 * c] - coords[2 * a]);
      const u = tris.length;
      if (area > 0) tris.push(a, b, c);
      else tris.push(a, c, b);
      for (let e = 0; e < 3; e++) edgeTri.set(tris[u + e] * n + tris[u + ((e + 1) % 3)], u);
    }
    // earcut drops collinear boundary points (border runs). Put each back by
    // splitting the triangle on the edge spanning it, or the walls would meet
    // T-junctions there.
    const used = new Uint8Array(n);
    for (let t = 0; t < tris.length; t++) used[tris[t]] = 1;
    const split = (a: number, c: number, p: number) => {
      const t = edgeTri.get(a * n + c);
      if (t === undefined) throw new Error('Terrace mesh: dropped boundary point off any edge');
      const x = tris[t] === a ? tris[t + 2] : tris[t + 1] === a ? tris[t] : tris[t + 1];
      edgeTri.delete(a * n + c);
      tris[t] = a; tris[t + 1] = p; tris[t + 2] = x;
      edgeTri.set(a * n + p, t); edgeTri.set(p * n + x, t); edgeTri.set(x * n + a, t);
      const u = tris.length;
      tris.push(p, c, x);
      edgeTri.set(p * n + c, u); edgeTri.set(c * n + x, u); edgeTri.set(x * n + p, u);
    };
    for (let k = 0; k < g.length; k++) {
      const s0 = starts[k];
      const len = starts[k + 1] - s0;
      for (let i = 0; i < len; i++) {
        const a = s0 + i;
        if (!used[a] || used[s0 + ((i + 1) % len)]) continue;
        // a is followed by a run of dropped points up to the next used one, c.
        let j = (i + 1) % len;
        while (!used[s0 + j]) j = (j + 1) % len;
        const c = s0 + j;
        for (let m = (i + 1) % len, prev = a; s0 + m !== c; m = (m + 1) % len) {
          split(prev, c, s0 + m);
          used[s0 + m] = 1;
          prev = s0 + m;
        }
      }
    }
    for (let t = 0; t < tris.length; t += 3) out.triangle(ids[tris[t]], ids[tris[t + 1]], ids[tris[t + 2]]);
  }
}

class U32Grow {
  data = new Uint32Array(64);
  length = 0;
  push2(a: number, b: number): void {
    if (this.length + 2 > this.data.length) {
      const next = new Uint32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = a;
    this.data[this.length++] = b;
  }
}

class MeshBuilder {
  private pos = new Float32Array(3 * 1024);
  private idx = new Uint32Array(3 * 1024);
  private vertices = 0;
  private triangles = 0;

  vertex(x: number, y: number, z: number): number {
    if ((this.vertices + 1) * 3 > this.pos.length) {
      const next = new Float32Array(this.pos.length * 2);
      next.set(this.pos);
      this.pos = next;
    }
    const o = this.vertices * 3;
    this.pos[o] = x;
    this.pos[o + 1] = y;
    this.pos[o + 2] = z;
    return this.vertices++;
  }

  z(v: number): number {
    return this.pos[v * 3 + 2];
  }

  triangle(a: number, b: number, c: number): void {
    if ((this.triangles + 1) * 3 > this.idx.length) {
      const next = new Uint32Array(this.idx.length * 2);
      next.set(this.idx);
      this.idx = next;
    }
    const o = this.triangles * 3;
    this.idx[o] = a;
    this.idx[o + 1] = b;
    this.idx[o + 2] = c;
    this.triangles++;
  }

  get triangleCount(): number {
    return this.triangles;
  }

  /** Reverses the winding of every triangle from `first` on. */
  flipFrom(first: number): void {
    for (let t = first; t < this.triangles; t++) {
      const o = t * 3;
      const b = this.idx[o + 1];
      this.idx[o + 1] = this.idx[o + 2];
      this.idx[o + 2] = b;
    }
  }

  finish(): MeshData {
    return { positions: this.pos.slice(0, this.vertices * 3), indices: this.idx.slice(0, this.triangles * 3), triangleCount: this.triangles };
  }
}
