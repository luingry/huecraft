export interface FilamentRecord {
  id: string;
  name: string;
  brand: string;
  colorHex: string;
  lab: { l: number; a: number; b: number };
  tdMm: number;
  notes?: string;
  source: 'builtin' | 'user' | 'imported';
  calibratedAt?: string;
  metadata?: {
    calibrationHistory?: Array<{ tdMm: number; method: string; at: string }>;
  };
}

export interface FilamentLibraryExport {
  schemaVersion: 1;
  exportedAt: string;
  filaments: FilamentRecord[];
}

export const STARTER_FILAMENTS: FilamentRecord[] = [
  {
    id: 'builtin-black',
    name: 'Opaque Black PLA',
    brand: 'Generic',
    colorHex: '#1a1a1a',
    lab: { l: 8, a: 0, b: 0 },
    tdMm: 0.3,
    source: 'builtin',
  },
  {
    id: 'builtin-white-trans',
    name: 'Translucent White PLA',
    brand: 'Generic',
    colorHex: '#f0ece4',
    lab: { l: 94, a: 0, b: 4 },
    tdMm: 8,
    source: 'builtin',
  },
  {
    id: 'builtin-white-opaque',
    name: 'Opaque White PLA',
    brand: 'Generic',
    colorHex: '#f5f5f5',
    lab: { l: 96, a: 0, b: 0 },
    tdMm: 1.2,
    source: 'builtin',
  },
  {
    id: 'builtin-red',
    name: 'Red PLA',
    brand: 'Generic',
    colorHex: '#c0392b',
    lab: { l: 48, a: 58, b: 42 },
    tdMm: 2.5,
    source: 'builtin',
  },
  {
    id: 'builtin-gray-mid',
    name: 'Mid Gray PLA',
    brand: 'Generic',
    colorHex: '#7a7a7a',
    lab: { l: 52, a: 0, b: 0 },
    tdMm: 1.8,
    source: 'builtin',
  },
  ...bambuBasic([
    ['black', 'Black', '#000000', 0.6],
    ['jade-white', 'Jade White', '#ffffff', 3.6],
    ['light-gray', 'Light Gray', '#d1d3d5', 2.8],
    ['gray', 'Gray', '#8e9089', 1.6],
    ['red', 'Red', '#c12e1f', 2.6],
    ['orange', 'Orange', '#ff6a13', 3.2],
    ['yellow', 'Yellow', '#f4ee2a', 4.5],
    ['beige', 'Beige', '#f7e6de', 3.4],
    ['cyan', 'Cyan', '#0086d6', 2.2],
    ['blue', 'Blue', '#0a2989', 1.4],
    ['magenta', 'Magenta', '#ec008c', 2.4],
  ]),
];

/** Bambu Lab PLA Basic starters. TD values are approximate community measurements; calibrate your own spools. */
function bambuBasic(rows: Array<[string, string, string, number]>): FilamentRecord[] {
  return rows.map(([id, color, hex, td]) => {
    const { r, g, b } = hexToRgb(hex);
    return {
      id: `builtin-bambu-pla-basic-${id}`,
      name: `PLA Basic ${color}`,
      brand: 'Bambu Lab',
      colorHex: hex,
      lab: rgbToLab(r, g, b),
      tdMm: td,
      notes: 'Approximate TD (community value), calibrate for best results.',
      source: 'builtin',
    };
  });
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToLab(r: number, g: number, b: number): { l: number; a: number; b: number } {
  const sr = srgbToLinear(r / 255);
  const sg = srgbToLinear(g / 255);
  const sb = srgbToLinear(b / 255);
  const x = sr * 0.4124564 + sg * 0.3575761 + sb * 0.1804375;
  const y = sr * 0.2126729 + sg * 0.7151522 + sb * 0.072175;
  const z = sr * 0.0193339 + sg * 0.119192 + sb * 0.9503041;
  const xr = fLab(x / 0.95047);
  const yr = fLab(y / 1.0);
  const zr = fLab(z / 1.08883);
  return { l: 116 * yr - 16, a: 500 * (xr - yr), b: 200 * (yr - zr) };
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function fLab(t: number): number {
  const d = 6 / 29;
  return t > d ** 3 ? Math.cbrt(t) : t / (3 * d * d) + 4 / 29;
}

export function createFilamentFromHex(
  name: string,
  brand: string,
  colorHex: string,
  tdMm: number,
): FilamentRecord {
  const { r, g, b } = hexToRgb(colorHex);
  return {
    id: crypto.randomUUID(),
    name,
    brand,
    colorHex,
    lab: rgbToLab(r, g, b),
    tdMm,
    source: 'user',
    calibratedAt: new Date().toISOString(),
  };
}
