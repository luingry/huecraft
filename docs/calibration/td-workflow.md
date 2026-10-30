# TD Calibration Workflow

## Goal

Estimate Transmission Distance (mm) for a filament so optical preview matches physical prints.

## Methods

### M1 — Manual estimate

1. User prints known two-layer test (base opaque + sample on top)
2. Compare appearance to reference ladder in app
3. Enter TD value; mark source `manual-ladder`

### M2 — Thickness sweep

1. Print stepped thicknesses of sample over white base
2. Measure mm where sample appears fully opaque
3. Enter TD; mark source `thickness-sweep`

### M3 — TD device (phase 2)

- WebSerial import — not MVP

## In-app assistant steps

1. Select filament or create new
2. Choose method M1 or M2
3. Show reference images (hueCraft-owned diagrams)
4. Input TD + optional photo of test print
5. Save to library with `calibratedAt` timestamp

## Validation

- Re-print single swatch; compare ΔE vs preview < 10
- Log calibration in filament `metadata.calibrationHistory[]`

## Golden tests

See `packages/optics/src/calibration.test.ts` for numeric TD→opacity curve monotonicity.
