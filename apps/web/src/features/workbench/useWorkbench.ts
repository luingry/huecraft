import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { autoDistributeStack, resolvePaintLayers, type AutoTuneOptions, type PreviewParams, type PreviewResult, type SwapInfo } from '@huecraft/engine';
import { listFilaments, upsertFilament, type FilamentRecord } from '@huecraft/filament-db';
import {
  createEmptyProject,
  totalLayerCount,
  type HueCraftProject,
  type PaintBlend,
  type PaintStroke,
  type PrintOrientation,
  type PrintParams,
  type ReliefParams,
  type StackEntry,
} from '@huecraft/project-schema';
import { t } from '../../i18n';
import { decodeImage, type LoadedImage } from '../project/image';
import {
  listProjects,
  loadLastProject,
  loadProject,
  readPref,
  loadSlicerTemplate,
  readPrinterDefaults,
  saveFile,
  saveProject,
  saveSlicerTemplate,
  writePref,
  writePrinterDefaults,
  type SlicerTemplate,
  type StoredProject,
} from '../project/storage';
import { readSlicerProjectTemplate } from '@huecraft/exporters';
import { useHistory } from '../project/useHistory';
import { createSlot, normalizeStack, sortStack } from './stack';
import {
  DEFAULT_COLOR_PRESET,
  readColorPresets,
  type ColorPresetId,
  type ColorPresetResult,
} from './autoColors';
import { useEngine } from './useEngine';

export type ProfileMode = 'basic' | 'advanced';
export type ExportKind = '3mf' | 'stl' | 'txt';
export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
  sticky?: boolean;
}

const PREVIEW_MAX_EDGE = 640;

/** Slots for a colour reading; the starts are placeholders until auto-distribute runs. */
function presetStack(r: ColorPresetResult): StackEntry[] {
  return r.picks.map((p, i) => createSlot(p.filament, i * 8));
}

/**
 * What the left button does on the 3D view: drag to paint a filament or to
 * lighten / darken the colours under the brush; click to fill a colour area
 * with a filament (paint bucket) or to select a colour area / a colour.
 */
export type BrushTool = 'paint' | 'brighten' | 'darken' | 'fill' | 'selectArea' | 'selectColor';

/** Tools that act on a click instead of a drag. */
export type ClickTool = 'fill' | 'selectArea' | 'selectColor';

export function isClickTool(tool: BrushTool): tool is ClickTool {
  return tool === 'fill' || tool === 'selectArea' || tool === 'selectColor';
}

/** How a selection click combines with the current selection (Shift adds, Ctrl subtracts). */
export type SelectMode = 'replace' | 'add' | 'subtract';

export interface BrushSettings {
  tool: BrushTool;
  /** Diameter in mm on the model. */
  sizeMm: number;
  /** 0..1, 0 = hard edge. */
  softness: number;
  /** 0..1 */
  opacity: number;
  /** Brighten / darken amount, 0..1 of the printable luminance range. */
  toneStrength: number;
  erase: boolean;
  blend: PaintBlend;
  /** Tolerance per colour blend, 0..1 (see PaintStroke.tolerance). */
  tolerances: Record<ColorBlend, number>;
  /** Filament painted; null = the top filament. */
  slotId: string | null;
  /** Paint bucket: colour distance from the clicked colour still filled, 0..1. */
  fillTolerance: number;
  /** Paint bucket: only the area connected to the click. */
  fillContiguous: boolean;
  /** Selection tools: colour distance from the clicked colour still selected, 0..1. */
  selectTolerance: number;
  /** Default combine mode of a selection click (modifier keys override it). */
  selectMode: SelectMode;
}

/** Blends that compare colours and take a tolerance. */
export type ColorBlend = 'sampled' | 'onLight' | 'onDark';

export function isColorBlend(b: PaintBlend): b is ColorBlend {
  return b === 'sampled' || b === 'onLight' || b === 'onDark';
}

