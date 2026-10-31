import { Button } from '@huecraft/design-system';
import { t } from '../../../i18n';
import type { Workbench } from '../useWorkbench';

/**
 * Colour readings of the image, shown after it is opened. Non-modal: picking a
 * card applies it right away so the preview behind shows the result.
 */
export function ColorPresetPicker({ wb }: { wb: Workbench }) {
  if (!wb.colorPresetsOpen || !wb.colorPresets) return null;
  return (
    <div className="wb-presets" role="dialog" aria-label={t.colorPresets.title}>
      <div className="wb-presets__head">
        <div>
          <div className="wb-presets__title">{t.colorPresets.title}</div>
          <div className="hc-faint">{t.colorPresets.hint}</div>
        </div>
        <Button size="sm" variant="primary" onClick={wb.closeColorPresets}>
          {t.colorPresets.done}
        </Button>
      </div>
      <div className="wb-presets__cards">
        {wb.colorPresets.map(({ preset, picks }) => {
          const matched = picks.filter((p) => p.fromLibrary).length;
          return (
            <button
              key={preset.id}
              type="button"
              className="wb-presets__card"
              aria-pressed={wb.colorPresetId === preset.id}
              disabled={picks.length === 0}
              onClick={() => wb.applyColorPreset(preset.id)}
            >
              <span className="wb-presets__name">{t.colorPresets.names[preset.id]}</span>
              <span className="wb-presets__swatches">
                {picks.map((p) => (
                  <span
                    key={p.filament.libraryId ?? p.filament.colorHex}
                    className="wb-presets__swatch"
                    data-new={!p.fromLibrary}
                    style={{ background: p.filament.colorHex }}
                    title={p.filament.name}
                  />
                ))}
              </span>
              <span className="wb-presets__desc">{t.colorPresets.descriptions[preset.id]}</span>
              <span className="hc-faint">{t.colorPresets.summary(matched, picks.length - matched)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
