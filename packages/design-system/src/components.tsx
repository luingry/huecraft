import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { tokens } from './tokens.js';

const base: CSSProperties = {
  fontFamily: tokens.font.sans,
  fontSize: 13,
  fontWeight: 500,
  borderRadius: tokens.radius.sm,
  border: 'none',
  padding: '8px 14px',
  transition: `background ${tokens.motion.fast}, transform ${tokens.motion.fast}`,
};

export function Button({
  variant = 'primary',
  children,
  style,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'subtle';
  children: ReactNode;
}) {
  const variants: Record<string, CSSProperties> = {
    primary: { background: tokens.color.accent, color: '#fff' },
    ghost: { background: 'transparent', color: tokens.color.text, border: `1px solid ${tokens.color.border}` },
    subtle: { background: tokens.color.surfaceRaised, color: tokens.color.text },
  };
  return (
    <button
      type="button"
      style={{ ...base, ...variants[variant], ...style }}
      onMouseEnter={(e) => {
        if (variant === 'primary') e.currentTarget.style.background = tokens.color.accentHover;
      }}
      onMouseLeave={(e) => {
        if (variant === 'primary') e.currentTarget.style.background = tokens.color.accent;
      }}
      {...props}
    >
      {children}
    </button>
  );
}

export function Panel({
  children,
  title,
  style,
}: {
  children: ReactNode;
  title?: string;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        background: tokens.color.surface,
        borderRadius: tokens.radius.md,
        border: `1px solid ${tokens.color.border}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        ...style,
      }}
    >
      {title && (
        <header
          style={{
            padding: '10px 12px',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: tokens.color.textMuted,
            borderBottom: `1px solid ${tokens.color.border}`,
          }}
        >
          {title}
        </header>
      )}
      <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>
    </section>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, color: tokens.color.textMuted }}>
        <span>{label}</span>
        <span style={{ fontFamily: tokens.font.mono }}>{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: tokens.color.accent }}
      />
    </label>
  );
}

export { tokens };
