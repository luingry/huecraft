import type { MeshData } from './index.js';

/**
 * 5×7 pixel font, one string of 7 rows (top first) per glyph, '#' = filled.
 * Uppercase ASCII only: callers pass text through `toFontText`.
 */
const GLYPHS: Record<string, string> = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#',
  B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  C: '.###.|#...#|#....|#....|#....|#...#|.###.',
  D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
  E: '#####|#....|#....|####.|#....|#....|#####',
  F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.###.|#...#|#....|#.###|#...#|#...#|.####',
  H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  I: '.###.|..#..|..#..|..#..|..#..|..#..|.###.',
  J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..',
  K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#',
  L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#',
  N: '#...#|#...#|##..#|#.#.#|#..##|#...#|#...#',
  O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  P: '####.|#...#|#...#|####.|#....|#....|#....',
  Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#',
  R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.',
  T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  W: '#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.',
  X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..',
  Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  '0': '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.',
  '1': '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  '2': '.###.|#...#|....#|...#.|..#..|.#...|#####',
  '3': '#####|...#.|..#..|...#.|....#|#...#|.###.',
  '4': '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.',
  '5': '#####|#....|####.|....#|....#|#...#|.###.',
  '6': '..##.|.#...|#....|####.|#...#|#...#|.###.',
  '7': '#####|....#|...#.|..#..|.#...|.#...|.#...',
  '8': '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
  '9': '.###.|#...#|#...#|.####|....#|...#.|.##..',
  ' ': '.....|.....|.....|.....|.....|.....|.....',
  '.': '.....|.....|.....|.....|.....|.##..|.##..',
  ',': '.....|.....|.....|.....|.##..|..#..|.#...',
  ':': '.....|.##..|.##..|.....|.##..|.##..|.....',
  '-': '.....|.....|.....|#####|.....|.....|.....',
  '+': '.....|..#..|..#..|#####|..#..|..#..|.....',
  '>': '.#...|..#..|...#.|....#|...#.|..#..|.#...',
  '<': '...#.|..#..|.#...|#....|.#...|..#..|...#.',
  '/': '.....|....#|...#.|..#..|.#...|#....|.....',
  '(': '...#.|..#..|.#...|.#...|.#...|..#..|...#.',
  ')': '.#...|..#..|...#.|...#.|...#.|..#..|.#...',
  '#': '.#.#.|.#.#.|#####|.#.#.|#####|.#.#.|.#.#.',
  '=': '.....|.....|#####|.....|#####|.....|.....',
  '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..',
  '?': '.###.|#...#|....#|...#.|..#..|.....|..#..',
  '%': '##...|##..#|...#.|..#..|.#...|#..##|...##',
  '*': '.....|..#..|#.#.#|.###.|#.#.#|..#..|.....',
  "'": '..#..|..#..|.#...|.....|.....|.....|.....',
  '_': '.....|.....|.....|.....|.....|.....|#####',
};

const COLS = 5;
const ROWS = 7;
/** Glyph advance and line pitch, in font pixels. */
const ADVANCE = COLS + 1;
const LINE_PITCH = ROWS + 3;

/** Uppercase, accents removed, characters the font lacks turned into '?'. */
export function toFontText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[×]/g, 'X')
    .replace(/[→]/g, '>')
    .replace(/./gu, (c) => (GLYPHS[c] ? c : '?'));
}

export interface TextMeshOptions {
  /** Size of one font pixel (mm). Glyphs are 5 × 7 pixels. */
  pixelMm: number;
  /** Extrusion height (mm), from z = zMm. */
  depthMm: number;
  /** Top-left corner of the first line (mm). y grows upwards, lines go down. */
  x: number;
  y: number;
  zMm?: number;
}

/** Extent (mm) of `lines` set in the pixel font. */
export function measureText(lines: string[], pixelMm: number): { width: number; height: number } {
  const cols = Math.max(0, ...lines.map((l) => toFontText(l).length));
  return {
    width: Math.max(0, cols * ADVANCE - 1) * pixelMm,
    height: lines.length === 0 ? 0 : ((lines.length - 1) * LINE_PITCH + ROWS) * pixelMm,
  };
}

/**
 * Text as a mesh of closed boxes, one per horizontal run of filled pixels
 * (boxes touch but are not merged: fine for slicer modifiers and previews, not
 * a single manifold solid).
 */
export function buildTextMesh(lines: string[], opts: TextMeshOptions): MeshData {
  const runs: [number, number, number][] = []; // [col, row, length] in font pixels, row 0 = top
  lines.forEach((raw, li) => {
    const text = toFontText(raw);
    for (let r = 0; r < ROWS; r++) {
      const row = li * LINE_PITCH + r;
      let start = -1;
      const flush = (end: number) => {
        if (start >= 0) runs.push([start, row, end - start]);
        start = -1;
      };
      for (let ci = 0; ci < text.length; ci++) {
        const bits = GLYPHS[text[ci]].split('|')[r];
        for (let c = 0; c < ADVANCE; c++) {
          const col = ci * ADVANCE + c;
          const on = c < COLS && bits[c] === '#';
          if (on && start < 0) start = col;
          else if (!on) flush(col);
        }
      }
      flush(text.length * ADVANCE);
    }
  });

  const positions = new Float32Array(runs.length * 8 * 3);
  const indices = new Uint32Array(runs.length * 12 * 3);
  const p = opts.pixelMm;
  const z0 = opts.zMm ?? 0;
  const z1 = z0 + opts.depthMm;
  // Box corners: bit 0 = x, bit 1 = y, bit 2 = z. Outward-facing triangles.
  const faces = [
    0, 2, 3, 0, 3, 1, // bottom (z0)
    4, 5, 7, 4, 7, 6, // top (z1)
    0, 1, 5, 0, 5, 4, // y0
    2, 6, 7, 2, 7, 3, // y1
    0, 4, 6, 0, 6, 2, // x0
    1, 3, 7, 1, 7, 5, // x1
  ];
  runs.forEach(([col, row, len], b) => {
    const xa = opts.x + col * p;
    const xb = xa + len * p;
    const yb = opts.y - row * p;
    const ya = yb - p;
    for (let k = 0; k < 8; k++) {
      const o = (b * 8 + k) * 3;
      positions[o] = k & 1 ? xb : xa;
      positions[o + 1] = k & 2 ? yb : ya;
      positions[o + 2] = k & 4 ? z1 : z0;
    }
    for (let i = 0; i < faces.length; i++) indices[b * 36 + i] = b * 8 + faces[i];
  });
  return { positions, indices, triangleCount: runs.length * 12 };
}