const DEFAULT_BRUSH: BrushSettings = {
  tool: 'paint',
  sizeMm: 6,
  softness: 0.5,
  opacity: 1,
  toneStrength: 0.3,
  erase: false,
  blend: 'normal',
  tolerances: { sampled: 0.15, onLight: 0, onDark: 0 },
  slotId: null,
  fillTolerance: 0.1,
  fillContiguous: true,
  selectTolerance: 0.1,
  selectMode: 'replace',
};

function readBrush(): BrushSettings {
  try {
    const { tolerance, ...saved } = JSON.parse(readPref('huecraft:brush') ?? '{}') as Partial<BrushSettings> & {
      tolerance?: number;
    };
    const tolerances = { ...DEFAULT_BRUSH.tolerances, ...saved.tolerances };
    // Earlier builds kept a single tolerance for the sampled blend.
    if (typeof tolerance === 'number' && !saved.tolerances) tolerances.sampled = tolerance;
    return { ...DEFAULT_BRUSH, ...saved, tolerances, erase: false };
  } catch {
    return DEFAULT_BRUSH;
  }
}

function newProject(name?: string): HueCraftProject {
  const p = createEmptyProject(name ?? t.untitled);
  const defaults = readPrinterDefaults();
  if (defaults) {
    p.print = { ...defaults.print };
    p.export = { swapCommand: defaults.swapCommand };
  }
  return p;
}

