import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

export const IDENTITY: ViewTransform = { scale: 1, x: 0, y: 0 };

/**
 * Fit-to-box image area with wheel zoom (towards the cursor), drag pan and
 * double-click reset. Reports the hovered pixel in content coordinates.
 */
export function ImageViewport({
  aspect,
  view,
  onView,
  onHover,
  children,
}: {
  /** Content width / height. */
  aspect: number;
  view: ViewTransform;
  onView: (v: ViewTransform) => void;
  /** Normalised [0,1] content position under the pointer, or null when outside. */
  onHover?: (p: { u: number; v: number } | null) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const pad = 24;
  const availW = Math.max(1, box.w - pad * 2);
  const availH = Math.max(1, box.h - pad * 2);
  const fitW = Math.min(availW, availH * aspect);
  const fitH = fitW / aspect;
  const left = (box.w - fitW) / 2;
  const top = (box.h - fitH) / 2;

  useEffect(() => {
    const el = ref.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const rect = el.getBoundingClientRect();
      // Cursor relative to the untransformed content origin.
      const cx = e.clientX - rect.left - left;
      const cy = e.clientY - rect.top - top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const scale = Math.min(16, Math.max(1, v.scale * factor));
      const k = scale / v.scale;
      const x = cx - (cx - v.x) * k;
      const y = cy - (cy - v.y) * k;
      onView(scale === 1 ? IDENTITY : { scale, x, y });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [left, top, onView]);

  const toContent = (clientX: number, clientY: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const u = (clientX - rect.left - left - view.x) / (fitW * view.scale);
    const v = (clientY - rect.top - top - view.y) / (fitH * view.scale);
    return u >= 0 && u < 1 && v >= 0 && v < 1 ? { u, v } : null;
  };

  return (
    <div
      ref={ref}
      className="wb-viewport"
      data-zoomed={view.scale > 1}
      onPointerDown={(e) => {
        if (e.button !== 0 || view.scale === 1) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
      }}
      onPointerMove={(e) => {
        if (drag.current) {
          onView({ ...view, x: drag.current.vx + e.clientX - drag.current.x, y: drag.current.vy + e.clientY - drag.current.y });
        }
        onHover?.(toContent(e.clientX, e.clientY));
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerLeave={() => onHover?.(null)}
      onDoubleClick={() => onView(IDENTITY)}
    >
      <div
        className="wb-viewport__content"
        style={{
          left,
          top,
          width: fitW,
          height: fitH,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Canvas that shows an RGBA buffer at its native size (scaled by CSS). */
export function RgbaCanvas({
  rgba,
  width,
  height,
  pixelated,
}: {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  pixelated?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  }, [rgba, width, height]);
  return <canvas ref={ref} className="wb-canvas" data-pixelated={pixelated} />;
}

export function BitmapCanvas({ bitmap }: { bitmap: ImageBitmap }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  }, [bitmap]);
  return <canvas ref={ref} className="wb-canvas" />;
}
