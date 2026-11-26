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
- **Fix:** use the "pause" swap command for Bambu printers; "color-change" is for M600 firmwares (Orca/Prusa). With an AMS use "ams": ToolChange items (`type="2" extruder="N" gcode="tool_change"`, `<mode value="MultiAsSingle"/>`) plus one filament per slot in `project_settings.config`. Checked with the CLI: the G-code gets `M620 SnA` / `Tn` at exactly those Z, no pause.
- **Check:** `bambu-studio.exe --slice 0 --outputdir out --export-3mf sliced.3mf in.3mf`; `out/result.json` has `return_code` (0 = ok) and `Metadata/plate_1.gcode` inside `sliced.3mf` has the commands. The CLI writes no readable error log: bisect by editing `project_settings.config`.

## A newly added filament does not show up in the preview

- **Symptom:** after adding 4–5 filaments with "Adicionar filamento", the last one is listed but never appears in the image (or has no band in the layer bar).
- **Cause:** `addOnTop` placed each new swap halfway between the current top swap and the *last layer of the print*. Each add halves the remaining gap, so after a few adds the swap lands on/after the last layer, or above the highest layer any pixel reaches. There is no limit on the number of colours.
- **Fix:** `addOnTop` now uses the highest layer the image reaches (`topReachedLayer`, from the layer histogram) and, when no room is left above the top swap, splits the thickest band instead. Rows whose swap starts above the reached layer are dimmed with a tooltip.

## The "Cor do centro" brush skips small areas of the sampled colour

- **Symptom:** in sampled mode, small areas showing the clicked colour are not painted even when aimed at exactly. Similar colours elsewhere paint fine.
- **Cause:** with "Simular largura de linha" on, the view shows the average of each line-width block of pixels. The sample came from that displayed block, but the blend tested each raw pixel. In detailed areas, few or none of the raw pixels are at the displayed layer.
- **Fix:** `PaintContext.cell` (the line-width block size in pixels). Colour blends now judge each block by the layer it shows, computed from the surface before the stroke. The export receives `simulateLineWidth` so it makes the same decision as the preview.

## Generic mesh simplifiers break the exported relief

- **Symptom:** running meshoptimizer (`simplify`, `LockBorder` + `ErrorAbsolute`, error ≈ 0.01 mm) on the export's top surface gave ~55 % fewer triangles, but ~14 000 triangles faced down in XY (folds/overhangs on the steep layer ramps), a few non-manifold edges, and took 6.5 s on 3 M triangles.
- **Cause:** QEM edge collapse measures 3D distance only; on near-vertical one-sample ramps between plateaus a collapse can fold the sheet without exceeding the error. It knows nothing about the surface being a heightfield.
- **Fix:** the export top is an RTIN (`buildSolidHeightfieldMesh` in `packages/mesh`): lossless, crack-free by construction, always a heightfield. Do not add a generic simplifier after it without an XY-orientation and manifold check.

## Terrace mesh not watertight after earcut (T-junctions on collinear points)

- **Symptom:** `buildTerracedSolidMesh` failed `checkWatertight` on a few random fields: open edges forming a zero-area triangle such as (1, 5.5)–(1.5, 5.5)–(2, 5.5) on one face.
- **Cause:** contour points of *different* loops of a face can be exactly collinear (e.g. level-4 and level-5 crossings at the same half-cell row). earcut treats "touching" as non-intersecting and ran a diagonal straight through the middle point, leaving a T-junction. Separately, earcut drops collinear points on straight border runs, which also leaves T-junctions against the walls.
- **Fix:** earcut runs on coordinates nudged by ±1e-8 mm (deterministic), so a vertex on a diagonal becomes a zero-area triangle that still shares its edges. Any boundary point earcut still drops is put back by splitting the triangle on the edge spanning it. Do not filter zero-area triangles afterwards: they are part of the conforming mesh.

## Bambu Studio merges multi-material parts written as Prusa volumes

