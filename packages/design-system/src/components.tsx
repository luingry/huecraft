import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from 'react';

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function Button({
  variant = 'default',
  size,
  block,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost';
  size?: 'sm';
  block?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cx(
        'hc-btn',
        variant !== 'default' && `hc-btn--${variant}`,
        size && `hc-btn--${size}`,
        block && 'hc-btn--block',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function IconButton({
  label,
  danger,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx('hc-icon-btn', danger && 'hc-icon-btn--danger', className)}
      {...props}
    >
      {children}
    </button>
  );
}

function decimalsOf(step: number): number {
  const s = String(step);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

export function NumberField({
  value,
  min,
  max,
  step,
  unit,
  decimals,
  onChange,
  ariaLabel,
}: {
  value: number;
  min?: number;
  max?: number;
  step: number;
  unit?: string;
  decimals?: number;
  onChange: (v: number) => void;
  ariaLabel?: string;
}) {
  const places = decimals ?? decimalsOf(step);
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value.toFixed(places);

  const commit = (raw: string) => {
    setDraft(null);
    const v = Number(raw.replace(',', '.'));
    if (!Number.isFinite(v)) return;
    let next = v;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    if (next !== value) onChange(next);
  };

  return (
    <label className="hc-num">
      <input
        inputMode="decimal"
        aria-label={ariaLabel}
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(null);
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const dir = e.key === 'ArrowUp' ? 1 : -1;
            const mult = e.shiftKey ? 10 : 1;
            let next = Number((value + dir * step * mult).toFixed(places));
            if (min !== undefined) next = Math.max(min, next);
            if (max !== undefined) next = Math.min(max, next);
            setDraft(null);
            onChange(next);
          }
        }}
      />
      {unit && <span>{unit}</span>}
    </label>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  hint,
  inputMin,
  inputMax,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  hint?: ReactNode;
  /** Bounds for typed values when they may exceed the slider range. */
  inputMin?: number;
  inputMax?: number;
  onChange: (v: number) => void;
}) {
  const pct = ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100;
  return (
    <div className="hc-field">
      <div className="hc-field__head">
        <span className="hc-field__label">{label}</span>
        <NumberField
          value={value}
          min={inputMin ?? min}
          max={inputMax ?? max}
          step={step}
          unit={unit}
          onChange={onChange}
          ariaLabel={label}
        />
      </div>
      <input
        className="hc-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, value))}
        aria-label={label}
        style={{ '--pct': `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <span className="hc-field__hint">{hint}</span>}
    </div>
  );
}

export function Switch({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: ReactNode;
}) {
  return (
    <div className="hc-field">
      <label className="hc-switch">
        <span className="hc-field__label">{label}</span>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="hc-switch__track" aria-hidden />
      </label>
      {hint && <span className="hc-field__hint">{hint}</span>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="hc-seg" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="hc-seg__item"
          aria-pressed={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Section({
  step,
  title,
  actions,
  children,
}: {
  step?: number;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="hc-section">
      <header className="hc-section__head">
        {step !== undefined && <span className="hc-section__step">{step}</span>}
        <h2 className="hc-section__title">{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function Subgroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="hc-subgroup">
      <span className="hc-subgroup__title">{title}</span>
      {children}
    </div>
  );
}

/** Dropdown menu anchored to its trigger. Closes on outside click, Escape or item click. */
export function Menu({
  trigger,
  align = 'right',
  children,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  align?: 'left' | 'right';
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="hc-menu-anchor" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div className={cx('hc-menu', `hc-menu--${align}`)} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  hint,
  onClick,
}: {
  icon?: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" role="menuitem" className="hc-menu__item" onClick={onClick}>
      {icon}
      <span style={{ flex: 1 }}>
        {children}
        {hint && <small>{hint}</small>}
      </span>
    </button>
  );
}

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  footer,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="hc-modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="hc-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="hc-modal__head">
          <h2 className="hc-modal__title">{title}</h2>
          {subtitle && <p className="hc-modal__sub">{subtitle}</p>}
        </div>
        <div className="hc-modal__body">{children}</div>
        {footer && <div className="hc-modal__foot">{footer}</div>}
      </div>
    </div>
  );
}
