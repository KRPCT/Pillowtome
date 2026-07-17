---
phase: 2
slug: epub-reading-core
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-15
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `02-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust: cargo workspace tests; Frontend: Wave 0 decides vitest **or** keep pure helpers testable via Rust/TS build only |
| **Config file** | Cargo workspace; `vitest.config.ts` if Wave 0 adds vitest |
| **Quick run command** | `cargo test --workspace` (MSVC on Windows) |
| **Full suite command** | `cargo test --workspace` + `pnpm build` |
| **Estimated runtime** | ~30–90s cargo; ~20–60s `pnpm build` |

---

## Sampling Rate

- **After every task commit:** Rust tasks → `cargo test --workspace`; UI tasks → `pnpm build` (or `pnpm test` if vitest lands)
- **After every plan wave:** Full cargo workspace + `pnpm build`
- **Before `/gsd-verify-work`:** Full suite green + manual success criteria 1–5 on sample EPUB
- **Max feedback latency:** ~120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-W0-* | 00/01 | 0 | infra | T-02-font / T-02-sql | SQL caps; font path jail | unit/integ | `cargo test --workspace` | ⚠️ extend | ⬜ pending |
| 02-01-* | 01 | 1 | READ-01 | — | N/A | unit + build | pure helper / `pnpm build` | ❌ W0 | ⬜ pending |
| 02-02-* | 02 | 2 | READ-02, READ-03 | — | N/A | unit + build | CSS builder / `pnpm build` | ❌ W0 | ⬜ pending |
| 02-03-* | 03 | 3 | READ-04, READ-05 | — | N/A | unit + build | tap-zone / TOC helpers | ❌ W0 | ⬜ pending |
| 02-04-* | 04 | 4 | READ-06, READ-07 | T-02-font, T-02-path | font limits; search no IPC bytes | unit + build | `cargo test fonts_` + build | ❌ W0 | ⬜ pending |
| migration | * | * | D-20 | T-02-sql | parameterized SQL | integration | `cargo test --test migration` | ⚠️ extend | ⬜ pending |
| protection | * | * | FND carry | T-02-zip | soft-fail no panic | unit | `cargo test` protection | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

Planner MUST refine Task IDs to match final PLAN.md task numbers and fill automated commands per task.

---

## Wave 0 Requirements

- [ ] Extend `src-tauri/tests/migration.rs` for schema v2 prefs/fonts tables
- [ ] Font command unit tests (count ≤20, size ≤20MB, path under app_data/fonts)
- [ ] Torture / protection fixtures remain green; expand FXL soft-fail if needed
- [ ] Capabilities: `sql:default`, `sql:allow-execute` in `src-tauri/capabilities/default.json`
- [ ] Expand FoliateView ambient types (`goTo`, `search`, `book.toc`, `goToTextStart`, `clearSearch`)
- [ ] Optional: exact-pin vitest for pure TS helpers (CSS builder, tap zones, TOC flatten) — planner choice

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Paginate ↔ scroll live | READ-01 | WebView/foliate visual | Open sample EPUB → Aa → toggle 分页/滚动 → page turns vs scroll |
| Typography + themes | READ-02/03 | Visual | Change size/lh/margin + day/night/sepia; page colors match UI-SPEC |
| Immersive + tap zones | READ-04 | Touch/desktop interaction | Default chrome hidden; center toggles; L/R page in paginated |
| TOC jump | READ-05 | Navigation | Open 目录 → jump chapter → position updates |
| Custom font | READ-06 | File picker + render | Import TTF/OTF/WOFF → select → body uses face; remove → system stack |
| CJK search | READ-07 | Engine + UI | Search Chinese without spaces → hits → jump |
| Prefs survive restart | D-20..22 | App lifecycle | Change prefs → restart → same prefs |
| Progress restore | D-23..25 | App lifecycle | Read mid-book → close → reopen → near same place |

---

## Threat Model Refs (for plans)

| ID | Pattern | Mitigation |
|----|---------|------------|
| T-02-path | Path traversal book/font id | `sanitize_id`; registry; fonts only under app_data/fonts |
| T-02-zip | ZIP-slip / corrupt EPUB | existing core guards + ErrorCard |
| T-02-sql | SQL injection prefs | bound params `$1` via plugin-sql |
| T-02-font | Oversized font DoS | 20 fonts / 20MB server-side |
| T-02-ipc | Book bytes via IPC | D-06 pillow:// only |
| T-02-agpl | Readest copy | clean-room; MIT foliate only |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter after plans finalized

**Approval:** pending (filled after plan-checker)
