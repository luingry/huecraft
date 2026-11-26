import {
  baseLayerCount,
  layerTopZ,
  totalLayerCount,
  type PrintParams,
  type ReliefParams,
} from '@huecraft/project-schema';
import {
  exportGridSize,
  extractLumaAlpha,
  previewGridSize,
  reliefField,
  resizeLumaAlpha,
  type GridSize,
  type LumaAlpha,
} from '@huecraft/image-core';
import {
  buildPrintedLut,
  buildSlicerLut,
  computeLayerField,
  computeLineLimitedLayerField,
  heightForRelief,
  layerFieldToRgba,
  layerHistogram,
  type LayerModel,
} from '@huecraft/optics';
import { buildSolidHeightfieldMesh, buildTerracedMesh, buildTerracedSolidMesh } from '@huecraft/mesh';
import { export3mf, exportBambuPartsProject, exportBinaryStl, exportStlZip, readSlicerProjectTemplate, type SlicerSwap } from '@huecraft/exporters';
import { buildSlicerNote, faceDownNoteLines, swapNoteLines } from './slicerNote.js';
import { adjustColorTarget, colorHeightField, isNeutralTone, lutToOklab } from './colorHeight.js';
import { autoTune, buildTuneTarget, type AutoTuneParams, type AutoTuneResult, type TuneTarget } from './autotune.js';
import { buildFaceDownModel, formatFaceDownPlan } from './faceDown.js';
import { applyPaint, LiveStroke, PaintCanvas, type PaintContext } from './paint.js';
import type { PaintStroke, StackEntry } from '@huecraft/project-schema';
import type { ExportRequestParams, ExportResult, PreviewParams, PreviewResult, SourceImage } from './protocol.js';
import { amsSlots, computeSwaps, FALLBACK_FILAMENT, formatSwapPlan, layerFilaments, normalizeStack } from './stack.js';

/** Longest edge of the grid auto-tune compares on (colour error is judged from a distance). */
const AUTOTUNE_MAX_EDGE = 240;

/** Layer geometry derived from print params (validated). */
export function layerModelFor(print: PrintParams): LayerModel {
  if (!(print.layerHeightMm > 0) || !(print.firstLayerHeightMm > 0)) throw new Error('Layer heights must be positive');
  if (!(print.maxHeightMm > print.baseThicknessMm)) throw new Error('Max height must exceed the base thickness');
  const totalLayers = Math.max(1, totalLayerCount(print));
  const baseLayers = Math.max(1, Math.min(totalLayers, baseLayerCount(print)));
  return {
    firstLayerHeightMm: print.firstLayerHeightMm,
    layerHeightMm: print.layerHeightMm,
    baseThicknessMm: print.baseThicknessMm,
    maxHeightMm: print.maxHeightMm,
    baseLayers,
    totalLayers,
  };
}

/** z of the plateau of a column with n layers (index n, 0 for n = 0). */
export function plateauZ(print: PrintParams, totalLayers: number): Float32Array {
  const z = new Float32Array(totalLayers + 1);
  for (let n = 1; n <= totalLayers; n++) z[n] = layerTopZ(print, n - 1);
  return z;
}

/** Physical size: width is fixed by the user, height follows the source aspect. */
export function physicalSize(image: { width: number; height: number }, print: PrintParams): { width: number; height: number } {
  if (!(print.widthMm > 0)) throw new Error('Width must be positive');
  return { width: print.widthMm, height: (print.widthMm * image.height) / image.width };
}

class Lru<V> {
  private map = new Map<string, V>();
  constructor(private limit: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, v: V): void {
    this.map.delete(key);
    this.map.set(key, v);
    while (this.map.size > this.limit) this.map.delete(this.map.keys().next().value as string);
  }
  clear(): void {
    this.map.clear();
  }
}

