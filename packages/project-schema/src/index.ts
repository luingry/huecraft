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
  /**
   * Number of flat height steps the relief is cut into (after smoothing), for
   * a simpler print with less shading. 0 = off (continuous relief).
   */
  posterize: number;
  /**
   * Colour-driven heights, 0..1. 0 (or missing) = height from luma only. Above
   * 0 each pixel takes the layer count whose printed colour best matches it,
   * pulled towards the luma height by (1 - colorMatch). Depends on the stack.
   */
  colorMatch?: number;
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

/**
 * How a filament swap is written into the exported 3MF. 'pause' / 'color-change'
 * stop for a manual swap; 'ams' switches filament automatically (one filament
 * slot per colour of the stack, multi-material unit such as a Bambu AMS).
 */
export type SwapCommand = 'pause' | 'color-change' | 'ams';

/**
 * How the print lies on the bed. 'faceUp': the image is the top relief, colours
 * change by layer with filament swaps. 'faceDown': the image faces the build
 * plate (smooth or textured finish); the model is turned over and the gaps in
 * front of the relief are filled with clear filament, so every layer mixes
 * filaments and needs a multi-material printer (AMS / MMU).
 */
export type PrintOrientation = 'faceUp' | 'faceDown';

export interface ExportParams {
  swapCommand: SwapCommand;
}

export type ProfileMode = 'basic' | 'advanced';

export type PaintBlend = 'normal' | 'raise' | 'lower' | 'onLight' | 'onDark' | 'sampled';

/** How a 'select' stroke combines with the current selection. */
export type SelectOp = 'replace' | 'add' | 'subtract' | 'invert' | 'clear';

/**
 * One brush stroke painted on the 3D view. Painting a filament pushes the
 * relief of the area to the top layer of that filament's band, so the colour
 * shows up in the print (heights are the only thing a layer swap can change).
 */
export interface PaintStroke {
  id: string;
  /**
   * Missing / 'brush': a brush stroke along `points`. 'fill': paint bucket
   * seeded at points[0..1], covering the colour there within `tolerance`
   * (connected area only when `contiguous`). 'select': paints nothing; picks
   * the same kind of area and combines it into the selection with `selectOp`.
   * While a selection exists, every later stroke only touches selected columns.
   * Fill and select judge the surface as it is when they are applied.
   */
  kind?: 'brush' | 'fill' | 'select';
  /** fill / select: only the area connected to the seed (default true). */
  contiguous?: boolean;
  /** select: how the picked area combines with the selection (default 'replace'). */
  selectOp?: SelectOp;
  /**
   * 'paint' pushes the area to a filament's band, 'erase' back to the unpainted
   * relief, 'brighten' / 'darken' move each column to a layer whose printed
   * colour is lighter / darker, by up to `opacity` × the range of printable
   * luminances (scaled by the brush coverage).
   */
  mode: 'paint' | 'erase' | 'brighten' | 'darken';
  /**
   * How paint meets the surface: 'normal' pulls every column to the target,
   * 'raise' / 'lower' only touch columns below / above it, 'onLight' / 'onDark'
   * only colours lighter / darker than the brush colour (Photoshop's Darken /
   * Lighten), 'sampled' only colours close to `sampleLayer`. Missing = 'normal'.
   */
  blend?: PaintBlend;
  /** 'sampled': layer count under the brush centre when the stroke began. */
  sampleLayer?: number;
  /**
   * Colour blends, 0..1. 'sampled': max colour distance still painted (default 0.15).
   * 'onLight' / 'onDark': how much lighter / darker than the brush colour (in
   * luminance) a colour must be to be painted (default 0).
   * fill / select: max colour distance from the colour at the seed (default 0.15).
   */
  tolerance?: number;
  /** Filament painted; the target layer follows its band when swaps move. */
  slotId: string;
  /** Layer count the area reaches, as resolved when painted (fallback if the slot is gone). */
  layer: number;
  /** Brush radius as a fraction of the model width. */
  radius: number;
  /** 0 = hard edge, 1 = fully feathered. */
  softness: number;
  /** 0..1, applied once per stroke (overlapping dabs do not build up). */
  opacity: number;
  /** Flattened u, v pairs in image space (0..1, v down). */
  points: number[];
}

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
  /** Brush strokes painted over the relief, oldest first. */
  paint?: PaintStroke[];
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
  posterize: 0,
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
    paint: Array.isArray(v2.paint) ? v2.paint : [],
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
