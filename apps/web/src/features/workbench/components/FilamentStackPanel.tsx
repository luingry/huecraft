import { useState } from 'react';
import type { FilamentRecord } from '@huecraft/filament-db';
import { Button, Panel, tokens } from '@huecraft/design-system';
import type { StackSlot } from '../stack';

export function FilamentStackPanel({
  library,
  stackSlots,
  onReorder,
  onAdd,
  onRemove,
  onEdit,
}: {
  library: FilamentRecord[];
  stackSlots: StackSlot[];
  onReorder: (slots: StackSlot[]) => void;
  onAdd: (filament: FilamentRecord) => void;
  onRemove: (slotId: string) => void;
  onEdit: (slot: StackSlot) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const move = (index: number, dir: -1 | 1) => {
    const next = [...stackSlots];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    onReorder(next);
  };

  return (
    <Panel title="Filament Stack" style={{ width: 240, flexShrink: 0 }}>
      <div style={{ padding: 8, position: 'relative' }}>
        <Button
          variant="subtle"
          style={{ width: '100%', marginBottom: 8 }}
          onClick={() => setPickerOpen((open) => !open)}
        >
          + Add filament
        </Button>

        {pickerOpen && (
          <div
            style={{
              position: 'absolute',
              top: 44,
              left: 8,
              right: 8,
              zIndex: 20,
              background: tokens.color.surface,
              border: `1px solid ${tokens.color.border}`,
              borderRadius: tokens.radius.md,
              boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
              maxHeight: 220,
              overflowY: 'auto',
            }}
          >
            {library.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  onAdd(f);
                  setPickerOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '8px 10px',
                  border: 'none',
                  background: 'transparent',
                  color: tokens.color.text,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 3,
                    background: f.colorHex,
                    border: `1px solid ${tokens.color.border}`,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.name}
                </span>
              </button>
            ))}
          </div>
        )}

        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {stackSlots.map((slot, i) => {
            const f = slot.filament;
            return (
              <li
                key={slot.slotId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 6px',
                  marginBottom: 4,
                  background: tokens.color.surfaceRaised,
                  borderRadius: tokens.radius.sm,
                  border: `1px solid ${tokens.color.border}`,
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 3,
                    background: f.colorHex,
                    border: `1px solid ${tokens.color.border}`,
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.name}
                  </div>
                  <div style={{ fontSize: 10, fontFamily: tokens.font.mono, color: tokens.color.textMuted }}>
                    TD {f.tdMm.toFixed(1)} mm
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <button type="button" onClick={() => move(i, -1)} style={iconBtn}>↑</button>
                  <button type="button" onClick={() => move(i, 1)} style={iconBtn}>↓</button>
                </div>
                <button type="button" onClick={() => onEdit(slot)} style={iconBtn} title="Edit">
                  ✎
                </button>
                <button type="button" onClick={() => onRemove(slot.slotId)} style={iconBtn} title="Remove">
                  ×
                </button>
              </li>
            );
          })}
        </ol>
        {stackSlots.length === 0 && (
          <p style={{ fontSize: 12, color: tokens.color.textMuted, textAlign: 'center', margin: '24px 0' }}>
            Add filaments bottom → top
          </p>
        )}
      </div>
    </Panel>
  );
}

const iconBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: tokens.color.textMuted,
  fontSize: 11,
  padding: 2,
  lineHeight: 1,
};
