import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { faceDownPreview } from '@huecraft/engine';
import { filamentIndexAtLayer, layerTopZ } from '@huecraft/project-schema';
import {
  Button,
  IconBrush,
  IconCompare,
  IconCube,
  IconImage,
  IconLayers,
  IconMoon,
  IconPalette,
  IconSun,
  Segmented,
  Switch,
} from '@huecraft/design-system';
import { formatMm, t } from '../../../i18n';
import { readPref, writePref } from '../../project/storage';
import { sortStack } from '../stack';
import type { BrushTool, Workbench } from '../useWorkbench';
import { BrushMenu } from './BrushMenu';
import { BitmapCanvas, IDENTITY, ImageViewport, RgbaCanvas, type ViewTransform } from './ImageViewport';
import type { MeshColorMode } from './MeshView';

// three.js is only needed on the 3D tab; keep it out of the initial bundle.
const MeshView = lazy(() => import('./MeshView').then((m) => ({ default: m.MeshView })));

export type StageTab = 'printed' | 'slicer' | '3d' | 'original' | 'compare';
type Backdrop = 'dark' | 'mid' | 'light';

const BACKDROPS: Record<Backdrop, string> = { dark: '#1e1e1e', mid: '#767676', light: '#e8e8e8' };

export const STAGE_TABS: StageTab[] = ['printed', 'slicer', '3d', 'original', 'compare'];