- **Symptom:** the face-down 3MF (one mesh, `Metadata/Slic3r_PE_model.config` with `<volume firstid lastid>` + `extruder` per range) slices in Bambu Studio with everything on filament 1; re-exported from the CLI it holds a single part.
- **Cause:** Bambu Studio ignores Prusa volume ranges (and a copy of them in `model_settings.config`) for non-Bambu 3MFs, so the overlapping shells load as one part. Adding a Bambu-style `model_settings.config` with `<part ... extruder>` to an untagged 3MF crashed the CLI (segfault), like the partial-config crash above.
- **Fix:** write each part as its own `<object>` assembled by a `<components>` object (3MF core): Bambu Studio loads one object with one part per component. To also assign filaments and colours, the file must be a full Bambu project (`exportBambuPartsProject`): Application tag, parts in `3D/Objects/object_1.model` referenced with `p:path`, `Metadata/model_settings.config` with `<metadata key="extruder">` per part, and a complete `project_settings.config` (from the user's template) whose per-filament arrays, `filament_colour`, `inherits_group` / `different_settings_to_system` (L+2 entries) and `flush_volumes_matrix` grow to the filament count. The matrix side is not always the filament count (a 1-filament project keeps 4×4), but once filaments are added it must be exactly N×N: a 4×4 matrix with 3 filaments also fails slicing with -100 (resize from its own side, truncating or growing). Without the project config the CLI segfaults, so without a template the export stays plain parts.
- **Check:** `bambu-studio.exe --load-settings "m.json;p.json" --load-filaments "f.json;…" --outputdir out --export-3mf re.3mf in.3mf`, then look at the `<part>` entries in `Metadata/model_settings.config` of `re.3mf`. The CLI may keep running after writing output: kill only the process it started.

## Colour details vanish in the print (red text over dark blue)

- **Symptom:** small saturated details (red text on the ÖSPIEL cover) print as the surrounding dark colour; no stack, swap layer or tone setting (auto-tune included) brings them back.
- **Cause:** the relief height comes from luma only. The red text (luma 0.2–0.3) shares its luma band with the dark-blue background, so both get the same layer count and therefore the same printed colour. Auto-tune's area-weighted error also barely notices a detail covering ~2 % of the image.
- **Fix:** colour-driven heights (`ReliefParams.colorMatch`, `packages/engine/src/colorHeight.ts`): each pixel picks the layer count whose printed colour best matches it in OKLab, pulled towards the luma height by `1 - colorMatch`. Auto-tune scores this mode with a binned per-pixel argmin (`ColorScorer`). The relief then depends on the stack, so its cache key includes the printed LUT.

## Tone sliders do almost nothing after auto-tune "Cor"

- **Symptom:** after auto-tune in colour mode (colorMatch 0.95), contrast / brightness / gamma / smoothing / posterize barely change the print.
- **Cause:** in colour mode each pixel matches the *raw* source colour; the tone settings only moved the luma pull target, whose weight is `(1 - colorMatch)` ≈ 0.05. Brightness / gamma were also hidden in the simple profile even when auto-tune had set them.
- **Fix:** `adjustColorTarget` applies brightness / contrast / gamma to OKLab L (chroma scaled along) and smoothing as an alpha-weighted blur to the colour target; `colorHeightField` posterizes its output. Auto-tune's `ColorScorer` picks heights from the adjusted target but reports error against the original. Brightness / gamma sliders stay visible in the simple profile once they leave their defaults.
- **Regression it caused:** auto-tune "Cor" then pulled the print to black and white whenever a contrast / gamma was left from a "Completo" tune or a manual edit (the colour target was contrast-stretched and "Cor" does not search tone). Fix: in colour mode auto-tune also searches with neutral tone (the old behaviour) and keeps whichever has the lower colour error against the original image.

## White background prints beige / tinted after importing an image

- **Symptom:** an image with a large white background (e.g. a silhouette on a white page) opens with the background predicted as beige / pinkish, as if tinted by the other colours of the image. The colour reading itself is right (white is picked as a filament).
- **Cause:** on import (and on a colour preset), `autoDistributeStack` placed the swaps by pixel quantiles of the relief. ~85 % of the pixels are the white background at full height, so every quantile fell on the top layer and the swaps were squeezed to the last layers (26/27/28 of 29). White got one 0.08 mm layer over one orange and one red layer on black: with TD ≈ 1.2 mm that layer hides only ~18 % of what is below.
- **Fix:** the import / preset step now runs a swaps-only auto-tune in the worker (`reorder: false, tone: false`, 1.5 s budget, ~40 ms in practice), which scores the predicted print colours, and falls back to the quantiles on error. Same image: swaps 5/11/13, background (243, 241, 241), colour error 36 → 5. The "Distribuir" button uses the same placement (`distributeSwaps` in `useWorkbench.ts`).

## App "encolhe"/sobe e deixa faixa vazia embaixo ao clicar num toggle
- **Sintoma:** ao ativar um switch (ex.: "Alinhar alturas às camadas") com a coluna de controles rolada, a UI inteira sobe e sobra área vazia embaixo; persiste após refresh (restauração de scroll).
- **Causa raiz:** o `<input>` oculto do `.hc-switch` era `position: absolute` sem ancestral posicionado. Ele escapava do clipping de `.wb-controls` (overflow só recorta filhos cujo containing block está dentro), aumentava o `scrollHeight` do `<html>`, e ao receber foco o navegador rolava o `<html>` (body `overflow:hidden` ainda é rolável programaticamente).
- **Solução:** `.hc-switch { position: relative; }` em `packages/design-system/src/theme.ts`.
- **Evitar:** todo elemento `position:absolute` escondido (inputs de toggle/checkbox) precisa de um pai posicionado dentro do container rolável.

## Black-and-white figure prints orange specks / coloured halo (samurai over a sunset)

- **Symptom:** a black figure with white brush highlights on a white page, over an orange sun, imports as white base → yellow → orange → black on top. The figure's highlights and the outline of the ground print orange/yellow specks and a coloured halo; no swap placement fixes it.
- **Cause:** with black and white at opposite ends of the stack, every block that mixes them (thin strokes, anti-aliased edges, line-width blocks) lands on a height between them, i.e. on the yellow/orange layers. Grey is unreachable in that stack. The import step also never reordered filaments (swaps-only auto-tune), and in colour mode the search scored "match + luma pull" instead of the colour error, so even "Ordem" / "Cor" auto-tune did not prefer black → white → yellow → orange (per-pixel error barely sees borders: they are a small share of the area).
- **Fix:** `ColorScorer` scores the colour error of its picks plus `EDGE_WEIGHT` × a border term: for neighbouring pixels of two near-neutral colours, the layers strictly between their heights should lie on the OKLab segment between them (greys between black and white). The import / colour-preset step runs auto-tune with `reorder: true` in colour mode. Same image: black-with-colour 24 % → 0.1 %, greys-with-colour 86 % → 0.5 %, halo 36 % → 9 %. Reference: a HueForge 3MF that prints cleanly (lighthouse) uses black base → white → black (1 layer) → red → yellow, i.e. the colours that touch are neighbours in height.
- **Note:** borders between a neutral and a hue (black bird on the sun) are not scored; with the sun on top they always cross the layers below it, and the preview's line-width simulation averages heights, so it shows them as a white outline that the slicer mostly closes.
