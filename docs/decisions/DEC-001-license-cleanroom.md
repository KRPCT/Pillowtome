# DEC-001: License Clean-Room — foliate-js (MIT) vendored, AGPL Readest reference-only

- **Status:** Accepted
- **Date:** 2026-07-09
- **Phase:** 1 (Foundation & Cross-Platform Skeleton)
- **Sources:** CONTEXT.md D-11; STACK.md §"What NOT to Use"; ARCHITECTURE.md anti-patterns; PROJECT.md charter

## Statement

Pillowtome uses **foliate-js (MIT)** as its EPUB render engine, vendored at a
**pinned commit** (`78914ae`, per Plan 01-01) with the upstream MIT `LICENSE`
retained. We maintain a strict **clean-room boundary from Readest**, which is
**AGPL-3.0**: Readest may be studied as an *architectural reference* only (it
ships the same Tauri v2 + foliate-js shape), and **no Readest source is ever
copied, adapted, or transcribed** into this codebase. Every borrowed component's
license contagion surface is audited before adoption. The final application
license is TBD before the first public release, but the clean-room discipline is
**locked now** so no contaminating dependency can slip in during early phases.

## Rationale

- **foliate-js is MIT**, so it can be used and redistributed under a permissive
  or (later) any chosen license without contagion — unlike epub.js (avoided for
  CJK progress reasons) or AGPL engines.
- **Readest is AGPL-3.0.** Copying even small amounts of its source would force
  AGPL on Pillowtome (network-copyleft), foreclosing the licensing decision we
  intend to make deliberately later. Its *architecture* (Tauri v2 core +
  foliate-js in the WebView + custom-protocol byte streaming) is not
  copyrightable as an idea and is a legitimate reference.
- Vendoring foliate-js at a **pinned commit** (rather than tracking an npm
  range) is required both by the author's explicit "API may break" warning and
  by our supply-chain zero-trust baseline (exact pins, committed lockfiles).

## Consequences

- foliate-js updates are a deliberate, audited bump of the pinned SHA, never an
  automatic floating upgrade; the MIT `LICENSE` and attribution stay with the
  vendored tree.
- Contributors must not paste Readest (or any AGPL/GPL) code. Architectural
  learnings are re-implemented from scratch against our own seams.
- Any new third-party component is license-audited for contagion before landing;
  AGPL/GPL runtime dependencies are rejected by default.
- The app's public license is chosen before first release with a clean,
  permissively-sourced dependency graph already in place.

## References

- D-11 (clean-room boundary locked now; final license TBD).
- STACK.md: "Copying Readest source → forces AGPL; learn its architecture, use
  foliate-js (MIT) + pdf.js directly."
- Plan 01-01 SUMMARY: foliate-js vendored as a pinned submodule (`78914ae`, MIT
  LICENSE retained).
