export const tokens = {
  color: {
    bg: '#1a1917',
    surface: '#252422',
    surfaceRaised: '#2e2c29',
    border: '#3d3a36',
    text: '#f5f0e8',
    textMuted: '#a39e94',
    accent: '#c45c3e',
    accentHover: '#d46a4c',
    success: '#5a8f6a',
  },
  font: {
    sans: "'DM Sans', system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
  },
  radius: {
    sm: '4px',
    md: '6px',
  },
  motion: {
    fast: '120ms cubic-bezier(0.2, 0, 0, 1)',
    panel: '180ms cubic-bezier(0.2, 0, 0, 1)',
  },
} as const;

export const spinnerKeyframes = `@keyframes huecraft-spin { to { transform: rotate(360deg); } }`;

export const globalStyles = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&family=JetBrains+Mono:wght@400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; }
  html, body, #root { height: 100%; margin: 0; }
  body {
    font-family: ${tokens.font.sans};
    background: ${tokens.color.bg};
    color: ${tokens.color.text};
    -webkit-font-smoothing: antialiased;
  }
  button { font-family: inherit; cursor: pointer; }
  input, select { font-family: inherit; }
`;
