# Local Engine Architecture

## Overview

hueCraft runs entirely in the browser for MVP. Heavy work is offloaded to Web Workers; GPU kernels use WebGPU when available.

```
apps/web (React UI)
    ↕ postMessage
packages/engine (orchestrator worker API)
    ├── image-core
    ├── optics
    ├── mesh
    ├── exporters
    ├── filament-db
    └── project-schema
```

## Worker boundary

- Main thread: React, file pickers, WebGL/WebGPU canvas for 3D preview
- Engine worker: image decode, relief solve, optics, mesh build, export bytes
- Optional render worker: 2D preview compositing via OffscreenCanvas

## COOP/COEP

For WASM threads (future): serve with

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

MVP runs without threads; SIMD WASM is phase 1.5.

## Storage

| Data | Store |
|------|-------|
| Filament library | IndexedDB via Dexie |
| Project blobs (image) | OPFS when available, else IndexedDB |
| Export cache | ephemeral memory only |

## Progressive preview

1. **Fast path**: quarter-res relief + optics on slider drag
2. **Commit path**: full-res on debounce 300ms
3. **Mesh path**: debounce 500ms, cancel prior job via AbortSignal

## Feature detection

```ts
capabilities = {
  webgpu: !!navigator.gpu,
  opfs: !!navigator.storage?.getDirectory,
  fsAccess: 'showOpenFilePicker' in window,
}
```

## Package responsibilities

See `packages/*/README.md` for module contracts.
