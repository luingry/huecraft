import React from 'react';
import type { FilamentRecord } from '@huecraft/filament-db';
import { createFilamentFromHex } from '@huecraft/filament-db';
import { Button, Slider, tokens } from '@huecraft/design-system';
import type { ReliefMode } from '@huecraft/project-schema';

export function PropertiesRail({
  mode,
  contrast,
  gamma,
  layerHeightMm,
  maxHeightMm,
  mmPerPixel,
  onModeChange,
  onContrastChange,
  onGammaChange,
  onLayerHeightChange,
  onMaxHeightChange,
  onMmPerPixelChange,
}: {
  mode: ReliefMode;
  contrast: number;
  gamma: number;
  layerHeightMm: number;
  maxHeightMm: number;
  mmPerPixel: number;
  onModeChange: (m: ReliefMode) => void;
  onContrastChange: (v: number) => void;
  onGammaChange: (v: number) => void;
  onLayerHeightChange: (v: number) => void;
  onMaxHeightChange: (v: number) => void;
  onMmPerPixelChange: (v: number) => void;
}) {
  return (
    <aside style={{ width: 260, flexShrink: 0, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <section>
        <label style={{ fontSize: 11, color: tokens.color.textMuted, display: 'block', marginBottom: 4 }}>Relief mode</label>
        <select
          value={mode}
          onChange={(e) => onModeChange(e.target.value as ReliefMode)}
          style={{
            width: '100%',
            padding: '8px 10px',
            background: tokens.color.surfaceRaised,
            border: `1px solid ${tokens.color.border}`,
            borderRadius: tokens.radius.sm,
            color: tokens.color.text,
          }}
        >
          <option value="luminance">Luminance</option>
          <option value="contrast">Contrast</option>
          <option value="palette">Palette Regions</option>
          <option value="reference">Reference Map</option>
        </select>
      </section>
      {mode === 'contrast' && (
        <>
          <Slider label="Contrast" value={contrast} min={0.2} max={3} step={0.05} onChange={onContrastChange} />
          <Slider label="Gamma" value={gamma} min={0.4} max={2.5} step={0.05} onChange={onGammaChange} />
        </>
      )}
      <Slider label="Layer height (mm)" value={layerHeightMm} min={0.04} max={0.2} step={0.01} onChange={onLayerHeightChange} />
      <Slider label="Max relief (mm)" value={maxHeightMm} min={0.5} max={8} step={0.1} onChange={onMaxHeightChange} />
      <Slider label="Scale (mm/px)" value={mmPerPixel} min={0.1} max={1} step={0.05} onChange={onMmPerPixelChange} />
    </aside>
  );
}

export function FilamentEditorModal({
  filament,
  onSave,
  onClose,
}: {
  filament: FilamentRecord | null;
  onSave: (f: FilamentRecord) => void;
  onClose: () => void;
}) {
  const [name, setName] = React.useState('');
  const [brand, setBrand] = React.useState('');
  const [colorHex, setColorHex] = React.useState('#ffffff');
  const [tdMm, setTdMm] = React.useState(1);

  React.useEffect(() => {
    if (!filament) return;
    setName(filament.name);
    setBrand(filament.brand);
    setColorHex(filament.colorHex);
    setTdMm(filament.tdMm);
  }, [filament]);

  if (!filament) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: tokens.color.surface,
          border: `1px solid ${tokens.color.border}`,
          borderRadius: tokens.radius.md,
          padding: 24,
          width: 360,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 16px', fontSize: 16 }}>Edit filament</h2>
        <Field label="Name" value={name} onChange={setName} />
        <Field label="Brand" value={brand} onChange={setBrand} />
        <ColorField label="Color" value={colorHex} onChange={setColorHex} />
        <Slider label="TD (mm)" value={tdMm} min={0.1} max={12} step={0.1} onChange={setTdMm} />
        <p style={{ fontSize: 11, color: tokens.color.textMuted, marginTop: 8 }}>
          Lower TD = more opaque. Calibrate with a test print for best preview accuracy.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              const updated = createFilamentFromHex(name, brand, colorHex, tdMm);
              onSave({ ...filament, ...updated, id: filament.id, source: filament.source });
              onClose();
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function normalizeHex(hex: string): string {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return '#ffffff';
  return `#${h.toLowerCase()}`;
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const pickerValue = normalizeHex(value);

  return (
    <label style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
      <span style={{ color: tokens.color.textMuted }}>{label}</span>
      <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
        <input
          type="color"
          value={pickerValue}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} picker`}
          style={{
            width: 44,
            height: 36,
            padding: 2,
            border: `1px solid ${tokens.color.border}`,
            borderRadius: tokens.radius.sm,
            background: tokens.color.surfaceRaised,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#rrggbb"
          spellCheck={false}
          style={{
            flex: 1,
            padding: '8px 10px',
            background: tokens.color.surfaceRaised,
            border: `1px solid ${tokens.color.border}`,
            borderRadius: tokens.radius.sm,
            color: tokens.color.text,
            fontFamily: tokens.font.mono,
            fontSize: 12,
          }}
        />
        <span
          aria-hidden
          style={{
            width: 20,
            height: 20,
            borderRadius: tokens.radius.sm,
            border: `1px solid ${tokens.color.border}`,
            background: pickerValue,
            flexShrink: 0,
          }}
        />
      </div>
    </label>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
      <span style={{ color: tokens.color.textMuted }}>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          display: 'block',
          width: '100%',
          marginTop: 4,
          padding: '8px 10px',
          background: tokens.color.surfaceRaised,
          border: `1px solid ${tokens.color.border}`,
          borderRadius: tokens.radius.sm,
          color: tokens.color.text,
        }}
      />
    </label>
  );
}

export function CalibrationAssistant({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (name: string, brand: string, colorHex: string, tdMm: number) => void;
}) {
  const [step, setStep] = React.useState(0);
  const [name, setName] = React.useState('');
  const [brand, setBrand] = React.useState('');
  const [colorHex, setColorHex] = React.useState('#ffffff');
  const [tdMm, setTdMm] = React.useState(4);

  if (!open) return null;

  const steps = [
    'Name your filament and pick its pigment color.',
    'Print a two-layer test over white or black base.',
    'Compare to the ladder — enter the TD where opacity matches.',
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div style={{ background: tokens.color.surface, border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.md, padding: 24, width: 420 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>TD Calibration</h2>
        <p style={{ fontSize: 12, color: tokens.color.textMuted, marginBottom: 16 }}>Step {step + 1}/3 — {steps[step]}</p>
        {step === 0 && (
          <>
            <Field label="Name" value={name} onChange={setName} />
            <Field label="Brand" value={brand} onChange={setBrand} />
            <ColorField label="Color" value={colorHex} onChange={setColorHex} />
          </>
        )}
        {step === 1 && (
          <p style={{ fontSize: 13, lineHeight: 1.5 }}>
            Use 0.08 mm layers. Place opaque base, then 8–12 layers of your filament. Photograph under consistent light.
          </p>
        )}
        {step === 2 && <Slider label="Measured TD (mm)" value={tdMm} min={0.2} max={12} step={0.1} onChange={setTdMm} />}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <div style={{ display: 'flex', gap: 8 }}>
            {step > 0 && <Button variant="subtle" onClick={() => setStep(step - 1)}>Back</Button>}
            {step < 2 ? (
              <Button onClick={() => setStep(step + 1)}>Next</Button>
            ) : (
              <Button onClick={() => { onSave(name, brand, colorHex, tdMm); onClose(); setStep(0); }}>Save to library</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
