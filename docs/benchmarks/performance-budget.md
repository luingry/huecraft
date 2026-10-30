# Performance Budget

Target hardware: laptop 2022+, 8 GB RAM, Chrome/Edge desktop.

## Interaction budgets

| Operation | Target | Max |
|-----------|--------|-----|
| Image import + thumb | 200 ms | 800 ms |
| Slider drag preview (fast path) | 16 ms/frame | 33 ms |
| Full-res preview commit | 300 ms | 1200 ms |
| Mesh build 512×512 | 500 ms | 2500 ms |
| STL export 512×512 | 200 ms | 1000 ms |
| Project save | 150 ms | 600 ms |

## Memory

| Asset | Limit |
|-------|-------|
| Working image | 2048×2048 max default |
| Height field | Float32, same dims |
| Mesh | 2M triangles soft cap with decimation warning |

## Resolution presets

| Preset | Max edge | Use |
|--------|----------|-----|
| Draft | 256 | Slider drag |
| Standard | 512 | Default edit |
| Fine | 1024 | Export prep |
| Max | 2048 | User opt-in |

## WebGPU vs CPU

- Optics convolve: WebGPU if `navigator.gpu` && shader compile OK
- Fallback: CPU Float32 in worker

## Benchmark script

`pnpm --filter @huecraft/engine bench` runs synthetic 512² pipeline and prints timings.