function reliefKey(size: GridSize, r: ReliefParams): string {
  return `${size.width}x${size.height}|${r.brightness}|${r.contrast}|${r.gamma}|${r.invert ? 1 : 0}|${r.smoothing}|${r.posterize ?? 0}|${r.colorMatch ?? 0}`;
}

function safeFileName(name: string): string {
  const s = (name ?? '').replace(/[^\p{L}\p{N}\-_ .]+/gu, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return s.slice(0, 80) || 'huecraft';
}

/**
 * Stateful pipeline with caches, used by the worker and by the pure helpers.
 * Caches: the source (as luma/alpha), downscales per grid size, and relief
 * fields per (grid size, relief params). Moving stack handles or changing
 * print params never re-runs the resize or the relief transfer.
 */
export class EngineCore {
  private source: LumaAlpha | null = null;
  /** Original pixels, kept for auto-tune's colour target. */
  private rgba: SourceImage | null = null;
  private tuneTarget: { key: string; target: TuneTarget } | null = null;
  private colorTargets = new Lru<TuneTarget>(6);
  private grids = new Lru<LumaAlpha>(3);
  private reliefs = new Lru<Float32Array>(4);
  private paintCache: { key: string; base: Float32Array; canvas: PaintCanvas } | null = null;
  private live: LiveStroke | null = null;

  setImage(image: SourceImage): void {
    if (!(image.width > 0 && image.height > 0) || image.rgba.length < image.width * image.height * 4) {
      throw new Error('Invalid image');
    }
    this.source = extractLumaAlpha(image);
    this.rgba = image;
    this.tuneTarget = null;
    this.colorTargets.clear();
    this.grids.clear();
    this.reliefs.clear();
    this.paintCache = null;
  }

  get hasImage(): boolean {
    return this.source !== null;
  }

  private requireSource(): LumaAlpha {
    if (!this.source) throw new Error('No image loaded');
    return this.source;
  }

  private grid(size: GridSize): LumaAlpha {
    const key = `${size.width}x${size.height}`;
    let g = this.grids.get(key);
    if (!g) {
      g = resizeLumaAlpha(this.requireSource(), size);
      this.grids.set(key, g);
    }
    return g;
  }

  /** Source colours (OKLab) on a grid, with the relief's tone applied, for colour-driven heights. */
  private colorTarget(size: GridSize, relief: ReliefParams): TuneTarget {
    const key = `${size.width}x${size.height}`;
    let t = this.colorTargets.get(key);
    if (!t) {
      if (!this.rgba) throw new Error('No image loaded');
      t = buildTuneTarget(this.rgba, size.width, size.height);
      this.colorTargets.set(key, t);
    }
    if (isNeutralTone(relief)) return t;
    const tkey = `${key}|${relief.brightness}|${relief.contrast}|${relief.gamma}|${relief.smoothing}`;
    let a = this.colorTargets.get(tkey);
    if (!a) {
      a = adjustColorTarget(t, relief);
      this.colorTargets.set(tkey, a);
    }
    return a;
  }

  /**
   * Relief field t per pixel. With colorMatch > 0 the heights follow the
   * colours of `color.stack` (see colorHeight.ts), so the stack is part of the key.
   */
  private relief(size: GridSize, relief: ReliefParams, color?: { stack: StackEntry[]; print: PrintParams }): Float32Array {
    const lumaRelief = { ...relief, colorMatch: 0 };
    const key = reliefKey(size, lumaRelief);
    let t = this.reliefs.get(key);
    if (!t) {
      t = reliefField(this.grid(size), lumaRelief);
      this.reliefs.set(key, t);
    }
    const cm = relief.colorMatch ?? 0;
    if (!(cm > 0) || !color) return t;
    const model = layerModelFor(color.print);
    const lut = paintContext(color.stack, color.print, model, 1).colors;
    const ckey = `${reliefKey(size, relief)}|${model.firstLayerHeightMm}|${model.layerHeightMm}|${model.baseThicknessMm}|${model.maxHeightMm}|${lut.join(',')}`;
    let c = this.reliefs.get(ckey);
    if (!c) {
      c = colorHeightField(this.colorTarget(size, relief), t, computeLayerField(t, model), lutToOklab(lut), model, cm, relief.posterize ?? 0);
      this.reliefs.set(ckey, c);
    }
    return c;
  }

  /**
   * Relief with the brush strokes composited. The canvas holding every stroke
   * but the last is cached, and the stroke being drawn keeps its coverage, so
   * each update only rasterises the segments added since the last one.
   * Fill and select strokes are single clicks: they are settled at once.
   * Also returns the selection the strokes leave (owned by the cache).
   */
  private painted(
    size: GridSize,
    relief: ReliefParams,
    t: Float32Array,
    strokes: PaintStroke[] | undefined,
    ctx: PaintContext,
  ): { t: Float32Array; selection: Uint8Array | null } {
    if (!strokes || strokes.length === 0) return { t, selection: null };
    const model = ctx.model;
    const key = `${reliefKey(size, relief)}|${model.layerHeightMm}|${model.firstLayerHeightMm}|${model.baseThicknessMm}|${model.maxHeightMm}|${ctx.cell ?? 1}|${ctx.colors.join(',')}`;
    const last = strokes[strokes.length - 1];
    const liveBrush = (last.kind ?? 'brush') === 'brush';
    const settled = liveBrush ? strokes.slice(0, -1) : strokes;
    let cache = this.paintCache;
    if (!cache || cache.key !== key || cache.base !== t || !cache.canvas.isPrefixOf(settled)) {
      cache = { key, base: t, canvas: new PaintCanvas(t, size.width, size.height, ctx) };
      this.paintCache = cache;
    }
    const canvas = cache.canvas;
    for (let i = canvas.sigs.length; i < settled.length; i++) canvas.apply(settled[i]);
    if (!liveBrush) return { t: canvas.current, selection: canvas.selection };
    if (!this.live || this.live.width !== size.width || this.live.height !== size.height) this.live = new LiveStroke(size.width, size.height);
    return { t: this.live.render(canvas, last), selection: canvas.selection };
  }

  preview(params: PreviewParams): PreviewResult {
    const t0 = performance.now();
    const src = this.requireSource();
    const { print } = params;
    const model = layerModelFor(print);
    const size = physicalSize(src, print);
    const grid = previewGridSize(src.width, src.height, params.maxEdge);
    this.grid(grid);
    const t1 = performance.now();
    // Line-width limit: applied to every view (both colour maps and the 3D mesh)
    // so they agree with each other and with what the slicer can print. The
    // histogram stays on the full-resolution field so stack auto-distribution
    // does not jump when the toggle changes.
    const cell = lineCell(params.simulateLineWidth, print, size.width / grid.width);
    const colorStack = { stack: params.paintStack ?? params.stack, print };
    const { t, selection } = this.painted(grid, params.relief, this.relief(grid, params.relief, colorStack), params.paint, paintContext(params.paintStack ?? params.stack, print, model, cell));
    const t2 = performance.now();

    const full = computeLayerField(t, model);
    const layerHist = layerHistogram(full, model.totalLayers);
    const field = cell > 1 ? computeLineLimitedLayerField(t, grid.width, grid.height, cell, model) : full;
    const t3 = performance.now();

    const stack = normalizeStack(params.stack);
    const layers = layerFilaments(stack, model.totalLayers);
    const thickness = (k: number) => (k === 0 ? print.firstLayerHeightMm : print.layerHeightMm);
    const printedLut = buildPrintedLut(layers, thickness);
    const slicerLut = buildSlicerLut(layers);
    const printedRgba = layerFieldToRgba(field, printedLut);
    const slicerRgba = layerFieldToRgba(field, slicerLut);
    const t4 = performance.now();

    const zOfCount = plateauZ(print, model.totalLayers);
    const mesh = buildTerracedMesh({
      field,
      width: grid.width,
      height: grid.height,
      widthMm: size.width,
      heightMm: size.height,
      zOfCount,
      printedLut,
      slicerLut,
    });
    const t5 = performance.now();

    let maxN = 0;
    for (let i = 0; i < field.length; i++) if (field[i] > maxN) maxN = field[i];
    return {
      width: grid.width,
      height: grid.height,
      printedRgba,
      slicerRgba,
      layerField: field,
      // Copied: the cached canvas keeps its own, and the worker transfers this one.
      selection: selection ? selection.slice() : null,
      layerHistogram: layerHist,
      printedLut,
      slicerLut,
      totalLayers: model.totalLayers,
      baseLayers: model.baseLayers,
      sizeMm: { width: size.width, height: size.height, z: zOfCount[maxN] },
      swaps: computeSwaps(stack, print, model.totalLayers),
      mesh: {
        positions: mesh.positions,
        indices: mesh.indices,
        printedColors: mesh.printedColors,
        slicerColors: mesh.slicerColors,
        triangleCount: mesh.triangleCount,
      },
      timings: {
        resizeMs: t1 - t0,
        reliefMs: t2 - t1,
        layersMs: t3 - t2,
        colorMs: t4 - t3,
        meshMs: t5 - t4,
        totalMs: performance.now() - t0,
      },
    };
  }

  /**
   * Searches stack (and optionally tone) for the closest predicted print to
   * the source image. Brush strokes are not taken into account.
   */
  autoTune(params: AutoTuneParams): AutoTuneResult {
    const src = this.requireSource();
    if (!this.rgba) throw new Error('No image loaded');
    const { print } = params;
    const model = layerModelFor(print);
    const size = physicalSize(src, print);
    const grid = previewGridSize(src.width, src.height, AUTOTUNE_MAX_EDGE);
    const key = `${grid.width}x${grid.height}`;
    if (this.tuneTarget?.key !== key) this.tuneTarget = { key, target: buildTuneTarget(this.rgba, grid.width, grid.height) };
    const target = this.tuneTarget.target;
    const cell = lineCell(params.simulateLineWidth, print, size.width / grid.width);
    const lumaGrid = this.grid(grid);
    return autoTune(params, {
      model,
      target,
      fieldFor: (relief) => {
        const t = reliefField(lumaGrid, { ...relief, colorMatch: 0 });
        return cell > 1 ? computeLineLimitedLayerField(t, grid.width, grid.height, cell, model) : computeLayerField(t, model);
      },
    });
  }

  export(params: ExportRequestParams): ExportResult {
    const t0 = performance.now();
    const src = this.requireSource();
    const { print } = params;
    const model = layerModelFor(print);
    const size = physicalSize(src, print);
    const grid = exportGridSize(src.width, src.height, size.width, print.exportResolutionMm);
    this.grid(grid);
    const t1 = performance.now();
    const t = applyPaint(this.relief(grid, params.relief, { stack: params.stack, print }), grid.width, grid.height, params.paint ?? [], paintContext(params.stack, print, model, lineCell(!!params.simulateLineWidth, print, size.width / grid.width)));
    const t2 = performance.now();
    if (params.orientation === 'faceDown') return this.exportFaceDown(params, t, grid, size, model, [t0, t1, t2]);

    // Top surface: snapped to the layer top the slicer will print (mid-plane
    // rule), or the raw relief height.
    const heights = new Float32Array(t.length);
    let maxZ = 0;
    const field = print.snapToLayers ? computeLayerField(t, model) : null;
    const zOfCount = plateauZ(print, model.totalLayers);
    if (field) {
      for (let i = 0; i < t.length; i++) heights[i] = zOfCount[field[i]];
    } else {
      for (let i = 0; i < t.length; i++) heights[i] = heightForRelief(t[i], model);
    }
    for (let i = 0; i < heights.length; i++) if (heights[i] > maxZ) maxZ = heights[i];
    let mesh = buildSolidHeightfieldMesh({ heights, width: grid.width, height: grid.height, widthMm: size.width, heightMm: size.height });
    // Snapped reliefs can also be built as flat terraces with the same mid-layer
    // cross-sections; keep whichever needs fewer triangles (terraces win on
    // smooth images, the heightfield on noisy ones).
    if (field) {
      const terraced = buildTerracedSolidMesh({
        field,
        width: grid.width,
        height: grid.height,
        widthMm: size.width,
        heightMm: size.height,
        zOfCount,
        maxTriangles: mesh.triangleCount,
      });
      if (terraced && terraced.triangleCount < mesh.triangleCount) mesh = terraced;
    }
    const t3 = performance.now();

    const stack = normalizeStack(params.stack);
    const swaps = computeSwaps(stack, print, model.totalLayers);
    const swapText = formatSwapPlan({
      name: params.name,
      print,
      stack,
      swaps,
      swapCommand: params.swapCommand,
      totalLayers: model.totalLayers,
      baseLayers: model.baseLayers,
      sizeMm: { width: size.width, height: size.height, z: maxZ },
    });
    const base = safeFileName(params.name);
    let bytes: Uint8Array;
    let slicerProject: string | undefined;
    if (params.format === 'stl') {
      bytes = new Uint8Array(exportBinaryStl(mesh, params.name));
    } else {
      const template = params.slicerTemplate ? readSlicerProjectTemplate(params.slicerTemplate) : null;
      slicerProject = template?.application;
      const ams = params.swapCommand === 'ams' ? amsSlots(stack) : null;
      const slicerSwaps: SlicerSwap[] = swaps.map((s) => ({
        topZMm: s.topZMm,
        kind: params.swapCommand,
        ...(ams ? { extruder: ams.slotOf.get(s.slotId) ?? 1 } : {}),
        colorHex: s.colorHex,
        message: `Load ${s.filamentName}`,
      }));
      const note =
        template && params.slicerNote !== false
          ? buildSlicerNote(
              swapNoteLines({
                name: params.name,
                mode: params.swapCommand,
                firstFilament: `${(stack[0]?.filament ?? FALLBACK_FILAMENT).name}${ams ? ' [1]' : ''}`,
                swaps: swaps.map((s, i) => ({ ...s, ...(ams ? { slot: slicerSwaps[i].extruder } : {}) })),
              }),
              size.width,
            )
          : undefined;
      bytes = export3mf(mesh, {
        ...(note ? { note } : {}),
        name: params.name,
        swaps: slicerSwaps,
        attachments: { 'Metadata/hueCraft_swap_plan.txt': swapText },
        template,
        layerHeightMm: print.layerHeightMm,
        firstLayerHeightMm: print.firstLayerHeightMm,
        firstFilamentHex: (stack[0]?.filament ?? FALLBACK_FILAMENT).colorHex,
        ...(ams ? { filamentColours: ams.colours } : {}),
        sizeMm: size,
      });
    }
    const t4 = performance.now();
    return {
      bytes,
      fileName: `${base}.${params.format}`,
      mimeType: params.format === 'stl' ? 'model/stl' : 'model/3mf',
      triangleCount: mesh.triangleCount,
      swapText,
      ...(slicerProject ? { slicerProject } : {}),
      timings: {
        resizeMs: t1 - t0,
        reliefMs: t2 - t1,
        meshMs: t3 - t2,
        encodeMs: t4 - t3,
        totalMs: t4 - t0,
        gridWidth: grid.width,
        gridHeight: grid.height,
      },
    };
  }

  /** Face-down export: always layer-snapped, one part per filament (see faceDown.ts). */
  private exportFaceDown(
    params: ExportRequestParams,
    t: Float32Array,
    grid: GridSize,
    size: { width: number; height: number },
    model: LayerModel,
    [t0, t1, t2]: number[],
  ): ExportResult {
    const { print } = params;
    const stack = normalizeStack(params.stack);
    const fd = buildFaceDownModel({
      field: computeLayerField(t, model),
      width: grid.width,
      height: grid.height,
      widthMm: size.width,
      heightMm: size.height,
      print,
      totalLayers: model.totalLayers,
      stack,
    });
    const t3 = performance.now();
    const swapText = formatFaceDownPlan({
      name: params.name,
      print,
      totalLayers: model.totalLayers,
      sizeMm: { width: size.width, height: size.height, z: fd.heightMm },
      filaments: fd.filaments,
    });
    const base = safeFileName(params.name);
    let bytes: Uint8Array;
    let ext: string;
    let slicerProject: string | undefined;
    if (params.format === 'stl') {
      ext = 'zip';
      bytes = exportStlZip(
        fd.perFilament.map((e) => ({ fileName: `${base} - ${e.filament.extruder} ${safeFileName(e.filament.name)}.stl`, mesh: e.mesh })),
        { [`${base} - filamentos.txt`]: swapText },
      );
    } else {
      ext = '3mf';
      const template = params.slicerTemplate ? readSlicerProjectTemplate(params.slicerTemplate) : null;
      slicerProject = template?.application;
      const attachments = { 'Metadata/hueCraft_swap_plan.txt': swapText };
      // With the user's Bambu Studio / OrcaSlicer project the parts arrive on their
      // filaments, in their colours; without it the slicer gets plain named parts.
      bytes = template
        ? exportBambuPartsProject(fd.mesh, {
            name: params.name,
            template,
            volumes: fd.volumes,
            filamentColours: fd.filaments.map((f) => f.colorHex),
            layerHeightMm: print.layerHeightMm,
            firstLayerHeightMm: print.firstLayerHeightMm,
            sizeMm: size,
            attachments,
            ...(params.slicerNote !== false ? { note: buildSlicerNote(faceDownNoteLines(params.name, fd.filaments), size.width) } : {}),
          })
        : export3mf(fd.mesh, { name: params.name, volumes: fd.volumes, attachments });
    }
    const t4 = performance.now();
    return {
      bytes,
      fileName: `${base} (face down).${ext}`,
      mimeType: ext === 'zip' ? 'application/zip' : 'model/3mf',
      ...(slicerProject ? { slicerProject } : {}),
      triangleCount: fd.mesh.triangleCount,
      swapText,
      timings: {
        resizeMs: t1 - t0,
        reliefMs: t2 - t1,
        meshMs: t3 - t2,
        encodeMs: t4 - t3,
        totalMs: t4 - t0,
        gridWidth: grid.width,
        gridHeight: grid.height,
      },
    };
  }
}

/** Printed colour per layer count, for the colour-aware brush blends. */
function paintContext(stack: StackEntry[], print: PrintParams, model: LayerModel, cell: number): PaintContext {
  const layers = layerFilaments(normalizeStack(stack), model.totalLayers);
  const thickness = (k: number) => (k === 0 ? print.firstLayerHeightMm : print.layerHeightMm);
  return { model, colors: buildPrintedLut(layers, thickness), cell };
}

/** Side in pixels of the line-width blocks the preview averages (1 = off). */
function lineCell(simulate: boolean, print: PrintParams, pitchMm: number): number {
  if (!simulate || print.lineWidthMm <= pitchMm) return 1;
  return Math.max(1, Math.round(print.lineWidthMm / pitchMm));
}

/** Pure preview: no caching across calls. */
export function runPreview(image: SourceImage, params: PreviewParams): PreviewResult {
  const core = new EngineCore();
  core.setImage(image);
  return core.preview(params);
}

/** Pure export: no caching across calls. */
export function runExport(image: SourceImage, params: ExportRequestParams): ExportResult {
  const core = new EngineCore();
  core.setImage(image);
  return core.export(params);
}
