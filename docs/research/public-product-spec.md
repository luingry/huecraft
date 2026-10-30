# Public Functional Specification — Filament Painting Workbench

Abstract requirements derived from **publicly described behavior** of filament-painting tools. No competitor code, UI, or proprietary schemas referenced.

## Problem

FDM printers can produce multi-color images by stacking thin layers of translucent filament and swapping material at specific layer heights. Predicting the final appearance is hard because:

- Filament translucency varies by pigment, brand, and batch
- Layer order and thickness filter light non-linearly
- Slicer previews typically show pigment color, not transmitted/blended color

## Users

- Makers printing photo-like plaques, keychains, coasters, art pieces
- Users with manual swap, AMS/MMU, or tool-changer setups
- Users who own a slicer (Orca, Prusa, Bambu, Cura, etc.)

## Core capabilities (MVP)

### C1 — Image import

- Accept raster images: PNG, JPEG, WebP
- Normalize to working resolution with user-controlled downscale presets
- Preserve aspect ratio

### C2 — Relief interpretation modes

| Mode | Behavior |
|------|----------|
| LuminanceRelief | Map perceived brightness to height |
| ContrastRelief | Luminance with adjustable contrast curve |
| PaletteRegionRelief | Segment image by palette proximity |
| ReferenceColorRelief | Map reference colors to height bands |

### C3 — Filament library

- Store filaments: name, brand, color (hex + Lab), TD (mm), notes
- Built-in starter set (hueCraft-owned measurements / placeholders)
- User CRUD + import/export JSON

### C4 — Stack editor

- Ordered list of filaments bottom → top
- Per-layer thickness (default 0.08 mm)
- Reorder, add, remove, duplicate

### C5 — Optical preview

- Given stack + relief field, predict **print appearance** (2D)
- Toggle geometry-only view vs predicted appearance
- Update within interactive budget on desktop (see performance budget)

### C6 — Mesh generation

- Height field → watertight manifold mesh
- User controls: base thickness, max height, XY scale (mm per pixel)

### C7 — Swap plan

- Emit layer index / Z height where filament changes
- Minimize swap count where possible (heuristic, not guaranteed optimal)

### C8 — Export

- Binary STL
- Basic 3MF (core mesh)
- Swap manifest JSON + human-readable summary

### C9 — Project persistence

- Save/open project locally (no required server)
- Versioned schema

### C10 — TD calibration assistant

- Guided workflow to estimate TD from test print or manual measurement
- Store result in user library

## Non-goals (MVP)

- Slicing or G-code generation
- Automatic AMS purge tower tuning
- Hardware TD sensor integration
- Flat/double-sided, nesting, multi-plate tiling (phase 2)

## External dependencies (user-provided)

- FDM printer with layer pause or auto swap
- Slicer supporting layer-based filament changes
- Filament TD values (library or calibrated)

## Quality attributes

- **Local-first**: image and project data stay on device by default
- **Responsive**: slider edits feel immediate via progressive preview
- **Predictable export**: STL opens in common slicers without repair

## Open standards

- STL binary (de facto)
- 3MF core 1.3+ (ISO/IEC 25422)
- sRGB for display; CIE Lab for perceptual color math
