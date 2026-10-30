# hueCraft

Local-first web workbench for **filament painting** — turn 2D images into layered FDM prints with optical preview.

## Features (MVP)

- Image → relief height field
- Filament stack editor with TD-based optical preview
- 3D mesh preview + STL / 3MF export
- Layer swap plan (`.hcswap.json`)
- Local project save (IndexedDB / OPFS)

## Quick start

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173 — best in Chrome or Edge desktop.

## Monorepo

| Path | Role |
|------|------|
| `apps/web` | React workbench UI |
| `packages/engine` | Worker orchestration |
| `packages/image-core` | Image → height field |
| `packages/optics` | TD color model |
| `packages/mesh` | Height field → mesh |
| `packages/exporters` | STL, 3MF, swap manifest |
| `packages/filament-db` | Filament library |
| `packages/project-schema` | `.hcproj` schema |
| `packages/design-system` | Tokens + primitives |

## Legal

Independent implementation. See [docs/legal/clean-room.md](docs/legal/clean-room.md).

## License

MIT
