import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createFilamentFromHex } from '@huecraft/filament-db';
import { layerTopZ, type StackEntry, type StackFilament } from '@huecraft/project-schema';
import {
  Button,
  IconButton,
  IconEye,
  IconEyeOff,
  IconGrip,
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
import { addOnTop, removeSlot, replaceFilament, setStartLayer, moveFilament, sortStack, swapFilaments } from '../stack';
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

  // Dragging a row by its grip moves its filament; the layer ranges stay where they are.
  // Over the middle of a row the two filaments swap; near the edge between two rows
  // the filament slots in there and the ones in between shift by one.
  const rows = [...stack].reverse(); // display order: top of the print first
  type DropTarget = { kind: 'swap'; slotId: string } | { kind: 'gap'; gap: number; y: number };
  type Reorder = { from: string; target: DropTarget | null; startY: number; dy: number };
  const [reorder, setReorderState] = useState<Reorder | null>(null);
  // Mirrors the state so pointer handlers never read a stale render.
  const reorderRef = useRef<Reorder | null>(null);
  const setReorder = (r: Reorder | null) => {
    reorderRef.current = r;
    setReorderState(r);
  };
  const rowsRef = useRef<HTMLOListElement>(null);
  // A gap right above or below the dragged row would not change anything.
  const isNoopGap = (gap: number, from: number) => gap === from || gap === from + 1;

  const targetAt = (r: Reorder, clientY: number): DropTarget | null => {
    const list = rowsRef.current;
    if (!list) return null;
    // Layout boxes (offsetTop/offsetHeight) ignore the drag and spread transforms.
    const els = [...list.querySelectorAll<HTMLElement>('[data-slot]')];
    const y = clientY - list.getBoundingClientRect().top;
    const from = els.findIndex((el) => el.dataset.slot === r.from);
    const gapY = (g: number) =>
      g === 0 ? els[0].offsetTop - 2 : els[g - 1].offsetTop + els[g - 1].offsetHeight + 2;
    const gap = (g: number): DropTarget | null => (isNoopGap(g, from) ? null : { kind: 'gap', gap: g, y: gapY(g) });
    for (let i = 0; i < els.length; i++) {
      const top = els[i].offsetTop;
      const h = els[i].offsetHeight;
      if (y < top + h * 0.25) return gap(i);
      if (y <= top + h * 0.75) return els[i].dataset.slot === r.from ? null : { kind: 'swap', slotId: els[i].dataset.slot! };
    }
    return gap(els.length);
  };
  const dragTo = (y: number) => {
    const r = reorderRef.current;
    if (r) setReorder({ ...r, target: targetAt(r, y), dy: y - r.startY });
  };
  const drop = () => {
    const r = reorderRef.current;
    setReorder(null);
    const target = r?.target;
    if (!r || !target) return;
    if (target.kind === 'swap') {
      wb.updateStack((s) => swapFilaments(s, r.from, target.slotId));
    } else {
      const from = rows.findIndex((e) => e.slotId === r.from);
      const display = target.gap > from ? target.gap - 1 : target.gap;
      wb.updateStack((s) => moveFilament(s, r.from, rows.length - 1 - display));
    }
  };
  // Rows part around the gap the filament would slot into.
  const spreadOf = (displayIndex: number) => {
    const target = reorder?.target;
    if (!target || target.kind !== 'gap') return 0;
    return displayIndex < target.gap ? -5 : 5;
  };
  const swapWith = (slotId: string, offset: number) => {
    const target = rows[rows.findIndex((e) => e.slotId === slotId) + offset];
    if (target) wb.updateStack((s) => swapFilaments(s, slotId, target.slotId));
  };

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
            hidden={wb.hiddenSlots}
            hot={hot}
            onHot={setHot}
            onMove={(slotId, layer) => wb.updateStack((s) => setStartLayer(s, slotId, layer, total), `drag:${slotId}`)}
          />
          <ol className="wb-stack__rows" ref={rowsRef} data-reordering={!!reorder}>
            {reorder?.target?.kind === 'gap' && (
              <span className="wb-stack__insert" style={{ top: reorder.target.y }} aria-hidden />
            )}
            {rows.map((entry, displayIndex) => {
              const index = stack.indexOf(entry);
              const dragged = reorder?.from === entry.slotId;
              const spread = dragged ? 0 : spreadOf(displayIndex);
              const isBase = index === 0;
              const outOfRange = entry.startLayer >= total;
              const hidden = wb.hiddenSlots.includes(entry.slotId);
              return (
                <li
                  key={entry.slotId}
                  className="wb-stack-row"
                  data-slot={entry.slotId}
                  data-hot={hot === entry.slotId}
                  data-out={outOfRange}
                  data-hidden={hidden}
                  data-dragging={dragged}
                  data-drop={reorder?.target?.kind === 'swap' && reorder.target.slotId === entry.slotId}
                  style={
                    dragged
                      ? { transform: `translateY(${reorder!.dy}px)` }
                      : spread
                        ? { transform: `translateY(${spread}px)` }
                        : undefined
                  }
                  onPointerEnter={() => setHot(entry.slotId)}
                  onPointerLeave={() => setHot(null)}
                >
                  <span
                    className="wb-stack-row__grip"
                    role="button"
                    tabIndex={0}
                    aria-label={`${t.stack.reorder}: ${entry.filament.name}`}
                    title={t.stack.reorder}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.preventDefault();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setReorder({ from: entry.slotId, target: null, startY: e.clientY, dy: 0 });
                    }}
                    onPointerMove={(e) => dragTo(e.clientY)}
                    onPointerUp={(e) => {
                      e.currentTarget.releasePointerCapture(e.pointerId);
                      dragTo(e.clientY);
                      drop();
                    }}
                    onPointerCancel={() => setReorder(null)}
                    onKeyDown={(e) => {
                      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                      e.preventDefault();
                      swapWith(entry.slotId, e.key === 'ArrowUp' ? -1 : 1);
                    }}
                  >
                    <IconGrip size={14} />
                  </span>
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
                  <div className="wb-stack-row__actions">
                  <IconButton
                    label={hidden ? t.stack.show : t.stack.hide}
                    className="wb-stack-row__eye"
                    aria-pressed={hidden}
                    disabled={!hidden && wb.project.stack.length - wb.hiddenCount <= 1}
                    onClick={() => wb.toggleHidden(entry.slotId)}
                  >
                    {hidden ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                  </IconButton>
                  <IconButton
                    label={t.stack.remove}
                    danger
                    disabled={stack.length <= 1}
                    onClick={() => wb.updateStack((s) => removeSlot(s, entry.slotId))}
                  >
                    <IconTrash size={14} />
                  </IconButton>
                  </div>
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
  hidden,
  hot,
  onHot,
  onMove,
}: {
  stack: StackEntry[];
  total: number;
  histogram: Uint32Array | null;
  baseLayers: number;
  hidden: string[];
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
            data-hidden={hidden.includes(e.slotId)}
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
