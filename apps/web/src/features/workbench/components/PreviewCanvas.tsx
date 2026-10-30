import { useEffect, useRef } from 'react';
import { tokens } from '@huecraft/design-system';

export function PreviewCanvas({
  rgba,
  width,
  height,
  label,
  dimmed = false,
}: {
  rgba: Uint8ClampedArray | null;
  width: number;
  height: number;
  label: string;
  dimmed?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !rgba) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
    ctx.putImageData(imageData, 0, 0);
  }, [rgba, width, height]);

  return (
    <div
      style={{
        position: 'relative',
        flex: 1,
        minWidth: 0,
        opacity: dimmed ? 0.55 : 1,
        transition: `opacity ${tokens.motion.fast}`,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          zIndex: 1,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: tokens.color.textMuted,
          background: 'rgba(26,25,23,0.75)',
          padding: '4px 8px',
          borderRadius: tokens.radius.sm,
        }}
      >
        {label}
      </span>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          borderRadius: tokens.radius.md,
          background: tokens.color.surfaceRaised,
          objectFit: 'contain',
        }}
      />
    </div>
  );
}
