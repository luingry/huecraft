import { tokens } from './tokens.js';

const c = tokens.color;

/** Global stylesheet: CSS variables, base elements and primitive component classes. */
export const globalStyles = `
:root {
  --bg: ${c.bg};
  --surface: ${c.surface};
  --raised: ${c.raised};
  --hover: ${c.hover};
  --line: ${c.line};
  --line-strong: ${c.lineStrong};
  --text: ${c.text};
  --text-2: ${c.text2};
  --text-3: ${c.text3};
  --accent: ${c.accent};
  --accent-hover: ${c.accentHover};
  --accent-soft: ${c.accentSoft};
  --danger: ${c.danger};
  --stage-dark: ${c.stageDark};
  --stage-mid: ${c.stageMid};
  --stage-light: ${c.stageLight};
  --font: ${tokens.font.sans};
  --mono: ${tokens.font.mono};
  --r-sm: ${tokens.radius.sm};
  --r-md: ${tokens.radius.md};
  --r-lg: ${tokens.radius.lg};
  --ease: cubic-bezier(0.2, 0, 0, 1);
  --fast: 120ms var(--ease);
  --panel: 180ms var(--ease);
  --focus: 0 0 0 2px var(--bg), 0 0 0 4px rgba(217,100,63,0.55);
  color-scheme: dark;
}

*, *::before, *::after { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body {
  font-family: var(--font);
  font-size: 13px;
  line-height: 1.45;
  background: var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
}
button, input, select, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
:focus { outline: none; }
:focus-visible { box-shadow: var(--focus); }
::selection { background: var(--accent-soft); }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 10px; border: 3px solid transparent; background-clip: content-box; }
::-webkit-scrollbar-thumb:hover { background-color: rgba(255,255,255,0.16); }

@keyframes hc-spin { to { transform: rotate(360deg); } }
@keyframes hc-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes hc-pop-in { from { opacity: 0; transform: translateY(-4px) scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes hc-progress { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }

/* Buttons */
.hc-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 32px; padding: 0 12px; border: 0; border-radius: var(--r-sm);
  font-size: 13px; font-weight: 500; white-space: nowrap;
  background: var(--raised); color: var(--text);
  transition: background var(--fast), color var(--fast), opacity var(--fast), transform var(--fast);
}
.hc-btn:hover:not(:disabled) { background: var(--hover); }
.hc-btn:active:not(:disabled) { transform: translateY(1px); }
.hc-btn:disabled { opacity: 0.4; cursor: default; }
.hc-btn--primary { background: var(--accent); color: #fff; }
.hc-btn--primary:hover:not(:disabled) { background: var(--accent-hover); }
.hc-btn--ghost { background: transparent; color: var(--text-2); }
.hc-btn--ghost:hover:not(:disabled) { background: var(--raised); color: var(--text); }
.hc-btn--sm { height: 26px; padding: 0 8px; font-size: 12px; }
.hc-btn--block { width: 100%; }
.hc-btn svg { flex-shrink: 0; }

.hc-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border: 0; border-radius: var(--r-sm);
  background: transparent; color: var(--text-2);
  transition: background var(--fast), color var(--fast), opacity var(--fast);
}
.hc-icon-btn:hover:not(:disabled) { background: var(--raised); color: var(--text); }
.hc-icon-btn:disabled { opacity: 0.3; cursor: default; }
.hc-icon-btn--danger:hover:not(:disabled) { color: var(--danger); }
.hc-icon-btn[aria-pressed="true"] { background: var(--raised); color: var(--text); }

/* Split button */
.hc-split { display: inline-flex; }
.hc-split > .hc-btn:first-child { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.hc-split > .hc-btn:last-child { border-top-left-radius: 0; border-bottom-left-radius: 0; padding: 0 8px; box-shadow: inset 1px 0 0 rgba(0,0,0,0.18); }

/* Segmented control */
.hc-seg { display: inline-flex; padding: 2px; gap: 2px; background: var(--surface); border-radius: var(--r-sm); box-shadow: inset 0 0 0 1px var(--line); }
.hc-seg__item {
  height: 26px; padding: 0 10px; border: 0; border-radius: 4px; background: transparent;
  color: var(--text-2); font-size: 12px; font-weight: 500; white-space: nowrap;
  display: inline-flex; align-items: center; gap: 6px;
  transition: background var(--fast), color var(--fast);
}
.hc-seg__item:hover { color: var(--text); }
.hc-seg__item[aria-pressed="true"] { background: var(--hover); color: var(--text); }

/* Fields */
.hc-field { display: flex; flex-direction: column; gap: 6px; }
.hc-field__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 22px; }
.hc-field__label { color: var(--text-2); font-size: 12px; }
.hc-field__hint { color: var(--text-3); font-size: 12px; }
.hc-input {
  height: 32px; width: 100%; padding: 0 10px; border: 0; border-radius: var(--r-sm);
  background: var(--raised); color: var(--text); box-shadow: inset 0 0 0 1px transparent;
  transition: box-shadow var(--fast), background var(--fast);
}
.hc-input:hover { background: var(--hover); }
.hc-input:focus-visible { box-shadow: inset 0 0 0 1px var(--accent); }

.hc-num {
  display: inline-flex; align-items: center; height: 24px; border-radius: 5px;
  background: var(--raised); padding: 0 6px 0 2px;
  transition: background var(--fast), box-shadow var(--fast);
}
.hc-num:hover { background: var(--hover); }
.hc-num:focus-within { box-shadow: inset 0 0 0 1px var(--accent); }
.hc-num input {
  width: 52px; height: 24px; border: 0; background: transparent; text-align: right;
  font-size: 12px; font-variant-numeric: tabular-nums; padding: 0 2px;
}
.hc-num input:focus-visible { box-shadow: none; }
.hc-num span { color: var(--text-3); font-size: 11px; margin-left: 2px; }

/* Range slider */
.hc-range {
  --pct: 50%;
  -webkit-appearance: none; appearance: none; width: 100%; height: 18px; margin: 0;
  background: transparent; cursor: pointer;
}
.hc-range::-webkit-slider-runnable-track {
  height: 4px; border-radius: 4px;
  background: linear-gradient(to right, var(--text-2) var(--pct), var(--hover) var(--pct));
}
.hc-range::-moz-range-track { height: 4px; border-radius: 4px; background: var(--hover); }
.hc-range::-moz-range-progress { height: 4px; border-radius: 4px; background: var(--text-2); }
.hc-range::-webkit-slider-thumb {
  -webkit-appearance: none; width: 14px; height: 14px; margin-top: -5px; border-radius: 50%;
  background: var(--text); border: 0; box-shadow: 0 1px 3px rgba(0,0,0,0.5);
  transition: transform var(--fast);
}
.hc-range::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: var(--text); border: 0; }
.hc-range:hover::-webkit-slider-thumb { transform: scale(1.15); }
.hc-range:active::-webkit-slider-thumb { transform: scale(1.25); }
.hc-range:focus-visible { box-shadow: none; }
.hc-range:focus-visible::-webkit-slider-thumb { box-shadow: var(--focus); }

/* Switch */
.hc-switch { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; min-height: 24px; }
.hc-switch__track {
  position: relative; width: 30px; height: 18px; border-radius: 18px; flex-shrink: 0;
  background: var(--hover); transition: background var(--fast);
}
.hc-switch__track::after {
  content: ''; position: absolute; top: 3px; left: 3px; width: 12px; height: 12px; border-radius: 50%;
  background: var(--text-2); transition: transform var(--fast), background var(--fast);
}
.hc-switch input { position: absolute; opacity: 0; pointer-events: none; }
.hc-switch input:checked + .hc-switch__track { background: var(--accent); }
.hc-switch input:checked + .hc-switch__track::after { transform: translateX(12px); background: #fff; }
.hc-switch input:focus-visible + .hc-switch__track { box-shadow: var(--focus); }

/* Section */
.hc-section { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.hc-section + .hc-section { border-top: 1px solid var(--line); }
.hc-section__head { display: flex; align-items: center; gap: 8px; }
.hc-section__step {
  width: 20px; height: 20px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 600; background: var(--raised); color: var(--text-2); flex-shrink: 0;
}
.hc-section__title { font-size: 13px; font-weight: 600; margin: 0; flex: 1; }
.hc-subgroup {
  display: flex; flex-direction: column; gap: 14px; padding: 12px; border-radius: var(--r-md);
  background: rgba(255,255,255,0.025); box-shadow: inset 0 0 0 1px var(--line);
  animation: hc-fade-in var(--panel);
}
.hc-subgroup__title { font-size: 11px; font-weight: 600; color: var(--text-3); letter-spacing: 0.02em; }

/* Menu */
.hc-menu-anchor { position: relative; display: inline-flex; }
.hc-menu {
  position: absolute; z-index: 50; min-width: 220px; padding: 4px; border-radius: var(--r-md);
  background: #262626; box-shadow: 0 0 0 1px var(--line-strong), 0 12px 32px rgba(0,0,0,0.5);
  animation: hc-pop-in 140ms var(--ease); transform-origin: top right;
}
.hc-menu--right { right: 0; top: calc(100% + 6px); }
.hc-menu--left { left: 0; top: calc(100% + 6px); }
.hc-menu__item {
  display: flex; align-items: center; gap: 10px; width: 100%; min-height: 32px; padding: 6px 10px;
  border: 0; border-radius: 5px; background: transparent; text-align: left; font-size: 13px; color: var(--text);
  transition: background var(--fast);
}
.hc-menu__item:hover, .hc-menu__item:focus-visible { background: var(--hover); box-shadow: none; }
.hc-menu__item small { display: block; color: var(--text-3); font-size: 12px; }
.hc-menu__sep { height: 1px; background: var(--line); margin: 4px 6px; }
.hc-menu__label { padding: 6px 10px 4px; font-size: 11px; color: var(--text-3); font-weight: 600; }

/* Modal */
.hc-modal-backdrop {
  position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.55); animation: hc-fade-in 160ms var(--ease);
}
.hc-modal {
  width: 400px; max-width: calc(100vw - 32px); max-height: calc(100vh - 64px); overflow: auto;
  background: var(--surface); border-radius: var(--r-lg);
  box-shadow: 0 0 0 1px var(--line-strong), 0 24px 64px rgba(0,0,0,0.6);
  animation: hc-pop-in 180ms var(--ease);
}
.hc-modal__head { padding: 18px 20px 4px; }
.hc-modal__title { margin: 0; font-size: 15px; font-weight: 600; }
.hc-modal__sub { margin: 4px 0 0; color: var(--text-2); font-size: 12px; }
.hc-modal__body { padding: 16px 20px; display: flex; flex-direction: column; gap: 14px; }
.hc-modal__foot { padding: 4px 20px 18px; display: flex; justify-content: flex-end; gap: 8px; }

/* Toast */
.hc-toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 120;
  padding: 10px 14px; border-radius: var(--r-md); background: #2a2a2a; font-size: 13px;
  box-shadow: 0 0 0 1px var(--line-strong), 0 12px 32px rgba(0,0,0,0.5);
  animation: hc-pop-in 180ms var(--ease);
}
.hc-toast--error { box-shadow: 0 0 0 1px rgba(229,72,77,0.5), 0 12px 32px rgba(0,0,0,0.5); }

.hc-kbd { font-family: var(--mono); font-size: 11px; color: var(--text-3); }
.hc-muted { color: var(--text-2); }
.hc-faint { color: var(--text-3); }
`;