function luminanceOf(hex: string): number {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

/** Classic three-step stack: darkest base, a mid tone, lightest on top. */
function defaultStack(library: FilamentRecord[]): StackEntry[] {
  if (library.length < 2) return library.map((f, i) => createSlot(f, i));
  const byLum = [...library].sort((a, b) => luminanceOf(a.colorHex) - luminanceOf(b.colorHex));
  const dark = byLum[0];
  const light = byLum[byLum.length - 1];
  const mid = byLum.reduce((best, f) =>
    Math.abs(luminanceOf(f.colorHex) - 128) < Math.abs(luminanceOf(best.colorHex) - 128) ? f : best,
  );
  const picks = mid === dark || mid === light ? [dark, light] : [dark, mid, light];
  return picks.map((f, i) => createSlot(f, i * 8));
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'huecraft';
}

export function formatSwapPlanText(project: HueCraftProject, result: PreviewResult): string {
  const p = project.print;
  const lines = [
    `hueCraft — plano de trocas: ${project.name}`,
    `Tamanho: ${result.sizeMm.width.toFixed(1)} × ${result.sizeMm.height.toFixed(1)} × ${result.sizeMm.z.toFixed(2)} mm`,
    `Camadas: ${result.totalLayers} (primeira ${p.firstLayerHeightMm} mm, demais ${p.layerHeightMm} mm)`,
    '',
    `Camada 1 (Z ${p.firstLayerHeightMm.toFixed(2)} mm): comece com ${project.stack[0]?.filament.name ?? '?'} ${project.stack[0]?.filament.colorHex ?? ''}`,
  ];
  if (project.export.swapCommand === 'ams') {
    const slots = new Map<string, number>();
    for (const e of project.stack) if (!slots.has(e.slotId)) slots.set(e.slotId, slots.size + 1);
    lines[lines.length - 1] += ` (AMS slot 1)`;
    for (const s of result.swaps) {
      lines.push(`Camada ${s.slicerLayer} (Z ${s.topZMm.toFixed(2)} mm): troca automática para ${s.filamentName} ${s.colorHex} (AMS slot ${slots.get(s.slotId) ?? 1})`);
    }
    return lines.join('\r\n') + '\r\n';
  }
  for (const s of result.swaps) {
    lines.push(
      `Camada ${s.slicerLayer} (Z ${s.topZMm.toFixed(2)} mm): pause ao terminar Z ${s.pauseAtZMm.toFixed(2)} mm e carregue ${s.filamentName} ${s.colorHex}`,
    );
  }
  return lines.join('\r\n') + '\r\n';
}

/** Filament of each part of a face-down export, in part order (clear first, then front to back, as the engine builds them). */
function faceDownPartOrder(stack: StackEntry[]): string[] {
  const names: string[] = [t.toast.clearFilament];
  const seen = new Set<string>();
  for (const e of [...sortStack(stack)].reverse()) {
    const key = `${e.filament.colorHex.toLowerCase()}|${e.filament.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(e.filament.name);
  }
  return names;
}

export function useWorkbench() {
  const history = useHistory<HueCraftProject>(() => newProject());
  const project = history.state;
  const setProject = history.set;
  const resetHistory = history.reset;

  const [image, setImage] = useState<LoadedImage | null>(null);
  const [imageBlob, setImageBlob] = useState<Blob | undefined>();
  const [library, setLibrary] = useState<FilamentRecord[]>([]);
  const [recent, setRecent] = useState<StoredProject[]>([]);
  const [profile, setProfileState] = useState<ProfileMode>(() =>
    readPref('huecraft:profile') === 'advanced' ? 'advanced' : 'basic',
  );
  const [simulateLineWidth, setSimulateLineWidthState] = useState(() => readPref('huecraft:line-sim') !== '0');
  // How the 3D view shows the print; also the choice pre-selected when exporting.
  const [orientation, setOrientationState] = useState<PrintOrientation>(() =>
    readPref('huecraft:orientation') === 'faceDown' ? 'faceDown' : 'faceUp',
  );
  // 3MF / STL export waiting for the orientation question.
  const [exportRequest, setExportRequest] = useState<'3mf' | 'stl' | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [toast, setToast] = useState<Toast | null>(null);
  const [exporting, setExporting] = useState(false);
  const [tuning, setTuning] = useState(false);
  const [slicerTemplate, setSlicerTemplateState] = useState<SlicerTemplate | null>(null);
  // Preview-only: slots hidden here are skipped by the preview, never by exports.
  const [hiddenSlots, setHiddenSlots] = useState<string[]>([]);
  const [brushActive, setBrushActive] = useState(false);
  const [brush, setBrushState] = useState<BrushSettings>(readBrush);
  // Stroke being drawn: previewed live, committed to the project (one undo step) on release.
  const [liveStroke, setLiveStroke] = useState<PaintStroke | null>(null);
  // Colour-reading picker: shown after an image is opened, reopenable from the image section.
  const [colorPresetsOpen, setColorPresetsOpen] = useState(false);
  const autoDistributePending = useRef(false);
  const readFromImageId = useRef<string | null>(null);
  const booted = useRef(false);

  const totalLayers = totalLayerCount(project.print);

  const showToast = useCallback((text: string, kind: Toast['kind'] = 'info', sticky = false) => {
    setToast({ id: Date.now(), text, kind, sticky });
  }, []);

  useEffect(() => {
    if (!toast || toast.sticky) return;
    const h = setTimeout(() => setToast((cur) => (cur?.id === toast.id ? null : cur)), 2600);
    return () => clearTimeout(h);
  }, [toast]);

  /* ---------- boot: library + last project ---------- */

  const applyStored = useCallback(
    async (row: StoredProject) => {
      resetHistory(row.project);
      if (row.imageBlob) {
        try {
          const loaded = await decodeImage(row.imageBlob);
          setImage((prev) => {
            prev?.bitmap.close();
            return loaded;
          });
          setImageBlob(row.imageBlob);
        } catch {
          setImage(null);
          setImageBlob(undefined);
        }
      } else {
        setImage(null);
        setImageBlob(undefined);
      }
      writePref('huecraft:last-project', row.id);
    },
    [resetHistory],
  );

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      const lib = await listFilaments();
      setLibrary(lib);
      setSlicerTemplateState(await loadSlicerTemplate().catch(() => null));
      const last = await loadLastProject().catch(() => undefined);
      if (last && last.project.stack.length > 0) {
        await applyStored(last);
      } else {
        resetHistory({ ...newProject(), stack: defaultStack(lib) });
      }
      setRecent(await listProjects());
    })();
  }, [applyStored, resetHistory]);

  /* ---------- engine ---------- */

  const visibleStack = useMemo(() => {
    const visible = project.stack.filter((e) => !hiddenSlots.includes(e.slotId));
    return visible.length > 0 ? visible : project.stack;
  }, [project.stack, hiddenSlots]);
  const hiddenCount = project.stack.length - visibleStack.length;

  const toggleHidden = useCallback((slotId: string) => {
    setHiddenSlots((h) => (h.includes(slotId) ? h.filter((s) => s !== slotId) : [...h, slotId]));
  }, []);

  // A different project has different slots; the colour picker stays open only
  // for a project just created from an image (openImageFile opens it).
  useEffect(() => {
    setHiddenSlots([]);
    if (project.id !== readFromImageId.current) setColorPresetsOpen(false);
  }, [project.id]);

  // Strokes follow their filament's band; resolved against the full stack so
  // hiding a colour in the preview does not move the paint.
  const resolvedPaint = useMemo(
    () => resolvePaintLayers(project.paint, project.stack, totalLayers),
    [project.paint, project.stack, totalLayers],
  );

  const previewParams = useMemo<PreviewParams | null>(
    () =>
      visibleStack.length > 0
        ? {
            relief: project.relief,
            print: project.print,
            stack: visibleStack,
            maxEdge: PREVIEW_MAX_EDGE,
            simulateLineWidth,
            paint: liveStroke ? [...resolvedPaint, ...resolvePaintLayers([liveStroke], project.stack, totalLayers)] : resolvedPaint,
            paintStack: project.stack,
          }
        : null,
    [project.relief, project.print, visibleStack, simulateLineWidth, resolvedPaint, liveStroke, project.stack, totalLayers],
  );

  const engine = useEngine(image?.source ?? null, previewParams);
  const result = engine.result;

  /**
   * Places the swaps with a swaps-only auto-tune, which judges the predicted
   * print colours, so a large flat area (a white background at full height)
   * gets a filament band thick enough to show its colour. Pixel quantiles alone
   * squeeze every swap under such an area: one white layer over orange and
   * black prints beige. Quantiles stay the fallback. Skipped when the project
   * changed meanwhile. `merge` folds it into the previous undo step.
   * `reorder` (import / preset step, colour-driven heights only) also lets it
   * pick the filament order: with borders between black, grey and white scored,
   * it keeps those filaments next to each other in the stack, so a black figure
   * on a white page does not print the other colours along its edges. In luma
   * mode the order search has no such term, so the reading's order is kept.
   */
  const distributeSwaps = (merge: boolean, reorder = false) => {
    if (!result) return;
    const quantiles = (s: StackEntry[]) => autoDistributeStack(s, result.layerHistogram, result.baseLayers, result.totalLayers);
    const { id, stack, relief, print } = project;
    const client = engine.client;
    const apply = (next: (s: StackEntry[]) => StackEntry[]) =>
      setProject((p) => (p.id === id && p.stack === stack ? { ...p, stack: normalizeStack(next(p.stack)) } : p), 'auto-distribute', merge);
    if (!client || stack.length < 2) {
      apply(quantiles);
      return;
    }
    const order = reorder && (relief.colorMatch ?? 0) > 0;
    client
      .autoTune({ relief, print, stack, simulateLineWidth, options: { reorder: order, tone: false, timeBudgetMs: 1500 } })
      // Same filaments (in the same order unless `order`); the result's slots keep their ids.
      .then((res) => apply(() => res.stack))
      .catch(() => apply(quantiles));
  };
  const distributeSwapsRef = useRef(distributeSwaps);
  distributeSwapsRef.current = distributeSwaps;

  // After a new image (or colour preset), place the swaps once. Part of the
  // import / preset step: undo goes straight back to before it.
  useEffect(() => {
    if (!result || !autoDistributePending.current) return;
    autoDistributePending.current = false;
    distributeSwapsRef.current(true, true);
  }, [result]);

  /* ---------- autosave ---------- */

  useEffect(() => {
    if (!image) return;
    setSaveState('saving');
    const h = setTimeout(async () => {
      try {
        await saveProject(project, imageBlob, image.thumbnail);
        setSaveState('saved');
        setRecent(await listProjects());
      } catch {
        setSaveState('idle');
      }
    }, 800);
    return () => clearTimeout(h);
  }, [project, imageBlob, image]);

  /* ---------- actions ---------- */

  const updateRelief = useCallback(
    (patch: Partial<ReliefParams>, key?: string) =>
      setProject((p) => ({ ...p, relief: { ...p.relief, ...patch } }), key ?? `relief:${Object.keys(patch).join()}`),
    [setProject],
  );

  const updatePrint = useCallback(
    (patch: Partial<PrintParams>, key?: string) =>
      setProject((p) => ({ ...p, print: { ...p.print, ...patch } }), key ?? `print:${Object.keys(patch).join()}`),
    [setProject],
  );

  const updateStack = useCallback(
    (fn: (stack: StackEntry[]) => StackEntry[], key?: string) =>
      setProject((p) => {
        const next = normalizeStack(fn(p.stack));
        return next === p.stack ? p : { ...p, stack: next };
      }, key),
    [setProject],
  );

  const rename = useCallback(
    (name: string) => setProject((p) => ({ ...p, name: name || t.untitled }), 'rename'),
    [setProject],
  );

  const setSwapCommand = useCallback(
    (swapCommand: HueCraftProject['export']['swapCommand']) =>
      setProject((p) => ({ ...p, export: { ...p.export, swapCommand } })),
    [setProject],
  );

  /* ---------- brush ---------- */

  const setBrush = useCallback((patch: Partial<BrushSettings>) => {
    setBrushState((b) => {
      const next = { ...b, ...patch };
      writePref('huecraft:brush', JSON.stringify({ ...next, erase: false }));
      return next;
    });
  }, []);

  /** Filament the brush paints: the chosen one, or the top filament. */
  const brushSlot = useMemo(() => {
    const sorted = sortStack(project.stack);
    return sorted.find((e) => e.slotId === brush.slotId) ?? sorted[sorted.length - 1] ?? null;
  }, [project.stack, brush.slotId]);

  /** Builds a stroke from the current brush settings for the given points. */
  const makeStroke = useCallback(
    (id: string, points: number[], sampleLayer: number): PaintStroke | null => {
      const tool = brush.tool;
      if (isClickTool(tool)) return null;
      if (!brush.erase && tool !== 'paint') {
        return {
          id,
          mode: tool,
          slotId: '',
          layer: totalLayers,
          radius: brush.sizeMm / 2 / project.print.widthMm,
          softness: brush.softness,
          opacity: brush.toneStrength,
          points,
        };
      }
      if (!brushSlot && !brush.erase) return null;
      return {
        id,
        mode: brush.erase ? 'erase' : 'paint',
        blend: brush.blend,
        slotId: brushSlot?.slotId ?? '',
        layer: totalLayers,
        radius: brush.sizeMm / 2 / project.print.widthMm,
        softness: brush.softness,
        opacity: brush.opacity,
        ...(brush.blend === 'sampled' ? { sampleLayer } : {}),
        ...(isColorBlend(brush.blend) ? { tolerance: brush.tolerances[brush.blend] } : {}),
        points,
      };
    },
    [brushSlot, brush, totalLayers, project.print.widthMm],
  );

  const paintStroke = useCallback(
    (id: string, points: number[], done: boolean, sampleLayer: number) => {
      const stroke = makeStroke(id, points, sampleLayer);
      if (!done) {
        setLiveStroke(stroke);
        return;
      }
      setLiveStroke(null);
      if (stroke) setProject((p) => ({ ...p, paint: [...(p.paint ?? []), stroke] }));
    },
    [makeStroke, setProject],
  );

  const clearPaint = useCallback(
    () => setProject((p) => ((p.paint?.length ?? 0) === 0 ? p : { ...p, paint: [] })),
    [setProject],
  );

  /**
   * Click with the paint bucket or a selection tool at an image-space point
   * (one undo step). `add` / `subtract` (Shift / Ctrl) override the selection mode.
   */
  const clickTool = useCallback(
    (u: number, v: number, mods: { add: boolean; subtract: boolean }) => {
      const tool = brush.tool;
      if (!isClickTool(tool)) return;
      const base = { id: crypto.randomUUID(), layer: totalLayers, radius: 0, softness: 0, points: [u, v] };
      let stroke: PaintStroke;
      if (tool === 'fill') {
        if (!brushSlot && !brush.erase) return;
        stroke = {
          ...base,
          kind: 'fill',
          mode: brush.erase ? 'erase' : 'paint',
          slotId: brushSlot?.slotId ?? '',
          opacity: brush.opacity,
          tolerance: brush.fillTolerance,
          contiguous: brush.fillContiguous,
        };
      } else {
        stroke = {
          ...base,
          kind: 'select',
          mode: 'paint',
          slotId: '',
          opacity: 1,
          selectOp: mods.add ? 'add' : mods.subtract ? 'subtract' : brush.selectMode,
          tolerance: brush.selectTolerance,
          contiguous: tool === 'selectArea',
        };
      }
      setProject((p) => ({ ...p, paint: [...(p.paint ?? []), stroke] }));
    },
    [brush, brushSlot, totalLayers, setProject],
  );

  /** A selection is active: strokes only touch the selected area. */
  const hasSelection = !!result?.selection;

  /** Inverts or drops the selection (one undo step). */
  const changeSelection = useCallback(
    (op: 'invert' | 'clear') => {
      if (!hasSelection) return;
      const stroke: PaintStroke = {
        id: crypto.randomUUID(),
        kind: 'select',
        selectOp: op,
        mode: 'paint',
        slotId: '',
        layer: 0,
        radius: 0,
        softness: 0,
        opacity: 1,
        points: [],
      };
      setProject((p) => ({ ...p, paint: [...(p.paint ?? []), stroke] }));
    },
    [hasSelection, setProject],
  );

  const autoDistribute = useCallback(() => distributeSwapsRef.current(false), []);

  /** Experimental: search the settings whose predicted print is closest to the image (one undo step). */
  const autoTune = useCallback(
    async (options: AutoTuneOptions) => {
      if (!image || !engine.client || tuning) {
        if (!image) showToast(t.toast.needImage, 'error');
        return;
      }
      setTuning(true);
      showToast(t.autoTune.running, 'info', true);
      try {
        const res = await engine.client.autoTune({
          relief: project.relief,
          print: project.print,
          stack: project.stack,
          simulateLineWidth,
          options: { ...options, timeBudgetMs: 6000 },
        });
        setProject((p) => ({ ...p, relief: res.relief, stack: normalizeStack(res.stack) }), 'auto-tune');
        showToast(t.autoTune.done(res.errorBefore, res.errorAfter, res.ms), 'info', true);
      } catch (e) {
        showToast(`${t.autoTune.failed}: ${e instanceof Error ? e.message : String(e)}`, 'error');
      } finally {
        setTuning(false);
      }
    },
    [image, engine.client, tuning, project.relief, project.print, project.stack, simulateLineWidth, setProject, showToast],
  );

  const colorPresets = useMemo(
    () => (colorPresetsOpen && image ? readColorPresets(image.source, library, project.relief.invert) : null),
    [colorPresetsOpen, image, library, project.relief.invert],
  );

  // The current reading is whichever preset the project still matches, so undo
  // and manual edits keep the picker honest.
  const colorPresetId = useMemo<ColorPresetId | null>(() => {
    // Order-insensitive: the import step may reorder the reading's filaments.
    const key = (hexes: string[]) => hexes.map((h) => h.toLowerCase()).sort().join();
    const colors = key(project.stack.map((e) => e.filament.colorHex));
    const r = colorPresets?.find(
      ({ preset, picks }) =>
        key(picks.map((p) => p.filament.colorHex)) === colors &&
        preset.relief.smoothing === project.relief.smoothing &&
        preset.relief.posterize === project.relief.posterize,
    );
    return r?.preset.id ?? null;
  }, [colorPresets, project.stack, project.relief.smoothing, project.relief.posterize]);

  const applyColorPreset = useCallback(
    (id: ColorPresetId) => {
      const r = colorPresets?.find((c) => c.preset.id === id);
      if (!r || r.picks.length === 0) return;
      autoDistributePending.current = true;
      setProject(
        (p) => ({ ...p, relief: { ...p.relief, ...r.preset.relief }, stack: normalizeStack(presetStack(r)) }),
        'color-preset',
      );
    },
    [colorPresets, setProject],
  );

  const openColorPresets = useCallback(() => {
    if (image) setColorPresetsOpen(true);
  }, [image]);

  const openImageFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        showToast(t.toast.imageFailed, 'error');
        return;
      }
      try {
        const loaded = await decodeImage(file);
        // The image's predominant colours become the stack (default preset); the
        // picker opens so another reading can be chosen.
        const presets = readColorPresets(loaded.source, library, project.relief.invert);
        const chosen = presets.find((r) => r.preset.id === DEFAULT_COLOR_PRESET)!;
        const autoStack = presetStack(chosen);
        // A new image becomes a new project that inherits the current settings.
        const now = new Date().toISOString();
        const id = crypto.randomUUID();
        if (autoStack.length > 0) readFromImageId.current = id;
        resetHistory({
          ...project,
          id,
          name: stripExtension(file.name),
          createdAt: now,
          updatedAt: now,
          imageWidth: loaded.source.width,
          imageHeight: loaded.source.height,
          relief: autoStack.length > 0 ? { ...project.relief, ...chosen.preset.relief } : project.relief,
          stack: autoStack.length > 0 ? autoStack : project.stack.length > 0 ? project.stack : defaultStack(library),
          // Paint belongs to the old image.
          paint: [],
        });
        setImage((prev) => {
          prev?.bitmap.close();
          return loaded;
        });
        setImageBlob(file);
        autoDistributePending.current = true;
        if (autoStack.length > 0) setColorPresetsOpen(true);
      } catch {
        showToast(t.toast.imageFailed, 'error');
      }
    },
    [resetHistory, project, library, showToast],
  );

  const newBlankProject = useCallback(() => {
    resetHistory({ ...newProject(), stack: defaultStack(library) });
    setImage((prev) => {
      prev?.bitmap.close();
      return null;
    });
    setImageBlob(undefined);
    setSaveState('idle');
  }, [resetHistory, library]);

  const openProject = useCallback(
    async (id: string) => {
      const row = await loadProject(id);
      if (row) await applyStored(row);
    },
    [applyStored],
  );

  const saveFilamentToLibrary = useCallback(async (f: FilamentRecord) => {
    await upsertFilament(f);
    setLibrary(await listFilaments());
  }, []);

  const setProfile = useCallback((m: ProfileMode) => {
    setProfileState(m);
    writePref('huecraft:profile', m);
  }, []);

  const setSimulateLineWidth = useCallback((v: boolean) => {
    setSimulateLineWidthState(v);
    writePref('huecraft:line-sim', v ? '1' : '0');
  }, []);

  const setOrientation = useCallback((o: PrintOrientation) => {
    setOrientationState(o);
    writePref('huecraft:orientation', o);
  }, []);

  const savePrinterDefaults = useCallback(() => {
    writePrinterDefaults({ print: project.print, swapCommand: project.export.swapCommand });
    showToast(t.size.defaultsSaved);
  }, [project.print, project.export.swapCommand, showToast]);

  const exportFile = useCallback(
    async (kind: ExportKind, orient: PrintOrientation = 'faceUp') => {
      if (!image || !result || !engine.client) {
        showToast(t.toast.needImage, 'error');
        return;
      }
      const base = safeFileName(project.name);
      if (kind === 'txt') {
        await saveFile(formatSwapPlanText(project, result), `${base} - trocas.txt`, 'text/plain');
        return;
      }
      setExporting(true);
      showToast(t.toast.exporting, 'info', true);
      try {
        const res = await engine.client!.export({
          name: project.name,
          relief: project.relief,
          print: project.print,
          stack: project.stack,
          swapCommand: project.export.swapCommand,
          format: kind,
          paint: resolvedPaint,
          simulateLineWidth,
          slicerTemplate: kind === '3mf' ? slicerTemplate?.bytes : undefined,
          orientation: orient,
        });
        const fileName = orient === 'faceDown' ? `${base} (face down).${kind === 'stl' ? 'zip' : kind}` : `${base}.${kind}`;
        const saved = await saveFile(res.bytes, fileName, res.mimeType);
        if (!saved) setToast(null);
        else if (orient === 'faceDown' && kind === '3mf' && res.slicerProject) showToast(t.toast.exportedFaceDownProject(fileName));
        else if (orient === 'faceDown') showToast(t.toast.exportedFaceDown(fileName, faceDownPartOrder(project.stack)), 'info', true);
        else if (kind === '3mf' && result.swaps.length > 0 && !res.slicerProject)
          showToast(t.toast.exportedNoTemplate(fileName), 'info', true);
        else showToast(t.toast.exported(fileName));
      } catch (e) {
        showToast(`${t.toast.exportFailed}: ${e instanceof Error ? e.message : String(e)}`, 'error');
      } finally {
        setExporting(false);
      }
    },
    [image, result, project, engine.client, slicerTemplate, showToast, resolvedPaint, simulateLineWidth],
  );

  /** 3MF / STL first ask for the orientation (ExportDialog); the swap plan saves right away. */
  const requestExport = useCallback(
    (kind: ExportKind) => {
      if (kind === 'txt') void exportFile('txt');
      else if (!image || !result) showToast(t.toast.needImage, 'error');
      else setExportRequest(kind);
    },
    [exportFile, image, result, showToast],
  );

  const confirmExport = useCallback(
    (orient: PrintOrientation) => {
      const kind = exportRequest;
      setExportRequest(null);
      setOrientation(orient);
      if (kind) void exportFile(kind, orient);
    },
    [exportRequest, exportFile, setOrientation],
  );

  const chooseSlicerTemplate = useCallback(
    async (file: File | null) => {
      if (!file) {
        await saveSlicerTemplate(null);
        setSlicerTemplateState(null);
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = readSlicerProjectTemplate(bytes);
      if (!parsed) {
        showToast(t.template.invalid, 'error');
        return;
      }
      const tpl: SlicerTemplate = { fileName: file.name, application: parsed.application, bytes };
      await saveSlicerTemplate(tpl);
      setSlicerTemplateState(tpl);
      showToast(t.template.saved(parsed.application.replace('-', ' ')));
    },
    [showToast],
  );

  const swaps: SwapInfo[] = result?.swaps ?? [];

  return {
    project,
    totalLayers,
    image,
    library,
    recent,
    profile,
    simulateLineWidth,
    hiddenSlots,
    hiddenCount,
    toggleHidden,
    saveState,
    toast,
    exporting,
    result,
    swaps,
    busy: engine.busy,
    engineError: engine.error,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undo: history.undo,
    redo: history.redo,
    updateRelief,
    updatePrint,
    updateStack,
    rename,
    setSwapCommand,
    autoDistribute,
    autoTune,
    tuning,
    brushActive,
    setBrushActive,
    brush,
    setBrush,
    brushSlot,
    paintStroke,
    clearPaint,
    clickTool,
    hasSelection,
    changeSelection,
    openImageFile,
    colorPresets,
    colorPresetId,
    colorPresetsOpen,
    openColorPresets,
    closeColorPresets: () => setColorPresetsOpen(false),
    applyColorPreset,
    newBlankProject,
    openProject,
    saveFilamentToLibrary,
    setProfile,
    setSimulateLineWidth,
    savePrinterDefaults,
    exportFile,
    exportRequest,
    requestExport,
    confirmExport,
    cancelExport: () => setExportRequest(null),
    orientation,
    setOrientation,
    slicerTemplate,
    chooseSlicerTemplate,
    dismissToast: () => setToast(null),
    showToast,
  };
}

export type Workbench = ReturnType<typeof useWorkbench>;
