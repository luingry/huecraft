import { useEffect, useState } from 'react';
import type { StackFilament } from '@huecraft/project-schema';
import { Button, Modal, Slider, Switch } from '@huecraft/design-system';
import { t } from '../../../i18n';

function normalizeHex(hex: string): string | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return /^[0-9a-fA-F]{6}$/.test(h) ? `#${h.toLowerCase()}` : null;
}

const BLANK: StackFilament = { name: '', brand: '', colorHex: '#808080', tdMm: 2 };

export function FilamentEditor({
  open,
  initial,
  onCancel,
  onSave,
}: {
  open: boolean;
  initial: StackFilament | null;
  onCancel: () => void;
  onSave: (f: StackFilament, saveToLibrary: boolean) => void;
}) {
  const [draft, setDraft] = useState<StackFilament>(BLANK);
  const [hexText, setHexText] = useState(BLANK.colorHex);
  const [toLibrary, setToLibrary] = useState(false);
  const [showHowTo, setShowHowTo] = useState(false);

  useEffect(() => {
    if (!open) return;
    const f = initial ?? BLANK;
    setDraft(f);
    setHexText(f.colorHex);
    setToLibrary(initial === null);
    setShowHowTo(false);
  }, [open, initial]);

  const hex = normalizeHex(hexText);
  const valid = draft.name.trim().length > 0 && hex !== null;

  return (
    <Modal
      open={open}
      title={initial ? t.filamentEditor.titleEdit : t.filamentEditor.titleNew}
      subtitle={t.filamentEditor.subtitle}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {t.filamentEditor.cancel}
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() => onSave({ ...draft, name: draft.name.trim(), brand: draft.brand.trim(), colorHex: hex! }, toLibrary)}
          >
            {t.filamentEditor.save}
          </Button>
        </>
      }
    >
      <div className="wb-filament-preview" style={{ background: hex ?? draft.colorHex }}>
        <span>{draft.name || t.filamentEditor.name}</span>
      </div>
      <div className="wb-form-row">
        <label className="hc-field" style={{ flex: 1.4 }}>
          <span className="hc-field__label">{t.filamentEditor.name}</span>
          <input
            className="hc-input"
            value={draft.name}
            autoFocus
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label className="hc-field" style={{ flex: 1 }}>
          <span className="hc-field__label">{t.filamentEditor.brand}</span>
          <input className="hc-input" value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} />
        </label>
      </div>
      <div className="hc-field">
        <span className="hc-field__label">{t.filamentEditor.color}</span>
        <div className="wb-color-input">
          <input
            type="color"
            value={hex ?? '#808080'}
            aria-label={t.filamentEditor.color}
            onChange={(e) => {
              setHexText(e.target.value);
              setDraft({ ...draft, colorHex: e.target.value });
            }}
          />
          <input
            className="hc-input"
            value={hexText}
            spellCheck={false}
            data-invalid={hex === null}
            onChange={(e) => setHexText(e.target.value)}
          />
        </div>
      </div>
      <Slider
        label={t.filamentEditor.td}
        value={draft.tdMm}
        min={0.1}
        max={12}
        step={0.1}
        unit="mm"
        hint={t.filamentEditor.tdHint}
        onChange={(tdMm) => setDraft({ ...draft, tdMm })}
      />
      <button type="button" className="wb-link" onClick={() => setShowHowTo((v) => !v)}>
        {t.filamentEditor.howTo}
      </button>
      {showHowTo && (
        <ol className="wb-howto">
          {t.filamentEditor.howToSteps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      )}
      <Switch label={t.filamentEditor.saveToLibrary} checked={toLibrary} onChange={setToLibrary} />
    </Modal>
  );
}