export function Stage({
  wb,
  tab,
  onTab,
  onPickImage,
}: {
  wb: Workbench;
  tab: StageTab;
  onTab: (t: StageTab) => void;
  onPickImage: () => void;
}) {
  const [backdrop, setBackdropState] = useState<Backdrop>(() => (readPref('huecraft:backdrop') as Backdrop) || 'dark');
  const [view, setView] = useState<ViewTransform>(IDENTITY);
  const [hover, setHover] = useState<{ u: number; v: number } | null>(null);
  const [meshColors, setMeshColors] = useState<MeshColorMode>('printed');
  const [layerCut, setLayerCut] = useState<number | null>(null);
  const [resetToken, setResetToken] = useState(0);
  const [split, setSplit] = useState(0.5);
  const [brushMenu, setBrushMenu] = useState<{ x: number; y: number } | null>(null);
  const closeBrushMenu = useCallback(() => setBrushMenu(null), []);
  const res = wb.result;
  const faceDown = wb.orientation === 'faceDown';
  const brushOn = wb.brushActive && tab === '3d' && !faceDown;
  // Brighten / darken have no filament: their swatch and cursor show the direction.
  const brushColor = wb.brush.tool === 'brighten' ? '#fff4b8' : wb.brush.tool === 'darken' ? '#5a5f73' : wb.brushSlot?.filament.colorHex;
  const print = wb.project.print;
  // Built on the main thread from the preview; null while the preview lags behind new print params.
  const turned = useMemo(() => {
    if (!faceDown || tab !== '3d' || !res) return null;
    try {
      return faceDownPreview(res, print, sortStack(wb.project.stack));
    } catch {
      return null;
    }
  }, [faceDown, tab, res, print, wb.project.stack]);

  const setBackdrop = (b: Backdrop) => {
    setBackdropState(b);
    writePref('huecraft:backdrop', b);
  };

  // Reset zoom when a different image is loaded.
  const imageRef = wb.image?.bitmap;
  useEffect(() => {
    setView(IDENTITY);
    setLayerCut(null);
  }, [imageRef]);

  if (!wb.image) return <EmptyStage wb={wb} onPickImage={onPickImage} />;

  const aspect = wb.image.source.width / wb.image.source.height;
  const total = res?.totalLayers ?? wb.totalLayers;
  const cut = layerCut === null ? total : Math.min(layerCut, total);
  const stack = sortStack(wb.project.stack);

  let readout: string | null = null;
  if (hover && res && (tab === 'printed' || tab === 'slicer' || tab === 'compare')) {
    const x = Math.min(res.width - 1, Math.floor(hover.u * res.width));
    const y = Math.min(res.height - 1, Math.floor(hover.v * res.height));
    const n = res.layerField[y * res.width + x];
    const f = stack[filamentIndexAtLayer(stack, n - 1)]?.filament;
    readout = `${t.stage.layerOf(n, total)} · Z ${formatMm(layerTopZ(wb.project.print, n - 1), 2)} mm${f ? ` · ${f.name}` : ''}`;
  }

  const background = BACKDROPS[backdrop];

  return (
    <main className="wb-stage">
      <div className="wb-stage__bar">
        <Segmented
          ariaLabel="Visualização"
          value={tab}
          onChange={onTab}
          options={[
            { value: 'printed', label: <><IconPalette size={14} />{t.stage.printed}</>, title: `${t.stage.printedHint} (1)` },
            { value: 'slicer', label: <><IconLayers size={14} />{t.stage.slicer}</>, title: `${t.stage.slicerHint} (2)` },
            { value: '3d', label: <><IconCube size={14} />{t.stage.model3d}</>, title: '3D (3)' },
            { value: 'original', label: <><IconImage size={14} />{t.stage.original}</>, title: `${t.stage.original} (4)` },
            { value: 'compare', label: <><IconCompare size={14} />{t.stage.compare}</>, title: `${t.stage.compare} (5)` },
          ]}
        />
        <div className="wb-stage__bar-spacer" />
        {tab === 'slicer' && (
          <div className="wb-inline-switch" title={t.stage.lineWidthHint}>
            <Switch label={t.stage.lineWidth} checked={wb.simulateLineWidth} onChange={wb.setSimulateLineWidth} />
          </div>
        )}
        {tab === '3d' && (
          <>
            <Segmented
              ariaLabel={t.stage.colorMode}
              value={meshColors}
              onChange={setMeshColors}
              options={[
                { value: 'printed', label: t.stage.printed },
                { value: 'slicer', label: t.stage.slicer },
              ]}
            />
            <Segmented
              ariaLabel={t.stage.orientation}
              value={wb.orientation}
              onChange={wb.setOrientation}
              options={[
                { value: 'faceUp', label: t.stage.faceUp, title: t.stage.faceUpHint },
                { value: 'faceDown', label: t.stage.faceDown, title: t.stage.faceDownHint },
              ]}
            />
            <Button size="sm" variant="ghost" onClick={() => setResetToken((n) => n + 1)}>
              {t.stage.resetView}
            </Button>
          </>
        )}
        <div className="wb-backdrops" role="group" aria-label={t.stage.background}>
          {(Object.keys(BACKDROPS) as Backdrop[]).map((b) => (
            <button
              key={b}
              type="button"
              className="wb-backdrop"
              style={{ background: BACKDROPS[b] }}
              aria-pressed={backdrop === b}
              aria-label={`${t.stage.background}: ${b}`}
              title={t.stage.background}
              onClick={() => setBackdrop(b)}
            />
          ))}
        </div>
      </div>

      <div className="wb-stage__canvas" style={{ background }} data-backdrop={backdrop}>
        <div className="wb-progress" data-active={wb.busy} />
        {tab === '3d' && res ? (
          <>
            <Suspense fallback={null}>
              <MeshView
                result={res}
                faceDown={turned}
                colorMode={meshColors}
                cutLayers={faceDown ? total : cut}
                maxLayerZ={layerTopZ(wb.project.print, (faceDown ? total : cut) - 1)}
                layerZ={(i) => layerTopZ(wb.project.print, i)}
                background={background}
                resetToken={resetToken}
                brush={
                  brushOn
                    ? {
                        sizeMm: wb.brush.sizeMm,
                        softness: wb.brush.softness,
                        colorHex: brushColor ?? '#ffffff',
                        erase: wb.brush.erase,
                      }
                    : null
                }
                onStroke={wb.paintStroke}
                onBrushMenu={(x, y) => setBrushMenu({ x, y })}
                onBrushSize={(sizeMm) => wb.setBrush({ sizeMm })}
              />
            </Suspense>
            <BrushToolbar wb={wb} disabled={faceDown} />
            {brushOn && <div className="wb-brush-hint">{t.brush.hint}</div>}
            {brushOn && brushMenu && <BrushMenu wb={wb} x={brushMenu.x} y={brushMenu.y} onClose={closeBrushMenu} />}
            {faceDown ? (
              <div className="wb-orient-legend">{t.stage.faceDownLegend}</div>
            ) : (
              <LayerScrubber total={total} value={cut} onChange={(v) => setLayerCut(v >= total ? null : v)} />
            )}
          </>
        ) : tab === 'original' ? (
          <ImageViewport aspect={aspect} view={view} onView={setView}>
            <BitmapCanvas bitmap={wb.image.bitmap} />
          </ImageViewport>
        ) : tab === 'compare' && res ? (
          <ImageViewport aspect={aspect} view={view} onView={setView} onHover={setHover}>
            <BitmapCanvas bitmap={wb.image.bitmap} />
            <div className="wb-compare__top" style={{ clipPath: `inset(0 0 0 ${split * 100}%)` }}>
              <RgbaCanvas rgba={res.printedRgba} width={res.width} height={res.height} />
            </div>
            <CompareHandle split={split} onSplit={setSplit} scale={view.scale} />
          </ImageViewport>
        ) : res ? (
          <ImageViewport aspect={aspect} view={view} onView={setView} onHover={setHover}>
            {tab === 'slicer' ? (
              <RgbaCanvas rgba={res.slicerRgba} width={res.width} height={res.height} pixelated />
            ) : (
              <RgbaCanvas rgba={res.printedRgba} width={res.width} height={res.height} />
            )}
          </ImageViewport>
        ) : null}
        {wb.engineError && <div className="wb-stage__error">{wb.engineError}</div>}
      </div>

      <footer className="wb-status">
        {res ? (
          <>
            <span>
              {t.status.size(
                formatMm(res.sizeMm.width),
                formatMm(res.sizeMm.height),
                formatMm(res.sizeMm.z, 2),
              )}
            </span>
            <span className="wb-status__dot" />
            <span>{t.status.layers(res.totalLayers)}</span>
            <span className="wb-status__dot" />
            <span>{t.status.swaps(res.swaps.length)}</span>
            <span className="wb-status__swaps">
              {stack
                .filter((e) => e.startLayer < res.totalLayers)
                .map((e) => (
                  <span key={e.slotId} className="wb-swatch wb-swatch--xs" style={{ background: e.filament.colorHex }} title={e.filament.name} />
                ))}
            </span>
            {wb.hiddenCount > 0 && <span className="wb-status__hidden">{t.status.hidden(wb.hiddenCount)}</span>}
          </>
        ) : (
          <span>{t.stage.computing}</span>
        )}
        <span className="wb-status__spacer" />
        {readout && <span className="wb-status__readout">{readout}</span>}
        {res && <span className="hc-faint">{Math.round(res.timings.totalMs ?? 0)} ms</span>}
      </footer>
    </main>
  );
}

