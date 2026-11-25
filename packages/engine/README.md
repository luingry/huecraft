# @huecraft/engine

Compute engine (runs in a module Web Worker).

```ts
import { EngineClient } from '@huecraft/engine';

const engine = new EngineClient();
await engine.setImage({ width, height, rgba });      // sent once (a copy is transferred)
const preview = await engine.preview(params);        // latest-wins, superseded calls reject with AbortError
const file = await engine.export({ ...params, format: '3mf' });
```

Pure helpers for tests and tools: `runPreview`, `runExport`, `autoDistributeStack`, `formatSwapPlan`.
Benchmark: `pnpm --filter @huecraft/engine bench`.

## 3MF filament swaps

Every 3MF carries `Metadata/custom_gcode_per_layer.xml` (Bambu Studio / OrcaSlicer) and
`Metadata/Prusa_Slicer_custom_gcode_per_print_z.xml` (PrusaSlicer). Bambu Studio and OrcaSlicer only
apply them to project files that carry a complete printer/process configuration, so pass a project
3MF saved by the user's own slicer as `slicerTemplate`: its configuration is copied (layer heights
overridden) and the swaps appear automatically. Use the "pause" command for Bambu printers without
an AMS, and "ams" with one: each distinct filament of the stack gets a slot (1 = bottom) and the
swaps become automatic filament changes, no pause.
