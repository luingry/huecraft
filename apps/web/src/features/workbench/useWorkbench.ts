import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { autoDistributeStack, resolvePaintLayers, type PreviewParams, type PreviewResult, type SwapInfo } from '@huecraft/engine';
import { listFilaments, upsertFilament, type FilamentRecord } from '@huecraft/filament-db';
import {
  createEmptyProject,
  totalLayerCount,
  type HueCraftProject,
  type PaintBlend,
  type PaintStroke,
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
export interface BrushSettings {
  /** Diameter in mm on the model. */
  sizeMm: number;
  /** 0..1, 0 = hard edge. */
  softness: number;
  /** 0..1 */
  opacity: number;
  erase: boolean;
  blend: PaintBlend;
  /** Tolerance per colour blend, 0..1 (see PaintStroke.tolerance). */
  tolerances: Record<ColorBlend, number>;
  /** Filament painted; null = the top filament. */
  slotId: string | null;
}

/** Blends that compare colours and take a tolerance. */
export type ColorBlend = 'sampled' | 'onLight' | 'onDark';

export function isColorBlend(b: PaintBlend): b is ColorBlend {
  return b === 'sampled' || b === 'onLight' || b === 'onDark';
}

const DEFAULT_BRUSH: BrushSettings = {
  sizeMm: 6,
  softness: 0.5,
  opacity: 1,
  erase: false,
  blend: 'normal',
  tolerances: { sampled: 0.15, onLight: 0, onDark: 0 },
  slotId: null,
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
  for (const s of result.swaps) {
    lines.push(
      `Camada ${s.slicerLayer} (Z ${s.topZMm.toFixed(2)} mm): pause ao terminar Z ${s.pauseAtZMm.toFixed(2)} mm e carregue ${s.filamentName} ${s.colorHex}`,
    );
  }
  return lines.join('\r\n') + '\r\n';
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
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [toast, setToast] = useState<Toast | null>(null);
  const [exporting, setExporting] = useState(false);
  const [slicerTemplate, setSlicerTemplateState] = useState<SlicerTemplate | null>(null);
  // Preview-only: slots hidden here are skipped by the preview, never by exports.
  const [hiddenSlots, setHiddenSlots] = useState<string[]>([]);
  const [brushActive, setBrushActive] = useState(false);
  const [brush, setBrushState] = useState<BrushSettings>(readBrush);
  // Stroke being drawn: previewed live, committed to the project (one undo step) on release.
  const [liveStroke, setLiveStroke] = useState<PaintStroke | null>(null);
  const autoDistributePending = useRef(false);
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

  // A different project has different slots.
  useEffect(() => setHiddenSlots([]), [project.id]);

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

  // After a new image, spread the swaps over the image's tones once.
  useEffect(() => {
    if (!result || !autoDistributePending.current) return;
    autoDistributePending.current = false;
    setProject(
      (p) => ({
        ...p,
        stack: autoDistributeStack(p.stack, result.layerHistogram, result.baseLayers, result.totalLayers),
      }),
      'auto-distribute',
    );
  }, [result, setProject]);

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

  const autoDistribute = useCallback(() => {
    if (!result) return;
    updateStack(
      (s) => autoDistributeStack(s, result.layerHistogram, result.baseLayers, result.totalLayers),
      'auto-distribute',
    );
  }, [result, updateStack]);

  const openImageFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        showToast(t.toast.imageFailed, 'error');
        return;
      }
      try {
        const loaded = await decodeImage(file);
        // A new image becomes a new project that inherits the current settings.
        const now = new Date().toISOString();
        resetHistory({
          ...project,
          id: crypto.randomUUID(),
          name: stripExtension(file.name),
          createdAt: now,
          updatedAt: now,
          imageWidth: loaded.source.width,
          imageHeight: loaded.source.height,
          stack: project.stack.length > 0 ? project.stack : defaultStack(library),
          // Paint belongs to the old image.
          paint: [],
        });
        setImage((prev) => {
          prev?.bitmap.close();
          return loaded;
        });
        setImageBlob(file);
        autoDistributePending.current = true;
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

  const savePrinterDefaults = useCallback(() => {
    writePrinterDefaults({ print: project.print, swapCommand: project.export.swapCommand });
    showToast(t.size.defaultsSaved);
  }, [project.print, project.export.swapCommand, showToast]);

  const exportFile = useCallback(
    async (kind: ExportKind) => {
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
          slicerTemplate: kind === '3mf' ? slicerTemplate?.bytes : undefined,
        });
        const fileName = `${base}.${kind}`;
        const saved = await saveFile(res.bytes, fileName, res.mimeType);
        if (!saved) setToast(null);
        else if (kind === '3mf' && result.swaps.length > 0 && !res.slicerProject)
          showToast(t.toast.exportedNoTemplate(fileName), 'info', true);
        else showToast(t.toast.exported(fileName));
      } catch (e) {
        showToast(`${t.toast.exportFailed}: ${e instanceof Error ? e.message : String(e)}`, 'error');
      } finally {
        setExporting(false);
      }
    },
    [image, result, project, engine.client, slicerTemplate, showToast, resolvedPaint],
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
    brushActive,
    setBrushActive,
    brush,
    setBrush,
    brushSlot,
    paintStroke,
    clearPaint,
    openImageFile,
    newBlankProject,
    openProject,
    saveFilamentToLibrary,
    setProfile,
    setSimulateLineWidth,
    savePrinterDefaults,
    exportFile,
    slicerTemplate,
    chooseSlicerTemplate,
    dismissToast: () => setToast(null),
  };
}

export type Workbench = ReturnType<typeof useWorkbench>;