const BRUSH_TOOLS: { tool: BrushTool; Icon: typeof IconBrush }[] = [
  { tool: 'paint', Icon: IconBrush },
  { tool: 'brighten', Icon: IconSun },
  { tool: 'darken', Icon: IconMoon },
];

/** One button per brush tool, on the left edge of the 3D view. Clicking the active tool turns the brush off. */
function BrushToolbar({ wb, disabled }: { wb: Workbench; disabled: boolean }) {
  const { brush, brushActive } = wb;
  return (
    <div className="wb-brush-tools" role="toolbar" aria-orientation="vertical" aria-label={t.brush.settings}>
      {BRUSH_TOOLS.map(({ tool, Icon }) => {
        const on = brushActive && !disabled && brush.tool === tool;
        return (
          <button
            key={tool}
            type="button"
            className="wb-brush-tools__btn"
            aria-pressed={on}
            aria-label={t.brush.tools[tool]}
            title={disabled ? t.stage.brushFaceUpOnly : `${t.brush.tools[tool]} — ${t.brush.toolHints[tool]} (B)`}
            disabled={disabled}
            onClick={() => {
              if (on && !brush.erase) {
                wb.setBrushActive(false);
                return;
              }
              wb.setBrush({ tool, erase: false });
              wb.setBrushActive(true);
            }}
          >
            <Icon size={18} />
            {tool === 'paint' && <span className="wb-brush-tools__dot" style={{ background: wb.brushSlot?.filament.colorHex }} />}
            {on && brush.erase && <span className="wb-brush-tools__erase" />}
          </button>
        );
      })}
    </div>
  );
}

function LayerScrubber({ total, value, onChange }: { total: number; value: number; onChange: (v: number) => void }) {
  return (
    <div className="wb-scrubber">
      <span className="wb-scrubber__value">{value}</span>
      <input
        className="hc-range wb-scrubber__range"
        type="range"
        min={1}
        max={total}
        step={1}
        value={value}
        aria-label={t.stage.showLayers}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--pct': `${((value - 1) / Math.max(1, total - 1)) * 100}%` } as CSSProperties}
      />
      <span className="wb-scrubber__label">{t.stage.showLayers}</span>
    </div>
  );
}

function CompareHandle({ split, onSplit, scale }: { split: number; onSplit: (v: number) => void; scale: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = useCallback(
    (clientX: number) => {
      const parent = ref.current?.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      onSplit(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)));
    },
    [onSplit],
  );
  return (
    <div
      ref={ref}
      className="wb-compare__handle"
      style={{ left: `${split * 100}%`, '--inv': 1 / scale } as CSSProperties}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && (e.stopPropagation(), move(e.clientX))}
    >
      <span className="wb-compare__knob" />
      <span className="wb-compare__tag wb-compare__tag--left">{t.stage.original}</span>
      <span className="wb-compare__tag wb-compare__tag--right">{t.stage.printed}</span>
    </div>
  );
}

function EmptyStage({ wb, onPickImage }: { wb: Workbench; onPickImage: () => void }) {
  return (
    <main className="wb-stage">
      <div className="wb-empty">
        <div className="wb-empty__drop">
          <IconImage size={28} />
          <h1>{t.stage.dropTitle}</h1>
          <p>{t.stage.dropSub}</p>
          <Button variant="primary" onClick={onPickImage}>
            {t.stage.choose}
          </Button>
        </div>
        {wb.recent.length > 0 && (
          <div className="wb-empty__recent">
            <h2>{t.stage.recent}</h2>
            <div className="wb-empty__grid">
              {wb.recent.slice(0, 8).map((r) => (
                <button key={r.id} type="button" className="wb-recent-card" onClick={() => wb.openProject(r.id)}>
                  {r.thumbnail ? <img src={r.thumbnail} alt="" /> : <span />}
                  <span className="wb-recent-card__name">{r.project.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
