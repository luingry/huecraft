import { tokens } from '@huecraft/design-system';
import type { LoadingStage } from '../hooks/useEnginePipeline';

const STAGE_LABEL: Record<Exclude<LoadingStage, 'idle'>, string> = {
  decoding: 'Decoding image…',
  computing: 'Building relief preview…',
  exporting: 'Preparing export…',
};

export function LoadingOverlay({ stage }: { stage: LoadingStage }) {
  if (stage === 'idle') return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        background: 'rgba(26, 25, 23, 0.82)',
        backdropFilter: 'blur(4px)',
        borderRadius: tokens.radius.md,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          border: `3px solid ${tokens.color.border}`,
          borderTopColor: tokens.color.accent,
          borderRadius: '50%',
          animation: 'huecraft-spin 0.75s linear infinite',
        }}
      />
      <p
        style={{
          margin: 0,
          fontSize: 13,
          fontWeight: 500,
          color: tokens.color.text,
          fontFamily: tokens.font.mono,
        }}
      >
        {STAGE_LABEL[stage]}
      </p>
    </div>
  );
}
