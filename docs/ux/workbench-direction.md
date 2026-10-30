# Workbench UX Direction

## Identity

**hueCraft** — professional maker workbench. Not a marketing landing page, not a generic AI dashboard.

## Layout — Bench Mode

```
┌─────────────────────────────────────────────────────────────┐
│  App bar: project name · save · export · settings           │
├──────────┬──────────────────────────────┬───────────────────┤
│ Stack    │  Preview stage (2-up)        │  Properties       │
│ panel    │  [ Predicted ] [ Geometry ]  │  mode · scale     │
│          │                              │  layer height     │
├──────────┴──────────────────────────────┴───────────────────┤
│  Swap timeline (layer scrubber + filament chips)            │
└─────────────────────────────────────────────────────────────┘
```

## Visual language

- **Type**: DM Sans (UI) + JetBrains Mono (numeric/layers)
- **Surface**: warm neutral `#1a1917` base, `#252422` panels, `#f5f0e8` text primary
- **Accent**: terracotta `#c45c3e` — used sparingly for primary actions
- **Radius**: 6px panels, 4px controls
- **Shadow**: single-layer `0 1px 0 rgba(255,255,255,0.04) inset` — no heavy drop shadows

## Motion

- Panel collapse: 180ms `cubic-bezier(0.2, 0, 0, 1)`
- Slider value commit: 120ms opacity pulse on preview badge
- No parallax, no bounce, no staggered card entrances

## Interaction patterns

- Drag-drop image on preview stage
- Filament stack: drag reorder with 2px lift shadow
- Double-click filament chip → edit TD/color
- Keyboard: `Ctrl+S` save, `Ctrl+E` export, `Space` toggle preview mode

## Empty states

- Centered illustration-free: monospace hint + single CTA "Import image"
- No stock 3D printer clipart

## Accessibility

- WCAG AA contrast on text
- Focus rings visible on dark theme
- Timeline keyboard navigable

## Anti-patterns (banned)

- Purple gradients on white
- Oversized hero padding in tool surface
- Generic "card grid" settings
- Copied competitor slider layout (color chips in identical positions)
