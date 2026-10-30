import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createFilamentFromHex } from '@huecraft/filament-db';
import { layerTopZ, type StackEntry, type StackFilament } from '@huecraft/project-schema';
import {
  Button,
  IconButton,
  IconPlus,
  IconTrash,
  IconWand,
  Menu,
  MenuItem,
  NumberField,
  Section,
  Segmented,
} from '@huecraft/design-system';
import { formatMm, t } from '../../../i18n';
import { addOnTop, removeSlot, replaceFilament, setStartLayer, sortStack } from '../stack';
import type { Workbench } from '../useWorkbench';
import { FilamentEditor } from './FilamentEditor';

type EditorState = { mode: 'new' } | { mode: 'edit'; slotId: string } | null;

export function StackEditor({ wb, advanced }: { wb: Workbench; advanced: boolean }) {
  const [editor, setEditor] = useState<EditorState>(null);
  const [hot, setHot] = useState<string | null>(null);
  const templateRef = useRef<HTMLInputElement>(null);
  const stack = sortStack(wb.project.stack);
  const total = wb.totalLayers;
  const print = wb.project.print;

  const editing = editor?.mode === 'edit' ? stack.find((e) => e.slotId === editor.slotId) : undefined;

  const onSaveFilament = async (f: StackFilament, toLibrary: boolean) => {
    let filament = f;
    if (toLibrary) {
      const rec = createFilamentFromHex(f.name, f.brand, f.colorHex, f.tdMm);
      if (f.libraryId && wb.library.some((l) => l.id === f.libraryId && l.source !== 'builtin')) rec.id = f.libraryId;
      await wb.saveFilamentToLibrary(rec);
      filament = { ...f, libraryId: rec.id };
    }
    if (editor?.mode === 'edit') wb.updateStack((s) => replaceFilament(s, editor.slotId, filament));
    else wb.updateStack((s) => addOnTop(s, filament, total));
    setEditor(null);
  };

  return (
    <Section
      step={3}
      title={t.stack.title}
      actions={
        <>
          <Button size="sm" variant="ghost" onClick={wb.autoDistribute} disabled={!wb.result} title={t.stack.autoHint}>
            <IconWand size={14} />
            {t.stack.auto}
          </Button>
          <Menu
            trigger={({ toggle }) => (
              <IconButton label={t.stack.add} onClick={toggle}>
                <IconPlus />
              </IconButton>
            )}
          >
            {(close) => (
              <div className="wb-library-menu">
                <MenuItem icon={<IconPlus />} onClick={() => (close(), setEditor({ mode: 'new' }))}>
                  {t.stack.newFilament}
                </MenuItem>
                <div className="hc-menu__sep" />
                <div className="hc-menu__label">{t.stack.library}</div>
                {wb.library.map((f) => (
                  <MenuItem
                    key={f.id}
                    icon={<span className="wb-swatch wb-swatch--sm" style={{ background: f.colorHex }} />}
                    hint={`${f.brand} · ${t.stack.td} ${formatMm(f.tdMm)} mm`}
                    onClick={() => {
                      close();
                      wb.updateStack((s) => addOnTop(s, f, total));
                    }}
                  >
                    {f.name}
                  </MenuItem>
                ))}
              </div>
            )}
          </Menu>
        </>
      }
    >
      {stack.length === 0 ? (
        <p className="hc-faint">{t.stack.empty}</p>
      ) : (
        <div className="wb-stack">
          <StackBar
            stack={stack}
            total={total}
            histogram={wb.result?.layerHistogram ?? null}
            baseLayers={wb.result?.baseLayers ?? 1}
            hot={hot}
            onHot={setHot}
            onMove={(slotId, layer) => wb.updateStack((s) => setStartLayer(s, slotId, layer, total), `drag:${slotId}`)}
          />
          <ol className="wb-stack__rows">
            {[...stack].reverse().map((entry) => {
              const index = stack.indexOf(entry);
              const isBase = index === 0;
              const outOfRange = entry.startLayer >= total;
              return (
                <li
                  key={entry.slotId}
                  className="wb-stack-row"
                  data-hot={hot === entry.slotId}
                  data-out={outOfRange}
                  onPointerEnter={() => setHot(entry.slotId)}
                  onPointerLeave={() => setHot(null)}
                >
                  <button
                    type="button"
                    className="wb-swatch"
                    style={{ background: entry.filament.colorHex }}
                    aria-label={`${t.stack.edit}: ${entry.filament.name}`}
                    title={t.stack.edit}
                    onClick={() => setEditor({ mode: 'edit', slotId: entry.slotId })}
                  />
                  <button
                    type="button"
                    className="wb-stack-row__info"
                    onClick={() => setEditor({ mode: 'edit', slotId: entry.slotId })}
                  >
                    <span className="wb-stack-row__name">{entry.filament.name}</span>
                    <span className="wb-stack-row__meta">
                      {t.stack.td} {formatMm(entry.filament.tdMm)} mm
                    </span>
                  </button>
                  {isBase ? (
                    <span className="wb-chip">{t.stack.base}</span>
                  ) : (
                    <div className="wb-stack-row__layer">
                      <NumberField
                        ariaLabel={`${t.stack.startsAt} (${entry.filament.name})`}
                        value={entry.startLayer + 1}
                        min={2}
                        max={Math.max(2, total)}
                        step={1}
                        onChange={(v) => wb.updateStack((s) => setStartLayer(s, entry.slotId, v - 1, total))}
                      />
                      <span className="wb-stack-row__z">Z {formatMm(layerTopZ(print, entry.startLayer), 2)}</span>
                    </div>
                  )}
                  <IconButton
                    label={t.stack.remove}
                    danger
                    disabled={stack.length <= 1}
                    onClick={() => wb.updateStack((s) => removeSlot(s, entry.slotId))}
                  >
                    <IconTrash size={14} />
                  </IconButton>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      <p className="hc-field__hint">{t.stack.dragHint}</p>

      {advanced && (
        <div className="hc-field">
          <span className="hc-field__label">{t.stack.swapCommand}</span>
          <Segmented
            value={wb.project.export.swapCommand}
            onChange={wb.setSwapCommand}
            options={[
              { value: 'pause', label: t.stack.pause },
              { value: 'color-change', label: t.stack.colorChange },
            ]}
          />
          <span className="hc-field__hint">
            {wb.project.export.swapCommand === 'pause' ? t.stack.pauseHint : t.stack.colorChangeHint}
          </span>
        </div>
      )}

      <input
        ref={templateRef}
        type="file"
        accept=".3mf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) wb.chooseSlicerTemplate(f);
          e.target.value = '';
        }}
      />
      {advanced ? (
        <div className="hc-field">
          <span className="hc-field__label">{t.template.title}</span>
          <div className="wb-template">
            <span className="wb-template__name" data-empty={!wb.slicerTemplate}>
              {wb.slicerTemplate ? wb.slicerTemplate.fileName : t.template.none}
              {wb.slicerTemplate && <small>{wb.slicerTemplate.application.replace('-', ' ')}</small>}
            </span>
            <Button size="sm" onClick={() => templateRef.current?.click()}>
              {wb.slicerTemplate ? t.template.change : t.template.choose}
            </Button>
            {wb.slicerTemplate && (
              <IconButton label={t.template.remove} danger onClick={() => wb.chooseSlicerTemplate(null)}>
                <IconTrash size={14} />
              </IconButton>
            )}
          </div>
          <span className="hc-field__hint">{t.template.hint}</span>
        </div>
      ) : (
        !wb.slicerTemplate &&
        stack.length > 1 && (
          <div className="wb-callout">
            <strong>{t.template.calloutTitle}</strong>
            <span>{t.template.callout}</span>
            <Button size="sm" onClick={() => templateRef.current?.click()}>
              {t.template.choose}
            </Button>
          </div>
        )
      )}

      <FilamentEditor
        open={editor !== null}
        initial={editing?.filament ?? null}
        onCancel={() => setEditor(null)}
        onSave={onSaveFilament}
      />
    </Section>
  );
}

/** Vertical layer bar: colour bands per filament, tone histogram and draggable swap handles. */
function StackBar({
  stack,
  total,
  histogram,
  baseLayers,
  hot,
  onHot,
  onMove,
}: {
  stack: StackEntry[];
  total: number;
  histogram: Uint32Array | null;
  baseLayers: number;
  hot: string | null;
  onHot: (slotId: string | null) => void;
  onMove: (slotId: string, layer: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const pct = (layer: number) => `${(Math.min(layer, total) / total) * 100}%`;

  let histMax = 1;
  if (histogram) for (let n = 1; n < histogram.length; n++) histMax = Math.max(histMax, histogram[n]);

  const layerFromPointer = (e: ReactPointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    const y = Math.min(rect.bottom, Math.max(rect.top, e.clientY));
    return Math.round(((rect.bottom - y) / rect.height) * total);
  };

  return (
    <div className="wb-stackbar" ref={ref} aria-hidden>
      {stack.map((e, i) => {
        const end = i + 1 < stack.length ? stack[i + 1].startLayer : total;
        if (e.startLayer >= total) return null;
        return (
          <div
            key={e.slotId}
            className="wb-stackbar__band"
            data-hot={hot === e.slotId}
            style={{ bottom: pct(e.startLayer), height: `calc(${pct(end)} - ${pct(e.startLayer)})`, background: e.filament.colorHex }}
          />
        );
      })}
      <div className="wb-stackbar__base" style={{ height: pct(baseLayers) }} />
      {histogram && (
        <div className="wb-stackbar__hist">
          {Array.from({ length: total }, (_, k) => {
            // Pixels whose top layer is k (layer count k + 1).
            const v = histogram[k + 1] ?? 0;
            if (v === 0) return null;
            return (
              <span
                key={k}
                style={{ bottom: pct(k), height: `calc(${pct(1)} + 0.5px)`, width: `${Math.max(4, (v / histMax) * 100)}%` }}
              />
            );
          })}
        </div>
      )}
      {stack.slice(1).map((e) => {
        if (e.startLayer >= total) return null;
        const active = dragging === e.slotId || hot === e.slotId;
        return (
          <div
            key={e.slotId}
            className="wb-stackbar__handle"
            data-active={active}
            style={{ bottom: pct(e.startLayer) }}
            onPointerEnter={() => onHot(e.slotId)}
            onPointerLeave={() => !dragging && onHot(null)}
            onPointerDown={(ev) => {
              ev.currentTarget.setPointerCapture(ev.pointerId);
              setDragging(e.slotId);
              onHot(e.slotId);
            }}
            onPointerMove={(ev) => dragging === e.slotId && onMove(e.slotId, layerFromPointer(ev))}
            onPointerUp={(ev) => {
              ev.currentTarget.releasePointerCapture(ev.pointerId);
              setDragging(null);
            }}
          >
            <span className="wb-stackbar__grip" />
            {active && <span className="wb-stackbar__label">{e.startLayer + 1}</span>}
          </div>
        );
      })}
      <span className="wb-stackbar__cap wb-stackbar__cap--top">{total}</span>
      <span className="wb-stackbar__cap wb-stackbar__cap--bottom">1</span>
    </div>
  );
}
