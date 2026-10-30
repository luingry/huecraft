# @huecraft/optics

Layer counting and colour prediction.

## Model

- A column of height H prints the layers whose mid-plane is below H (how slicers slice), clamped to [base, total] layers.
- Each layer hides `1 - exp(-t · ln 20 / TD)` of what is below (≈ 95 % at t = TD, HueForge TD semantics), blended in linear light, starting from the first filament.
- Colours depend only on the layer count, so they are precomputed as LUTs (`buildPrintedLut`, `buildSlicerLut`).

Calibrate against physical prints — see [docs/calibration/td-workflow.md](../../docs/calibration/td-workflow.md).
