import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, IconTrash, Slider, Switch } from '@huecraft/design-system';
import type { PaintBlend } from '@huecraft/project-schema';
import { t } from '../../../i18n';
import { sortStack } from '../stack';
import { isClickTool, isColorBlend, type BrushTool, type SelectMode, type Workbench } from '../useWorkbench';

const BLENDS: PaintBlend[] = ['normal', 'sampled', 'onLight', 'onDark', 'raise', 'lower'];
const TOOLS: BrushTool[] = ['paint', 'brighten', 'darken', 'fill', 'selectArea', 'selectColor'];
const SELECT_MODES: SelectMode[] = ['replace', 'add', 'subtract'];

/** Brush settings popover, opened with a right-click on the 3D view. */
export function BrushMenu({ wb, x, y, onClose }: { wb: Workbench; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const { brush, setBrush } = wb;
  const maxSize = Math.max(10, Math.round(wb.project.print.widthMm / 3));
  const stack = sortStack(wb.project.stack).reverse();
  const paintCount = wb.project.paint?.length ?? 0;
  const tool = brush.tool;
  const click = isClickTool(tool);
  const selecting = tool === 'selectArea' || tool === 'selectColor';
  const painting = tool === 'paint' && !brush.erase;
  // Tools that put a filament down (the eraser undoes them).
  const usesColor = tool === 'paint' || tool === 'fill';

  // Keep the popover inside the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
  }, [x, y, tool]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current || ref.current.contains(e.target as Node)) return;
      // The click that dismisses the menu must not also paint or orbit.
      if ((e.target as Element).closest?.('.wb-mesh')) {
        e.stopPropagation();
        e.preventDefault();
      }
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="hc-menu wb-brush-menu"
      role="dialog"
      aria-label={t.brush.settings}
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="hc-menu__label">{t.brush.settings}</div>
      <div className="wb-brush-menu__body">
        <div className="hc-field">
          <span className="hc-field__label">{t.brush.tool}</span>
          <div className="hc-seg wb-brush-menu__tools" role="group" aria-label={t.brush.tool}>
            {TOOLS.map((item) => (
              <button
                key={item}
                type="button"
                className="hc-seg__item"
                aria-pressed={!brush.erase && tool === item}
                title={t.brush.toolHints[item]}
                onClick={() => setBrush({ tool: item, erase: false })}
              >
                {t.brush.tools[item]}
              </button>
            ))}
          </div>
          <span className="hc-field__hint">{t.brush.toolHints[tool]}</span>
        </div>
        {!click && (
          <>
            <Slider label={t.brush.size} value={brush.sizeMm} min={0.5} max={maxSize} step={0.5} unit="mm" inputMax={200} onChange={(v) => setBrush({ sizeMm: Math.max(0.2, v) })} />
            <Slider label={t.brush.softness} value={Math.round(brush.softness * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => setBrush({ softness: v / 100 })} />
          </>
        )}
        {(usesColor || brush.erase) && (
          <Slider label={t.brush.opacity} value={Math.round(brush.opacity * 100)} min={1} max={100} step={1} unit="%" onChange={(v) => setBrush({ opacity: Math.max(1, v) / 100 })} />
        )}
        {(tool === 'brighten' || tool === 'darken') && !brush.erase && (
          <Slider label={t.brush.strength} value={Math.round(brush.toneStrength * 100)} min={1} max={100} step={1} unit="%" hint={t.brush.strengthHint} onChange={(v) => setBrush({ toneStrength: Math.min(100, Math.max(1, v)) / 100 })} />
        )}
        {usesColor && (
          <div className="hc-field">
            <span className="hc-field__label">{t.brush.color}</span>
            <div className="wb-brush-menu__swatches" role="group" aria-label={t.brush.color}>
              {stack.map((e) => (
                <button
                  key={e.slotId}
                  type="button"
                  className="wb-brush-menu__swatch"
                  style={{ background: e.filament.colorHex }}
                  aria-pressed={!brush.erase && wb.brushSlot?.slotId === e.slotId}
                  title={e.filament.name}
                  aria-label={e.filament.name}
                  onClick={() => setBrush({ slotId: e.slotId, erase: false })}
                />
              ))}
            </div>
            <span className="hc-field__hint">{t.brush.colorHint}</span>
          </div>
        )}
        {tool === 'fill' && (
          <>
            <Slider
              label={t.brush.fillTolerance}
              value={Math.round(brush.fillTolerance * 100)}
              min={0}
              max={100}
              step={1}
              unit="%"
              hint={t.brush.fillToleranceHint}
              onChange={(v) => setBrush({ fillTolerance: Math.min(100, Math.max(0, v)) / 100 })}
            />
            <Switch label={t.brush.contiguous} hint={t.brush.contiguousHint} checked={brush.fillContiguous} onChange={(v) => setBrush({ fillContiguous: v })} />
          </>
        )}
        {selecting && (
          <>
            <Slider
              label={t.brush.fillTolerance}
              value={Math.round(brush.selectTolerance * 100)}
              min={0}
              max={100}
              step={1}
              unit="%"
              hint={t.brush.selectToleranceHint}
              onChange={(v) => setBrush({ selectTolerance: Math.min(100, Math.max(0, v)) / 100 })}
            />
            <div className="hc-field">
              <span className="hc-field__label">{t.brush.selectMode}</span>
              <div className="hc-seg wb-brush-menu__modes" role="group" aria-label={t.brush.selectMode}>
                {SELECT_MODES.map((m) => (
                  <button key={m} type="button" className="hc-seg__item" aria-pressed={brush.selectMode === m} onClick={() => setBrush({ selectMode: m })}>
                    {t.brush.selectModes[m]}
                  </button>
                ))}
              </div>
              <span className="hc-field__hint">{t.brush.selectModeHint}</span>
            </div>
          </>
        )}
        {painting && (
          <div className="hc-field">
            <span className="hc-field__label">{t.brush.blend}</span>
            <div className="hc-seg wb-brush-menu__blends" role="group" aria-label={t.brush.blend}>
              {BLENDS.map((b) => (
                <button
                  key={b}
                  type="button"
                  className="hc-seg__item"
                  aria-pressed={brush.blend === b}
                  title={t.brush.blendHints[b]}
                  onClick={() => setBrush({ blend: b })}
                >
                  {t.brush.blends[b]}
                </button>
              ))}
            </div>
            <span className="hc-field__hint">{t.brush.blendHints[brush.blend]}</span>
          </div>
        )}
        {painting && isColorBlend(brush.blend) && (
          <Slider
            key={brush.blend}
            label={t.brush.tolerance}
            value={Math.round(brush.tolerances[brush.blend] * 100)}
            min={0}
            max={100}
            step={1}
            unit="%"
            hint={t.brush.toleranceHints[brush.blend]}
            onChange={(v) => setBrush({ tolerances: { ...brush.tolerances, [brush.blend]: Math.min(100, Math.max(0, v)) / 100 } })}
          />
        )}
        {!selecting && <Switch label={t.brush.erase} checked={brush.erase} onChange={(v) => setBrush({ erase: v })} />}
        {(selecting || wb.hasSelection) && (
          <div className="hc-field">
            <span className="hc-field__label">{t.brush.selection}</span>
            <div className="wb-brush-menu__row">
              <Button size="sm" disabled={!wb.hasSelection} onClick={() => wb.changeSelection('invert')}>
                {t.brush.invertSelection}
              </Button>
              <Button size="sm" disabled={!wb.hasSelection} onClick={() => wb.changeSelection('clear')}>
                {t.brush.clearSelection}
              </Button>
            </div>
            <span className="hc-field__hint">{wb.hasSelection ? t.brush.selectionActive : t.brush.selectionNone}</span>
          </div>
        )}
      </div>
      <div className="hc-menu__sep" />
      <Button
        size="sm"
        variant="ghost"
        block
        disabled={paintCount === 0}
        onClick={() => {
          wb.clearPaint();
          onClose();
        }}
      >
        <IconTrash size={14} />
        {t.brush.clear}
      </Button>
    </div>
  );
}
