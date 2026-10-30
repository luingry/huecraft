# Clean-Room Process — hueCraft

> Engineering guardrails for independent implementation. Not legal advice.

## Purpose

hueCraft is built as an **independent** filament-painting tool. We reproduce **functional outcomes** observable from public sources, never proprietary **expression**.

## Teams (can be roles on a small team)

| Team | May do | Must not do |
|------|--------|-------------|
| **Spec** | Read public docs, use product as end-user, write functional specs, define acceptance tests | Decompile binaries, copy UI screenshots into implementation tickets, paste competitor strings |
| **Implementation** | Build from approved specs + open standards only | Install competitor app for "pixel matching", import competitor asset packs |
| **Gate** | Review merges for naming, UX similarity, copied text, schema leakage | Skip review on "small" PRs touching optics/export/UX |

## Allowed inputs

- Public product marketing and help pages
- Open specifications: STL, 3MF (ISO/IEC 25422), ZIP, XML
- Published community TD values with attribution and independent verification
- Our own print calibration results
- Academic/industry literature on translucency and layered materials

## Forbidden inputs

- Competitor source code, decompiled artifacts, or leaked internals
- Competitor preset libraries, filament DB dumps, or plugin binaries used as templates
- Competitor UI copy, icon sets, layout grids copied pixel-for-pixel
- Names or branding likely to cause confusion (`Hue*`, `*Forge` patterns near competitor)

## Deliverables before feature work

1. [public-product-spec.md](../research/public-product-spec.md) — abstract functional requirements
2. [acceptance-tests.md](../research/acceptance-tests.md) — behavior-only tests
3. This document — process record

## Per-feature checklist (PR template)

- [ ] Requirement traced to public spec or original research
- [ ] No competitor strings in code, UI, or fixtures
- [ ] UI/layout distinct from reference product
- [ ] File formats use open specs or hueCraft-owned schema
- [ ] Filament data is ours or properly attributed community data

## Compatibility policy

- **STL**: universal binary export
- **3MF**: ISO core mesh + hueCraft metadata namespace
- **Swap manifest**: `huecraft.swap.json` — not a clone of competitor sidecar names

## Escalation

Pause implementation and seek legal review when:

- Trademark clearance needed for public launch name
- Patent landscape search requested for optics pipeline
- User requests import of competitor project files beyond open fields

## Revision log

| Date | Change |
|------|--------|
| 2026-06-16 | Initial clean-room charter |
