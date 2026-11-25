import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createFilamentFromHex, type FilamentRecord } from '@huecraft/filament-db';
import { layerTopZ, type StackEntry, type StackFilament } from '@huecraft/project-schema';
import {
  Button,
  IconButton,
  IconEye,
  IconEyeOff,
  IconGrip,
  IconPlus,
  IconSwap,
  IconTrash,
  IconWand,
  Menu,
  MenuItem,
  NumberField,
  Section,
  Segmented,
} from '@huecraft/design-system';
import { formatMm, t } from '../../../i18n';
import {
  addOnTop,
  bandRange,
  filamentKey,
  filamentsInUse,
  insertInBand,
  moveFilament,
  removeSlot,
  replaceFilament,
  setStartLayer,
  sortStack,
  swapFilaments,
  toStackFilament,
  topReachedLayer,
} from '../stack';
import type { Workbench } from '../useWorkbench';
import { FilamentEditor } from './FilamentEditor';

/** `insertIn`: the band a new filament splits; none = on top. */
type EditorState = { mode: 'new'; insertIn?: string } | { mode: 'edit'; slotId: string } | null;

export function StackEditor({ wb, advanced }: { wb: Workbench; advanced: boolean }) {
  const [editor, setEditor] = useState<EditorState>(null);
  const [hot, setHot] = useState<string | null>(null);
  const templateRef = useRef<HTMLInputElement>(null);
  const stack = sortStack(wb.project.stack);
  const total = wb.totalLayers;
  const print = wb.project.print;
  const histogram = wb.result?.layerHistogram ?? null;
  const topLayer = topReachedLayer(histogram, total);

  const addFilament = (f: FilamentRecord | StackFilament, insertIn?: string) =>
    wb.updateStack((s) => (insertIn ? insertInBand(s, insertIn, f, topLayer) : addOnTop(s, f, topLayer)));
  const picker = (close: () => void, insertIn?: string) => (
    <FilamentPicker
      stack={stack}
      library={wb.library}
      onNew={() => (close(), setEditor({ mode: 'new', insertIn }))}
      onPick={(f) => (close(), addFilament(f, insertIn))}
    />
  );

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
    else if (editor?.mode === 'new') addFilament(filament, editor.insertIn);
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
              <Button size="sm" variant="ghost" onClick={toggle} disabled={!wb.result || wb.tuning} title={t.autoTune.hint}>
                {t.autoTune.button}
              </Button>
            )}
          >
            {(close) => (
              <>
                <div className="hc-menu__label">{t.autoTune.hint}</div>
                {(
                  [
                    [t.autoTune.swaps, t.autoTune.swapsHint, { reorder: false, tone: false }],
                    [t.autoTune.order, t.autoTune.orderHint, { reorder: true, tone: false }],
                    [t.autoTune.full, t.autoTune.fullHint, { reorder: true, tone: true }],
                    [t.autoTune.color, t.autoTune.colorHint, { reorder: true, tone: false, colorMatch: (wb.project.relief.colorMatch ?? 0) > 0 ? wb.project.relief.colorMatch : 0.95 }],
                  ] as const
                ).map(([label, hint, options]) => (
                  <MenuItem
                    key={label}
                    hint={hint}
                    onClick={() => {
                      close();
                      void wb.autoTune(options);
                    }}
                  >
                    {label}
                  </MenuItem>
                ))}
              </>
            )}
          </Menu>
          <Menu
            trigger={({ toggle }) => (
              <IconButton label={t.stack.add} onClick={toggle}>
                <IconPlus />
              </IconButton>
            )}
          >
            {(close) => picker(close)}
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
            histogram={histogram}
            topLayer={topLayer}
            baseLayers={wb.result?.baseLayers ?? 1}
            hidden={wb.hiddenSlots}
            hot={hot}
            onHot={setHot}
            onMove={(slotId, layer) => wb.updateStack((s) => setStartLayer(s, slotId, layer, total), `drag:${slotId}`)}
            addMenu={(slotId, close) => picker(close, slotId)}
            onSwap={(a, b) => wb.updateStack((s) => swapFilaments(s, a, b))}
            onMoveTo={(slotId, to) => wb.updateStack((s) => moveFilament(s, slotId, to))}
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
              // No pixel reaches this layer, so the filament never shows up.
              const outOfRange = entry.startLayer > topLayer;
              const hidden = wb.hiddenSlots.includes(entry.slotId);
              return (
                <li
                  key={entry.slotId}
                  className="wb-stack-row"
                  data-slot={entry.slotId}
                  data-hot={hot === entry.slotId}
                  data-out={outOfRange}
                  title={outOfRange ? t.stack.unreachable : undefined}
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
                  <Menu
                    trigger={({ open, toggle }) => (
                      <IconButton label={t.stack.replace} aria-expanded={open} onClick={toggle}>
                        <IconSwap size={14} />
                      </IconButton>
                    )}
                  >
                    {(close) => (
                      <ReplacePicker
                        current={entry.filament}
                        library={wb.library}
                        onPick={(f) => (close(), wb.updateStack((s) => replaceFilament(s, entry.slotId, toStackFilament(f))))}
                      />
                    )}
                  </Menu>
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
              { value: 'ams', label: t.stack.ams },
              { value: 'pause', label: t.stack.pause },
              { value: 'color-change', label: t.stack.colorChange },
            ]}
          />
          <span className="hc-field__hint">
            {
              {
                ams: t.stack.amsHint(new Set(wb.project.stack.map((e) => e.slotId)).size),
                pause: t.stack.pauseHint,
                'color-change': t.stack.colorChangeHint,
              }[wb.project.export.swapCommand]
            }
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
  topLayer,
  hot,
  onHot,
  onMove,
  addMenu,
  onSwap,
  onMoveTo,
}: {
  stack: StackEntry[];
  total: number;
  histogram: Uint32Array | null;
  baseLayers: number;
  hidden: string[];
  topLayer: number;
  hot: string | null;
  onHot: (slotId: string | null) => void;
  onMove: (slotId: string, layer: number) => void;
  /** Menu of filaments to split the band of `slotId` with. */
  addMenu: (slotId: string, close: () => void) => ReactNode;
  onSwap: (a: string, b: string) => void;
  /** Move the filament of `slotId` to stack index `toIndex` (base = 0). */
  onMoveTo: (slotId: string, toIndex: number) => void;
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

  // Dragging a band by its grip moves its filament, like the rows' grips: over a
  // band the two filaments swap, on a divider it slots in there. Ranges stay put.
  type BandTarget = { kind: 'swap'; slotId: string } | { kind: 'gap'; index: number };
  type BandDrag = { from: string; y: number; target: BandTarget | null };
  const [bandDrag, setBandDragState] = useState<BandDrag | null>(null);
  const bandDragRef = useRef<BandDrag | null>(null);
  const setBandDrag = (d: BandDrag | null) => {
    bandDragRef.current = d;
    setBandDragState(d);
  };
  const bandTargetAt = (from: string, clientY: number): BandTarget | null => {
    const rect = ref.current!.getBoundingClientRect();
    const fromIndex = stack.findIndex((e) => e.slotId === from);
    const visible = stack.filter((e) => e.startLayer < total);
    for (let i = 1; i < visible.length; i++) {
      const y = rect.bottom - (visible[i].startLayer / total) * rect.height;
      if (Math.abs(clientY - y) <= 5) return i === fromIndex || i === fromIndex + 1 ? null : { kind: 'gap', index: i };
    }
    const layer = ((rect.bottom - clientY) / rect.height) * total;
    let over = visible[0];
    for (const e of visible) if (e.startLayer <= layer) over = e;
    return !over || over.slotId === from ? null : { kind: 'swap', slotId: over.slotId };
  };
  const bandDragTo = (clientY: number) => {
    const d = bandDragRef.current;
    if (!d) return;
    const top = ref.current!.getBoundingClientRect().top;
    setBandDrag({ ...d, y: clientY - top, target: bandTargetAt(d.from, clientY) });
  };
  const bandDrop = () => {
    const d = bandDragRef.current;
    setBandDrag(null);
    if (!d?.target) return;
    if (d.target.kind === 'swap') onSwap(d.from, d.target.slotId);
    else {
      const from = stack.findIndex((e) => e.slotId === d.from);
      onMoveTo(d.from, d.target.index > from ? d.target.index - 1 : d.target.index);
    }
  };
  const busy = !!dragging || !!bandDrag;
  const dragged = bandDrag ? stack.find((e) => e.slotId === bandDrag.from) : undefined;

  return (
    <div className="wb-stackbar" ref={ref}>
      {stack.map((e, i) => {
        const end = i + 1 < stack.length ? stack[i + 1].startLayer : total;
        if (e.startLayer >= total) return null;
        return (
          <div
            key={e.slotId}
            className="wb-stackbar__band"
            aria-hidden
            data-hot={hot === e.slotId}
            data-hidden={hidden.includes(e.slotId)}
            data-dragging={bandDrag?.from === e.slotId}
            data-drop={bandDrag?.target?.kind === 'swap' && bandDrag.target.slotId === e.slotId}
            style={{ bottom: pct(e.startLayer), height: `calc(${pct(end)} - ${pct(e.startLayer)})`, background: e.filament.colorHex }}
            onPointerEnter={() => !busy && onHot(e.slotId)}
            onPointerLeave={() => !busy && onHot(null)}
          />
        );
      })}
      {bandDrag?.target?.kind === 'gap' && (
        <span className="wb-stackbar__insert" style={{ bottom: pct(stack[bandDrag.target.index].startLayer) }} aria-hidden />
      )}
      <div className="wb-stackbar__base" style={{ height: pct(baseLayers) }} aria-hidden />
      {histogram && (
        <div className="wb-stackbar__hist" aria-hidden>
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
            aria-hidden
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
      {stack.map((e, i) => {
        if (e.startLayer >= total) return null;
        // Splits only the part of the band the image reaches, so the new colour shows up.
        const range = bandRange(stack, e.slotId, topLayer);
        const canSplit = !!range && range.end - range.start >= 2;
        const end = Math.min(total, i + 1 < stack.length ? stack[i + 1].startLayer : total);
        const mid = canSplit ? (range.start + range.end) / 2 : (e.startLayer + end) / 2;
        return (
          <div
            key={e.slotId}
            className="wb-stackbar__add"
            data-show={!busy && hot === e.slotId}
            style={{ bottom: pct(mid) }}
            onPointerEnter={() => !busy && onHot(e.slotId)}
            onPointerLeave={() => !busy && onHot(null)}
          >
            {stack.length > 1 && (
              <span
                className="wb-stackbar__drag"
                role="button"
                tabIndex={0}
                aria-label={`${t.stack.moveBand}: ${e.filament.name}`}
                title={t.stack.moveBand}
                onPointerDown={(ev) => {
                  if (ev.button !== 0) return;
                  ev.preventDefault();
                  ev.currentTarget.setPointerCapture(ev.pointerId);
                  setBandDrag({ from: e.slotId, y: ev.clientY - ref.current!.getBoundingClientRect().top, target: null });
                }}
                onPointerMove={(ev) => bandDragTo(ev.clientY)}
                onPointerUp={(ev) => {
                  ev.currentTarget.releasePointerCapture(ev.pointerId);
                  bandDragTo(ev.clientY);
                  bandDrop();
                }}
                onPointerCancel={() => setBandDrag(null)}
                onKeyDown={(ev) => {
                  if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
                  ev.preventDefault();
                  const other = stack[i + (ev.key === 'ArrowUp' ? 1 : -1)];
                  if (other) onSwap(e.slotId, other.slotId);
                }}
              >
                <IconGrip size={12} />
              </span>
            )}
            {canSplit && <Menu
              align="left"
              trigger={({ open, toggle }) => (
                <button
                  type="button"
                  className="wb-stackbar__add-btn"
                  aria-label={`${t.stack.addHere}: ${e.filament.name}`}
                  aria-expanded={open}
                  title={t.stack.addHere}
                  onClick={toggle}
                >
                  <IconPlus size={12} />
                </button>
              )}
            >
              {(close) => addMenu(e.slotId, close)}
            </Menu>}
          </div>
        );
      })}
      {bandDrag && dragged && (
        <span
          className="wb-stackbar__ghost"
          style={{ top: bandDrag.y, background: dragged.filament.colorHex }}
          aria-hidden
        />
      )}
      <span className="wb-stackbar__cap wb-stackbar__cap--top" aria-hidden>{total}</span>
      <span className="wb-stackbar__cap wb-stackbar__cap--bottom" aria-hidden>1</span>
    </div>
  );
}

/** Library filaments to put in a slot instead of its current one; the slot keeps its layer range. */
function ReplacePicker({
  current,
  library,
  onPick,
}: {
  current: StackFilament;
  library: FilamentRecord[];
  onPick: (f: FilamentRecord) => void;
}) {
  const options = library.filter((f) => f.id !== current.libraryId);
  return (
    <div className="wb-library-menu">
      <div className="hc-menu__label">{t.stack.library}</div>
      {options.length === 0 ? (
        <div className="hc-menu__label">{t.stack.replaceEmpty}</div>
      ) : (
        options.map((f) => (
          <MenuItem
            key={f.id}
            icon={<span className="wb-swatch wb-swatch--sm" style={{ background: f.colorHex }} />}
            hint={`${f.brand ? `${f.brand} · ` : ''}${t.stack.td} ${formatMm(f.tdMm)} mm`}
            onClick={() => onPick(f)}
          >
            {f.name}
          </MenuItem>
        ))
      )}
    </div>
  );
}

/** "New filament", then the filaments already in the stack, then the library ones not in use. */
function FilamentPicker({
  stack,
  library,
  onNew,
  onPick,
}: {
  stack: StackEntry[];
  library: FilamentRecord[];
  onNew: () => void;
  onPick: (f: FilamentRecord | StackFilament) => void;
}) {
  const inUse = filamentsInUse(stack);
  const used = new Set(inUse.map(filamentKey));
  const unused = library.filter((f) => !used.has(f.id));
  const item = (f: FilamentRecord | StackFilament, key: string) => (
    <MenuItem
      key={key}
      icon={<span className="wb-swatch wb-swatch--sm" style={{ background: f.colorHex }} />}
      hint={`${f.brand ? `${f.brand} · ` : ''}${t.stack.td} ${formatMm(f.tdMm)} mm`}
      onClick={() => onPick(f)}
    >
      {f.name}
    </MenuItem>
  );
  return (
    <div className="wb-library-menu">
      <MenuItem icon={<IconPlus />} onClick={onNew}>
        {t.stack.newFilament}
      </MenuItem>
      {inUse.length > 0 && (
        <>
          <div className="hc-menu__sep" />
          <div className="hc-menu__label">{t.stack.inUse}</div>
          {inUse.map((f) => item(f, `use:${filamentKey(f)}`))}
        </>
      )}
      {unused.length > 0 && (
        <>
          <div className="hc-menu__sep" />
          <div className="hc-menu__label">{t.stack.unused}</div>
          {unused.map((f) => item(f, f.id))}
        </>
      )}
    </div>
  );
}
