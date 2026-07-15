---
phase: 3
slug: cjk-typography-differentiation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-16
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `03-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Frontend: vitest 3.2.4 (TS pure helpers); Rust: cargo workspace tests; Visual: golden-image Blink + WebKit |
| **Config file** | `vitest.config.ts`; Cargo workspace |
| **Quick run command** | `pnpm test` + `cargo test --workspace` (MSVC on Windows) |
| **Full suite command** | `pnpm test` + `cargo test --workspace` + `pnpm build` + golden Blink + golden WebKit |
| **Estimated runtime** | ~30–90s unit; golden dual-engine longer / CI |

---

## Sampling Rate

- **After every task commit:** TS tasks → `pnpm test`; Rust font/migration tasks → `cargo test --workspace`
- **After every plan wave:** Full unit suite + `pnpm build`
- **Before `/gsd-verify-work`:** Full suite green + golden-image Blink+WebKit on coverage sheet + Android emulator smoke for font/CSS claims
- **Max feedback latency:** ~120 seconds for unit/build; golden may be CI-only

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-W0-* | 00 | 0 | infra | T-03-font / T-03-sql | font path jail; SQL bound params | unit/integ | `pnpm test` + `cargo test --workspace` | ⚠️ extend | ⬜ pending |
| 03-01-* | 01 | 1 | CJK-01, CJK-02, CJK-03 | T-03-css | prefs → fixed CSS templates only | unit + build | `pnpm test -- apply-reading-styles` / feature-detect / autospace-shim | ❌ W0 | ⬜ pending |
| 03-02-* | 02 | 2 | CJK-03, CJK-04 | — | N/A | unit + build | kinsoku tables + apply-reading-styles indent | ❌ W0 | ⬜ pending |
| 03-03-* | 03 | 3 | CJK-05 | T-03-font / T-03-path | OFL assets; safe font ids | unit + golden | fonts stack tests + dual-engine golden | ❌ W0 | ⬜ pending |
| migration | * | * | D-34 | T-03-sql | SCHEMA_V3 defaults 1 | integration | `cargo test` migration | ⚠️ extend | ⬜ pending |
| Settings UI | * | * | D-31..33 | — | N/A | build + manual | `pnpm build` + Aa sheet smoke | ❌ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

Planner MUST refine Task IDs to match final PLAN.md task numbers and fill automated commands per task.

---

## Wave 0 Requirements

- [ ] Extend `ReadingPrefs` / `DEFAULT_PREFS` / tests for 3 CJK booleans (default ON)
- [ ] `cjk-feature-detect.ts` + unit tests with mock `CSS.supports`
- [ ] `cjk-autospace-shim.ts` textContent invariance + disposer restore tests
- [ ] `cjk-kinsoku.ts` prohibited start/end table snapshots (zh shared)
- [ ] SCHEMA_V3 migration + migration test (global `reading_prefs` columns default 1)
- [ ] Bundled font resolve path + protocol allowlist tests
- [ ] Golden harness scaffold + coverage-sheet fixture (`tests/fixtures/cjk/`)
- [ ] SettingsSheet「中文排版」section stubs + a11y labels 简体中文
- [ ] Ensure ContinuousScrollStream gets identical CSS/shim path as FoliateView

*If planner collapses Wave 0 into plan 03-01, still list these as blocking prerequisites.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 标点挤压 visible | CJK-01 | Engine/font visual | Open CN EPUB → Aa → 中文排版 → toggle 标点挤压; consecutive punctuation spacing changes on Blink |
| 盘古之白 mixed spacing | CJK-02 | Engine + shim visual | Mixed 中文ABC数字; ON vs OFF; older WebView still readable when degraded |
| 禁则 line breaks | CJK-03 | Layout visual | Narrow width; `。，）」` not at line start; `「（` not at line end |
| First-line indent | CJK-04 | Visual | Body `p` 2em indent; headings/blockquotes not indented |
| Bundled font / no tofu | CJK-05 | Dual-engine visual | Coverage sheet on Windows (Blink) + macOS/WebKit; no □ / ransom-note mix |
| Prefs survive restart | D-34 | App lifecycle | Toggle CJK flags → restart → same state |
| Android font serve | CJK-05 / CLAUDE | Device gate | Emulator: open book with bundled face; no protocol/font failure |
| Silent degrade | D-38 | Weak engine | Toggle remains available; no blocking upgrade wall |

---

## Threat Model Refs (for plans)

| ID | Pattern | Mitigation |
|----|---------|------------|
| T-03-path | Path traversal via font id | `is_safe_font_id` + canonicalize under app_data/fonts |
| T-03-font | Oversized / malicious font assets | Pin known Noto sizes; existing 20/20MB custom-font caps |
| T-03-sql | SQL injection prefs | Bound params `$1` via plugin-sql; boolean columns only |
| T-03-css | XSS via injected CSS from prefs | Prefs are booleans/numbers; CSS builder fixed templates |
| T-03-agpl | License contagion / Readest copy | OFL Noto only; clean-room; MIT foliate only |
| T-03-dom | Shim breaks CFI/search | No permanent text rewrite; textContent invariance tests |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s (unit/build)
- [ ] `nyquist_compliant: true` set in frontmatter after plans finalized

**Approval:** pending (filled after plan-checker)
