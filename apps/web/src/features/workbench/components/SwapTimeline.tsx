import type { SwapManifest } from '@huecraft/exporters';
import { Panel, tokens } from '@huecraft/design-system';

export function SwapTimeline({
  manifest,
  layerHeightMm,
  selectedLayer,
  onSelectLayer,
}: {
  manifest: SwapManifest | null;
  layerHeightMm: number;
  selectedLayer: number | null;
  onSelectLayer: (layer: number) => void;
}) {
  const swaps = manifest?.swaps ?? [];
  const maxLayer = swaps.length ? swaps[swaps.length - 1].layer + 4 : 20;

  return (
    <Panel title="Layer Swaps" style={{ height: 120, flexShrink: 0 }}>
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, overflowX: 'auto' }}>
        <div
          style={{
            flex: 1,
            height: 8,
            background: tokens.color.surfaceRaised,
            borderRadius: 4,
            position: 'relative',
            minWidth: 200,
          }}
        >
          {Array.from({ length: maxLayer }, (_, layer) => {
            const swap = swaps.find((s) => s.layer === layer);
            const isSwap = !!swap;
            return (
              <button
                key={layer}
                type="button"
                title={swap ? `Layer ${layer}: ${swap.filamentName}` : `Layer ${layer}`}
                onClick={() => onSelectLayer(layer)}
                style={{
                  position: 'absolute',
                  left: `${(layer / maxLayer) * 100}%`,
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: isSwap ? 14 : 6,
                  height: isSwap ? 14 : 6,
                  borderRadius: '50%',
                  border: isSwap ? `2px solid ${tokens.color.accent}` : `1px solid ${tokens.color.border}`,
                  background: selectedLayer === layer ? tokens.color.accent : isSwap ? tokens.color.surface : tokens.color.border,
                  padding: 0,
                  cursor: 'pointer',
                  transition: `transform ${tokens.motion.fast}`,
                }}
              />
            );
          })}
        </div>
        <div style={{ fontSize: 11, fontFamily: tokens.font.mono, color: tokens.color.textMuted, whiteSpace: 'nowrap' }}>
          {swaps.length} swaps · {layerHeightMm} mm/layer
        </div>
      </div>
    </Panel>
  );
}
