---
phase: 04-local-library
created: 2026-07-16
nyquist: true
---

# Phase 4 Validation Strategy

## Sampling targets

| ID | Behavior | Automated | Manual/device |
|----|----------|-----------|---------------|
| LIB-01 | File import + folder scan populate library; hash skip | cargo + frontend tests | Android + desktop import/scan |
| LIB-02 | Cover grid | component/mapper tests where pure | Visual grid |
| LIB-03 | Title/author metadata | unit on extract + row map | Visual cards |
| LIB-04 | Sort/filter | pure function vitest | Chip interaction |
| READER-POS | Open resume, mode switch, TOC scroll | unit on position helpers | **Emulator required** (MAJOR gates) |

## Commands

```bash
cargo test --workspace
pnpm test
pnpm build
# Device (after implement):
# pnpm tauri android dev / install debug with vite reverse
# Manual UAT scenarios from docs/MAJOR-READER-POS.md §Required outcome
```

## Dimension 8 notes

- Migration V4 tests mandatory (append-only, defaults, indexes)
- Dedup unit: same hash → one library_item
- reading-position encode/parse + positionFromLocatorCfi remain green
- Jump-bus pure helpers preferred for unit sampling; integration on device for dual-surface
