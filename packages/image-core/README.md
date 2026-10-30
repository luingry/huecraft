# @huecraft/image-core

Image → relief field.

## API

- `extractLumaAlpha(rgba)` — Rec.709 luma on gamma-encoded sRGB, premultiplied by alpha (done once per image).
- `previewGridSize` / `exportGridSize` — grid sizes (preview: longest edge; export: `widthMm / exportResolutionMm`, capped at the source).
- `resizeLumaAlpha(field, size)` — separable area-average (box filter) resample.
- `reliefField(field, relief)` — t in [0, 1]: brightness → contrast around 0.5 → clamp → gamma → invert → × alpha → box blur.
  `smoothing` is a radius in pixels of a 640 px (longest edge) reference grid, rescaled per grid so the physical blur matches between preview and export.
