/**
 * hueCraft design tokens.
 *
 * Surfaces are neutral graphite on purpose: a colour-prediction tool must not
 * tint the perception of the preview. The accent is reserved for the primary
 * action and active states.
 */
export const tokens = {
  color: {
    bg: '#141414',
    surface: '#1b1b1b',
    raised: '#232323',
    hover: '#2b2b2b',
    line: 'rgba(255,255,255,0.07)',
    lineStrong: 'rgba(255,255,255,0.13)',
    text: '#ececec',
    text2: '#a3a3a3',
    text3: '#6e6e6e',
    accent: '#d9643f',
    accentHover: '#e57350',
    accentSoft: 'rgba(217,100,63,0.16)',
    danger: '#e5484d',
    stageDark: '#1e1e1e',
    stageMid: '#767676',
    stageLight: '#e8e8e8',
  },
  font: {
    sans: "'DM Sans', system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
  },
  size: { caption: 12, body: 13, title: 15, display: 20 },
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24 },
  radius: { sm: '6px', md: '8px', lg: '12px' },
  motion: {
    fast: '120ms cubic-bezier(0.2, 0, 0, 1)',
    panel: '180ms cubic-bezier(0.2, 0, 0, 1)',
  },
} as const;
