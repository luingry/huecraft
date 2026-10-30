# Errors and fixes

## Web typecheck reports missing exports from workspace packages

- **Symptom:** `tsc` in `apps/web` says `Module '"@huecraft/engine"' has no exported member …` (or similar for other `@huecraft/*` packages) although the source exports it, while `pnpm dev` works.
- **Cause:** Vite aliases `@huecraft/*` to `packages/*/src`, but TypeScript resolved the packages through `package.json` `types` → stale `dist/*.d.ts`.
- **Fix:** `apps/web/tsconfig.json` maps `"@huecraft/*": ["../../packages/*/src"]` so the typecheck sees the same sources as Vite.

## Bambu Studio CLI crashes (0xC0000005) on a 3MF tagged as BambuStudio

- **Symptom:** `bambu-studio.exe --slice 0 … in.3mf` exits with -1073741819 (access violation in BambuStudio.dll), no output, no log.
- **Cause:** the model has `<metadata name="Application">BambuStudio-…</metadata>` (so it is treated as a Bambu project) but no complete `Metadata/project_settings.config`. A missing or partial config crashes the CLI; the GUI falls back to "load geometry only" and drops the custom G-code (filament swaps).
- **Fix:** never tag exports as BambuStudio unless a full project config is embedded. The exporter only does so when the user supplies their own Bambu Studio / OrcaSlicer project as `slicerTemplate` (its `project_settings.config` is copied, layer heights patched).

## Bambu Studio CLI ignores the process preset's layer height

- **Symptom:** slicing with `--load-settings "<machine>.json;<process>.json"` from `resources/profiles/BBL` gives 0.2 mm layers although the process is "0.08mm Extra Fine".
- **Cause:** the system profile JSONs use `inherits`; the CLI does not resolve the chain, so inherited keys (e.g. `layer_height`) fall back to defaults.
- **Fix:** flatten the inheritance chain (merge parent JSONs by `name`) before passing the files, keeping `from: "system"` (setting it to "User" fails with "printer is not compatible with the process preset").

## Bambu Studio emits nothing for ColorChange custom G-code

- **Symptom:** a `type="0"` (ColorChange) entry in `Metadata/custom_gcode_per_layer.xml` produces no M600 in Bambu Studio G-code; PausePrint (`type="1"`) produces `M400 U1`.
- **Cause:** Bambu Studio's `emit_custom_gcode_per_print_z` has the colour-change branch compiled out (`#if 0`); OrcaSlicer/PrusaSlicer still emit `color_change_gcode` (M600).
- **Fix:** use the "pause" swap command for Bambu printers; "color-change" is for M600 firmwares (Orca/Prusa).
