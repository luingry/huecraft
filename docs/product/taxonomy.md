# hueCraft Product Taxonomy

Proprietary naming. Do not mirror competitor mode or file names.

## Product

| Term | Meaning |
|------|---------|
| hueCraft | Application name |
| Bench | Main workbench UI |
| Stack | Ordered filament layers bottom→top |
| TD | Transmission Distance (mm) — industry term, not owned |

## Relief modes

| hueCraft ID | User label | Description |
|-------------|------------|-------------|
| `luminance` | Luminance | Brightness → height |
| `contrast` | Contrast | Luminance + curve |
| `palette` | Palette Regions | Color clusters → height |
| `reference` | Reference Map | User color anchors |

## Files

| Extension | Purpose |
|-----------|---------|
| `.hcproj` | hueCraft project (JSON + embedded refs) |
| `.hcswap.json` | Machine-readable swap plan |
| `.hcswap.txt` | Human-readable swap summary |
| `.hcfil.json` | Filament library export |

## Not used

- `.hfp`, `.describe.txt`, or competitor project extensions as primary format
- Mode names: Standard, Combo, Color Aware, Color Pop, Color Match

## UI regions

| ID | Label |
|----|-------|
| `stack-panel` | Filament Stack |
| `preview-stage` | Preview |
| `swap-timeline` | Layer Swaps |
| `properties-rail` | Print Settings |
