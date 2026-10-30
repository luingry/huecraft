/**
 * hueCraft project schema.
 *
 * v2 replaces the per-pixel filament model of v1 with a global layer stack:
 * every filament starts at a fixed layer index for the whole print, exactly
 * like a manual filament swap (pause) in the slicer.
 */

export interface ReliefParams {
  /** Linear contrast around mid-gray. 1 = unchanged. */
  contrast: number;
  /** Brightness offset in [-1, 1] applied before contrast. 0 = unchanged. */
  brightness: number;
  /** Gamma applied to the normalized luminance. 1 = linear. */
  gamma: number;
  /** When true dark pixels become tall instead of light ones. */
  invert: boolean;
  /** Box-blur radius in output pixels used to clean noisy images. 0 = off. */
  smoothing: number;
}

export interface PrintParams {
  /** Height of layers 2..N in mm. */
  layerHeightMm: number;
  /** Height of the first layer in mm. */
  firstLayerHeightMm: number;
  /** Solid base below the relief in mm (rounded up to whole layers). */
  baseThicknessMm: number;
  /** Total model height (base + relief) in mm for the brightest pixel. */
  maxHeightMm: number;
  /** Physical model width in mm. Height follows the image aspect ratio. */
  widthMm: number;
  /** Extrusion line width in mm. Drives the slicer-preview detail limit. */
  lineWidthMm: number;
  /** Sampling pitch of the exported mesh in mm. */
  exportResolutionMm: number;
  /** Snap exported heights to layer tops so the slicer slices predictably. */
  snapToLayers: boolean;
}

/** One filament in the vertical stack. Filament snapshot is embedded so projects are self-contained. */
export interface StackEntry {
  slotId: string;
  /** Layer index (0-based) where this filament starts. Entry 0 always starts at 0. */
  startLayer: number;
  filament: StackFilament;
}

export interface StackFilament {
  /** Library id this slot was created from, if any. */
  libraryId?: string;
  name: string;
  brand: string;
  colorHex: string;
  /** Transmission distance in mm (HueForge-compatible semantics). */
  tdMm: number;
}

/** How a filament swap is written into the exported 3MF. */
export type SwapCommand = 'pause' | 'color-change';

export interface ExportParams {
  swapCommand: SwapCommand;
}

export type ProfileMode = 'basic' | 'advanced';

export interface HueCraftProject {
  schemaVersion: 2;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  relief: ReliefParams;
  print: PrintParams;
  stack: StackEntry[];
  export: ExportParams;
  imageWidth?: number;
  imageHeight?: number;
}

export const PROJECT_SCHEMA_VERSION = 2 as const;

export const DEFAULT_RELIEF: ReliefParams = {
  contrast: 1,
  brightness: 0,
  gamma: 1,
  invert: false,
  smoothing: 0,
};

export const DEFAULT_PRINT: PrintParams = {
  layerHeightMm: 0.08,
  firstLayerHeightMm: 0.16,
  baseThicknessMm: 0.48,
  maxHeightMm: 2.4,
  widthMm: 100,
  lineWidthMm: 0.42,
  exportResolutionMm: 0.1,
  snapToLayers: true,
};

export function createEmptyProject(name = 'Untitled'): HueCraftProject {
  const now = new Date().toISOString();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    relief: { ...DEFAULT_RELIEF },
    print: { ...DEFAULT_PRINT },
    stack: [],
    export: { swapCommand: 'pause' },
  };
}

/** Z of the top of layer `index` (0-based). */
export function layerTopZ(print: Pick<PrintParams, 'layerHeightMm' | 'firstLayerHeightMm'>, index: number): number {
  return print.firstLayerHeightMm + index * print.layerHeightMm;
}

/** Number of whole layers the solid base occupies. */
export function baseLayerCount(print: Pick<PrintParams, 'layerHeightMm' | 'firstLayerHeightMm' | 'baseThicknessMm'>): number {
  if (print.baseThicknessMm <= print.firstLayerHeightMm + 1e-6) return 1;
  return 1 + Math.ceil((print.baseThicknessMm - print.firstLayerHeightMm) / print.layerHeightMm - 1e-6);
}

/** Total number of layers of the tallest column. */
export function totalLayerCount(print: Pick<PrintParams, 'layerHeightMm' | 'firstLayerHeightMm' | 'maxHeightMm'>): number {
  if (print.maxHeightMm <= print.firstLayerHeightMm) return 1;
  return 1 + Math.round((print.maxHeightMm - print.firstLayerHeightMm) / print.layerHeightMm);
}

/** Filament index active at layer `layer`, given a stack sorted by startLayer. */
export function filamentIndexAtLayer(stack: Pick<StackEntry, 'startLayer'>[], layer: number): number {
  let idx = 0;
  for (let i = 1; i < stack.length; i++) {
    if (stack[i].startLayer <= layer) idx = i;
    else break;
  }
  return idx;
}

export function validateProject(data: unknown): HueCraftProject {
  if (!data || typeof data !== 'object') throw new Error('Invalid project');
  const p = data as { schemaVersion?: number; id?: string; name?: string };
  if (!p.id || !p.name) throw new Error('Missing id or name');
  if (p.schemaVersion === 1) return migrateV1(data as V1Project);
  if (p.schemaVersion !== 2) throw new Error(`Unsupported schema version ${p.schemaVersion}`);
  const v2 = data as HueCraftProject;
  return {
    ...v2,
    relief: { ...DEFAULT_RELIEF, ...v2.relief },
    print: { ...DEFAULT_PRINT, ...v2.print },
    export: { ...v2.export, swapCommand: v2.export?.swapCommand ?? 'pause' },
    stack: Array.isArray(v2.stack) ? v2.stack : [],
  };
}

interface V1Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  relief?: { contrast?: number; gamma?: number };
  print?: { layerHeightMm?: number; baseThicknessMm?: number; maxHeightMm?: number; mmPerPixel?: number };
  imageWidth?: number;
  imageHeight?: number;
}

function migrateV1(v1: V1Project): HueCraftProject {
  const print = { ...DEFAULT_PRINT };
  if (v1.print?.layerHeightMm) print.layerHeightMm = v1.print.layerHeightMm;
  if (v1.print?.baseThicknessMm) print.baseThicknessMm = v1.print.baseThicknessMm;
  if (v1.print?.maxHeightMm) print.maxHeightMm = v1.print.baseThicknessMm
    ? v1.print.maxHeightMm + v1.print.baseThicknessMm
    : v1.print.maxHeightMm;
  if (v1.print?.mmPerPixel && v1.imageWidth) print.widthMm = Math.round(v1.print.mmPerPixel * v1.imageWidth);
  return {
    schemaVersion: 2,
    id: v1.id,
    name: v1.name,
    createdAt: v1.createdAt,
    updatedAt: v1.updatedAt,
    relief: { ...DEFAULT_RELIEF, contrast: v1.relief?.contrast ?? 1, gamma: v1.relief?.gamma ?? 1 },
    print,
    stack: [],
    export: { swapCommand: 'pause' },
    imageWidth: v1.imageWidth,
    imageHeight: v1.imageHeight,
  };
}
