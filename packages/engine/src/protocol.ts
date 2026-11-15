import type { AutoTuneParams, AutoTuneResult } from './autotune.js';
import type { PaintStroke, PrintOrientation, PrintParams, ReliefParams, StackEntry, SwapCommand } from '@huecraft/project-schema';

/** Source image kept resident inside the worker. Sent once per import. */
export interface SourceImage {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export interface PreviewParams {
  relief: ReliefParams;
  print: PrintParams;
  stack: StackEntry[];
  /** Longest edge, in pixels, of the preview grid. */
  maxEdge: number;
  /** Apply the nozzle line-width detail limit to the slicer preview. */
  simulateLineWidth: boolean;
  /** Brush strokes with their target layer already resolved (see resolvePaintLayers). */
  paint?: PaintStroke[];
  /**
   * Stack whose colours colour-aware blends compare against. Defaults to
   * `stack`; the app passes the full stack so hiding a colour in the preview
   * does not change where the paint lands (exports never hide colours).
   */
  paintStack?: StackEntry[];
}

export interface SwapInfo {
  /** 0-based layer index where the new filament starts. */
  layer: number;
  /** 1-based layer number as the slicer shows it. */
  slicerLayer: number;
  /** Z (mm) of the top of the first layer printed with the new filament (slicer `top_z`). */
  topZMm: number;
  /** Z (mm) where the previous layer ends, i.e. the nozzle height when pausing. */
  pauseAtZMm: number;
  slotId: string;
  filamentName: string;
  colorHex: string;
}

export interface PreviewResult {
  width: number;
  height: number;
  /** Predicted printed appearance (TD blending, linear light). RGBA. */
  printedRgba: Uint8ClampedArray;
  /** What the slicer preview shows: opaque top-layer filament colour. RGBA. */
  slicerRgba: Uint8ClampedArray;
  /** Layer count per pixel (number of layers printed at that column). */
  layerField: Uint16Array;
  /** Pixels per layer count, index = layer count. Used for the stack histogram. */
  layerHistogram: Uint32Array;
  /** Colour per layer count for printed / slicer modes, RGB 0..255, index = layer count. */
  printedLut: Uint8Array;
  slicerLut: Uint8Array;
  totalLayers: number;
  baseLayers: number;
  sizeMm: { width: number; height: number; z: number };
  swaps: SwapInfo[];
  /** Terraced preview mesh (flat plateau per layer count). */
  mesh: {
    positions: Float32Array;
    indices: Uint32Array;
    printedColors: Float32Array;
    slicerColors: Float32Array;
    triangleCount: number;
  };
  timings: Record<string, number>;
}

export interface ExportRequestParams {
  name: string;
  relief: ReliefParams;
  print: PrintParams;
  stack: StackEntry[];
  swapCommand: SwapCommand;
  format: '3mf' | 'stl';
  /**
   * 'faceDown': turned over with a clear filler, one part per filament (see
   * faceDown.ts). The 3MF then carries no swaps or slicer template, and the STL
   * becomes a zip with one file per filament. Missing = 'faceUp'.
   */
  orientation?: PrintOrientation;
  /** Brush strokes with their target layer already resolved (see resolvePaintLayers). */
  paint?: PaintStroke[];
  /** The preview simulated the line width: colour blends judge line-width blocks, as they were shown. */
  simulateLineWidth?: boolean;
  /**
   * Optional (additive): bytes of any project 3MF saved by the user's own Bambu
   * Studio or OrcaSlicer. Its printer/process/filament configuration is copied
   * into the export (layer heights overridden) so those slicers open the export
   * as a project and apply the filament swaps automatically. Without it the
   * swaps are still embedded, but Bambu Studio / OrcaSlicer only read them from
   * project files (PrusaSlicer reads them when opened as a project).
   */
  slicerTemplate?: Uint8Array;
}

export interface ExportResult {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  triangleCount: number;
  swapText: string;
  /** Optional (additive): generator of the slicer template applied, e.g. "BambuStudio-02.08.03.66". */
  slicerProject?: string;
  timings: Record<string, number>;
}

export type WorkerRequest =
  | { type: 'setImage'; id: number; image: SourceImage }
  | { type: 'preview'; id: number; params: PreviewParams }
  | { type: 'export'; id: number; params: ExportRequestParams }
  | { type: 'autoTune'; id: number; params: AutoTuneParams };

export type WorkerResponse =
  | { type: 'ok'; id: number }
  | { type: 'preview'; id: number; result: PreviewResult }
  | { type: 'export'; id: number; result: ExportResult }
  | { type: 'autoTune'; id: number; result: AutoTuneResult }
  | { type: 'error'; id: number; message: string };
