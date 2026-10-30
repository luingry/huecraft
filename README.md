# hueCraft

Local-first web workbench for **filament painting**: turn a 2D image into a layered FDM print whose colours come from filament swaps at fixed layers, with a preview that matches what the slicer will produce.

## Features

- Image → relief, with physical size in mm (independent of preview resolution)
- **Global layer stack**: each filament starts at a fixed layer for the whole print, exactly like a pause / colour change in the slicer
- Two previews:
  - **Printed**: predicted appearance using filament TD (light blending in linear space)
  - **Slicer**: opaque top-layer colours, layer-quantised (mid-layer slicing) and limited by the nozzle line width, matching the Bambu Studio / OrcaSlicer preview
- Terraced 3D view with a layer scrubber
- **3MF export with the filament swaps embedded** (opens in Bambu Studio / OrcaSlicer with the pauses already set), plus STL and a text swap plan
- Basic / Advanced profiles: Basic shows only what changes per image; printer settings live in Advanced and can be saved as defaults
- Autosave, recent projects, undo/redo
- Everything runs in the browser (Web Worker); nothing is uploaded

## Quick start

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173 — Chrome or Edge desktop recommended.

### Shortcuts

| Keys | Action |
|------|--------|
| `Ctrl+O` | Open image |
| `Ctrl+E` | Export 3MF |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `1`–`5` | Printed, Slicer, 3D, Original, Compare |

## Monorepo

| Path | Role |
|------|------|
| `apps/web` | React workbench UI |
| `packages/engine` | Worker client, preview + export pipeline |
| `packages/image-core` | Image → height field |
| `packages/optics` | TD colour model, layer LUTs |
| `packages/mesh` | Terraced preview mesh, watertight export mesh |
| `packages/exporters` | STL, 3MF (+ slicer swap metadata) |
| `packages/filament-db` | Filament library |
| `packages/project-schema` | `.hcproj` schema (v2, global layer stack) |
| `packages/design-system` | Tokens, theme and primitives |

## Legal

Independent implementation. See [docs/legal/clean-room.md](docs/legal/clean-room.md).

## License

MIT
