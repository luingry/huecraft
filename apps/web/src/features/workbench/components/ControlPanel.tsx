import { useEffect, useState } from 'react';
import { baseLayerCount } from '@huecraft/project-schema';
import { Button, Section, Slider, Subgroup, Switch } from '@huecraft/design-system';
import { formatMm, t } from '../../../i18n';
import type { Workbench } from '../useWorkbench';
import { StackEditor } from './StackEditor';

export function ControlPanel({ wb, onPickImage }: { wb: Workbench; onPickImage: () => void }) {
  const advanced = wb.profile === 'advanced';
  const { relief, print } = wb.project;
  const aspect = wb.image ? wb.image.source.height / wb.image.source.width : null;
  // Auto-tune can set brightness / gamma: once they leave their defaults keep
  // their sliders on screen (also in the simple profile) so the result can be
  // edited from where it landed, even when dragged back to the default.
  const toneSet = relief.brightness !== 0 || relief.gamma !== 1;
  const [showTone, setShowTone] = useState(toneSet);
  useEffect(() => {
    if (toneSet) setShowTone(true);
  }, [toneSet]);
  const toneSliders = (
    <>
      <Slider
        label={t.image.brightness}
        value={relief.brightness}
        min={-0.5}
        max={0.5}
        step={0.01}
        onChange={(brightness) => wb.updateRelief({ brightness })}
      />
      <Slider
        label={t.image.gamma}
        value={relief.gamma}
        min={0.4}
        max={2.5}
        step={0.05}
        onChange={(gamma) => wb.updateRelief({ gamma })}
      />
    </>
  );

  return (
    <aside className="wb-controls">
      <Section step={1} title={t.image.title}>
        {wb.image && (
          <div className="wb-image-row">
            <img src={wb.image.thumbnail} alt="" />
            <div>
              <div className="wb-image-row__name">{wb.project.name}</div>
              <div className="hc-faint">
                {wb.image.source.width} × {wb.image.source.height} px
              </div>
            </div>
            <Button size="sm" onClick={onPickImage}>
              {t.image.replace}
            </Button>
          </div>
        )}
        {wb.image && (
          <Button size="sm" variant="ghost" block onClick={wb.openColorPresets}>
            {t.image.colorReading}
          </Button>
        )}
        <Slider
          label={t.image.contrast}
          value={relief.contrast}
          min={0.3}
          max={3}
          step={0.05}
          onChange={(contrast) => wb.updateRelief({ contrast })}
        />
        <Slider
          label={t.image.colorMatch}
          value={relief.colorMatch ?? 0}
          min={0}
          max={1}
          step={0.05}
          hint={(relief.colorMatch ?? 0) > 0 ? t.image.colorMatchHint : t.image.colorMatchOff}
          onChange={(colorMatch) => wb.updateRelief({ colorMatch })}
        />
        <Switch
          label={t.image.invert}
          hint={relief.invert ? t.image.invertHint : undefined}
          checked={relief.invert}
          onChange={(invert) => wb.updateRelief({ invert })}
        />
        {!advanced && showTone && toneSliders}
        {advanced && (
          <Subgroup title={t.image.advanced}>
            {toneSliders}
            <Slider
              label={t.image.smoothing}
              value={relief.smoothing}
              min={0}
              max={6}
              step={1}
              unit="px"
              onChange={(smoothing) => wb.updateRelief({ smoothing })}
            />
            <Slider
              label={t.image.posterize}
              value={relief.posterize}
              min={0}
              max={16}
              step={1}
              hint={t.image.posterizeHint}
              onChange={(posterize) => wb.updateRelief({ posterize: posterize === 1 ? 0 : posterize })}
            />
          </Subgroup>
        )}
      </Section>

      <Section step={2} title={t.size.title}>
        <Slider
          label={t.size.width}
          value={print.widthMm}
          min={20}
          max={300}
          step={1}
          inputMin={5}
          inputMax={500}
          unit="mm"
          hint={aspect !== null ? `${t.size.height}: ${formatMm(print.widthMm * aspect)} mm` : undefined}
          onChange={(widthMm) => wb.updatePrint({ widthMm })}
        />
        <Slider
          label={t.size.maxHeight}
          value={print.maxHeightMm}
          min={0.8}
          max={6}
          step={0.08}
          inputMin={0.4}
          inputMax={20}
          unit="mm"
          hint={t.size.maxHeightHint(wb.totalLayers)}
          onChange={(maxHeightMm) => wb.updatePrint({ maxHeightMm })}
        />
        {advanced && (
          <Subgroup title={t.size.printer}>
            <Slider
              label={t.size.layerHeight}
              value={print.layerHeightMm}
              min={0.04}
              max={0.28}
              step={0.01}
              unit="mm"
              onChange={(layerHeightMm) => wb.updatePrint({ layerHeightMm })}
            />
            <Slider
              label={t.size.firstLayer}
              value={print.firstLayerHeightMm}
              min={0.08}
              max={0.32}
              step={0.01}
              unit="mm"
              onChange={(firstLayerHeightMm) => wb.updatePrint({ firstLayerHeightMm })}
            />
            <Slider
              label={t.size.base}
              value={print.baseThicknessMm}
              min={0.08}
              max={2}
              step={0.04}
              unit="mm"
              hint={t.size.baseHint(baseLayerCount(print))}
              onChange={(baseThicknessMm) => wb.updatePrint({ baseThicknessMm })}
            />
            <Slider
              label={t.size.lineWidth}
              value={print.lineWidthMm}
              min={0.2}
              max={0.8}
              step={0.01}
              unit="mm"
              onChange={(lineWidthMm) => wb.updatePrint({ lineWidthMm })}
            />
            <Slider
              label={t.size.exportResolution}
              value={print.exportResolutionMm}
              min={0.05}
              max={0.4}
              step={0.01}
              unit="mm"
              hint={t.size.exportResolutionHint}
              onChange={(exportResolutionMm) => wb.updatePrint({ exportResolutionMm })}
            />
            <Switch
              label={t.size.snap}
              hint={t.size.snapHint}
              checked={print.snapToLayers}
              onChange={(snapToLayers) => wb.updatePrint({ snapToLayers })}
            />
            <Button size="sm" onClick={wb.savePrinterDefaults}>
              {t.size.saveDefaults}
            </Button>
          </Subgroup>
        )}
      </Section>

      <StackEditor wb={wb} advanced={advanced} />
    </aside>
  );
}
