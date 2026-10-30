# Acceptance Tests — hueCraft MVP

Behavior-only tests. Implementation must pass without referencing competitor artifacts.

## AT-01 Image import

- Given a 1024×1024 PNG, when imported, then working image is created with correct aspect ratio
- Given a 20 MB JPEG, when imported, then app suggests downscale and does not freeze UI > 2s

## AT-02 LuminanceRelief

- Given grayscale gradient left→right, when LuminanceRelief applied, then height field increases monotonically left→right

## AT-03 ContrastRelief

- Given fixed image, when contrast slider increases, then height dynamic range increases

## AT-04 Filament stack

- Given 3 filaments ordered [A,B,C], when user reorders to [C,A,B], then swap plan and preview update

## AT-05 Optical preview

- Given opaque filament (TD≈0) on top, when preview computed, then lower colors do not visibly bleed through
- Given translucent white (TD high) thin layer over red, when preview computed, then result is pinker than opaque white

## AT-06 Mesh export

- Given height field 100×100, when STL exported, then file is valid binary STL with > 0 triangles
- Given exported STL, when opened in mesh validator, then no NaN vertices

## AT-07 Swap manifest

- Given stack change at layer 10, when manifest generated, then entry exists at layer 10 with correct filament id

## AT-08 Project round-trip

- Given saved project, when reopened, then image hash, stack, mode, and parameters match within epsilon

## AT-09 3MF export

- Given mesh, when 3MF exported, then ZIP contains `3dmodel.model` parseable as XML

## AT-10 TD calibration

- Given user enters TD 4.5 mm from test print, when saved to library, then filament record persists after reload

## AT-11 Offline

- Given no network, when app loaded from cache, then core workbench functions

## Golden preview fixtures

Location: `packages/optics/fixtures/`

| Fixture | Description |
|---------|-------------|
| `stack-opaque-top.png` | Baseline for opacity |
| `stack-translucent-blend.png` | Known blend case |
| `gradient-luminance.png` | Relief monotonicity |

Pixel tolerance: ΔE < 8 vs stored golden for optics fixtures (CIE76 on sRGB converted samples).

## Physical validation (manual)

| Print | Pass criteria |
|-------|---------------|
| 4-swatch TD ladder | Measured TD within ±0.5 mm of library |
| Portrait 0.08 mm layers | Visual match rated ≥ 4/5 vs preview |
