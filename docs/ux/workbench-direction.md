# Workbench UX Direction

## Identity

**hueCraft**: a practical maker workbench. One image in, one 3MF out, with as few decisions as possible per generation.

## Layout

```
┌ brand · projects ▾ · project name · saved ······ undo redo [Basic|Advanced] [Export 3MF ▾] ┐
├──────────────────┬──────────────────────────────────────────────────────────────────────┤
│ 1 Image          │ [Printed | Slicer | 3D | Original | Compare]        options · backdrop │
│ 2 Size           │                                                                      │
│ 3 Filaments      │          stage (zoom / pan, hover readout)                           │
│   stack bar +    │                                                                      │
│   rows           ├──────────────────────────────────────────────────────────────────────┤
│                  │ size · layers · swaps                                    layer readout │
└──────────────────┴──────────────────────────────────────────────────────────────────────┘
```

- Controls follow the workflow order (Image → Size → Filaments) in a single column.
- **Basic** shows only per-image parameters: contrast, invert, width, max thickness, filaments and where each starts.
- **Advanced** reveals fine tuning (brightness, gamma, smoothing) and the print profile (layer heights, base, line width, export resolution, snapping, swap command). The print profile can be saved as the default for new projects.
- The filament stack *is* the swap timeline: a vertical layer bar with colour bands, the image's tone histogram and draggable swap handles, next to editable rows.
- One primary action: **Export 3MF**. Other formats live in its menu.

## Visual language

- **Neutral graphite surfaces** (`#141414` / `#1b1b1b` / `#232323`). A colour-prediction tool must not tint perception; no warm or cool cast.
- Stage backdrop selectable: dark, 18 % grey, light.
- **Accent** `#d9643f` only for the primary action, focus rings and active switches.
- Separation by surface elevation and spacing, not borders. At most one hairline (`rgba(255,255,255,0.07)`) between sections.
- **Type**: DM Sans everywhere, tabular numerals; JetBrains Mono only for hex codes and shortcuts. Scale 12 / 13 / 15 / 20 px. Section titles 13 px semibold, sentence case.
- **Spacing** scale 4 / 8 / 12 / 16 / 24; sections padded 16 px.
- Radius 6 px controls, 8 px rows/menus, 12 px stage and modals.

## Motion

- 120 ms `cubic-bezier(0.2, 0, 0, 1)` for hover/press, 180 ms for panels and menus.
- Recomputation never blanks the preview: the previous result stays, a thin progress line runs on top of the stage.

## Interaction patterns

- Drop an image anywhere in the window. A new image becomes a new project that inherits the current settings, and the swaps are auto-distributed over its tones.
- Every numeric control is a slider plus a typed field (arrow keys step, Shift ×10).
- Hover the 2D preview to read layer, Z and filament at that point.
- Keyboard: `Ctrl+O` open, `Ctrl+E` export, `Ctrl+Z`/`Ctrl+Shift+Z` undo/redo, `1`–`5` stage tabs.

## Accessibility

- Visible focus rings on every control.
- WCAG AA contrast for text on all surfaces.
