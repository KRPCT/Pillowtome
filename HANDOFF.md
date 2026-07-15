# Handoff — 枕籍 (Pillowtome)

_Updated 2026-07-10 · HEAD `5f458f9` · 39 commits, all GitHub-`Verified` (SakuraRed) · remote `git@github.com:KRPCT/Pillowtome.git`_

Cross-platform (desktop + Android) CJK-first EPUB reader. Tauri v2 + Rust core + React/Vite/TS + foliate-js. 7-phase v1 roadmap; **Phase 1 of 7 done.**

## Status

**Phase 1 — Foundation & Cross-Platform Skeleton: EXECUTED, verification `partial`.**

| Req | | Verified on |
|-----|---|---|
| FND-01 desktop open EPUB E2E | ✅ | Windows (macOS/Linux not run) |
| FND-02 Android open EPUB E2E | ✅ | emulator `Medium_Phone_API_36.1` (no physical device — decision D-13) |
| FND-03 import + SAF persist across restart | ✅ | emulator; corroborated by `dumpsys` across `force-stop` |
| FND-04 DRM/corrupt detect-and-refuse | ✅ | off-device, no caveat |

39/39 workspace tests green (`cargo test --workspace`). Full report: `.planning/phases/01-foundation-cross-platform-skeleton/01-VERIFICATION.md`.

## Build & run — read first, non-obvious

Full detail in **`docs/ANDROID-BUILD.md`**. The traps that cost real time:

- **Clone needs the submodule:** `git submodule update --init` (foliate-js is pinned at `78914ae`, hosted upstream, not in this repo).
- **Desktop Rust builds need MSVC** on the Phase-1 machine — the default `stable-*-gnu` toolchain's `gcc.exe` silently exits 1. Prefix every cargo command:
  ```
  call "C:\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
  set RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc
  ```
- **Android:** `pnpm tauri android dev` (never `gradlew assemble*` standalone — it needs a live dev-session WebSocket). Requires: Windows **Developer Mode ON** (symlink), `JAVA_HOME=D:\JDK\JDK21` (Gradle 8.14.3 rejects JDK 25), `ANDROID_HOME`/`NDK_HOME` exported (they read empty in some shells despite `setx`). **`src-tauri/gen/android/` is gitignored → the Gradle-`-all` and JDK-21 fixes are local-only and lost on `tauri android init` or a fresh clone; ANDROID-BUILD.md has the re-apply steps.**
- Desktop: `pnpm tauri dev`. Tests: `cargo test --workspace` (under MSVC) + `pnpm build`.

## Architecture (where the load-bearing seams are)

- `core/` (`pillowtome-core`) — **platform-free** Rust: `Publication` trait, composite `Locator{work_id,cfi,progress_fraction,text_context}`, `BookSource{Path,ContentUri}` (opaque storage handle, D-05), `detect_protection` (3-way DRM classify, D-10). Zero tauri/plugin deps — keep it that way.
- `src-tauri/` — glue: `pillow://` Range byte-streaming protocol (**book bytes never cross IPC — D-06**), `SourceRegistry` (id→BookSource, the only path-resolution authority; `sanitize_id` blocks traversal, T-01-01), SQLite schema v1 (`work`/`locator`/`change_log`, ready for sync), Android SAF via `tauri-plugin-android-fs`.
- `src/` — React shell; `reader/FoliateView.tsx` drives foliate-js; `lib/pillow.ts` builds protocol URLs via Tauri's `convertFileSrc` (do **not** hand-roll — see the 3 gate-caught bugs below).
- Decisions: `docs/decisions/DEC-001..004`. DEC-004 = the audited `tauri-plugin-android-fs` adoption.

## Open follow-ups (carry into later phases)

1. **Physical Android device untested** — emulator is the D-13 substitute. Verify FND-02/03 on real hardware before v1 ship.
2. **Two regression gaps** (both device-only, no automated guard): Android APK-resource unreadability, and the per-platform `pillow://` URL form. CORS is guarded (`every_response_carries_cors`). Consider a minimal Android E2E in CI eventually.
3. **`sync_async 0.1.0`** (single-version, same author as the SAF plugin) is now in the build graph — accepted cost of DEC-004; re-audit on any plugin version bump.
4. No frontend test harness — `pillowUrl`/`FoliateView` have no unit coverage (mitigated by delegating URL construction to Tauri).

### Three bugs Phase 1 hit — all "works on desktop ≠ correct" (context for reviewers)
Missing CORS on `pillow://`, `BaseDirectory::Resource` unreadable inside the APK, and a hand-rolled per-platform URL that sent Android to `https://`. None were caught by unit tests — only by device/browser gates. Lesson baked into ANDROID-BUILD.md "Platform behaviours"; keep device gates for anything platform-shaped.

### Phase 2 layout bug (same class)
foliate-js paginator defaults (`max-block-size: 1440px` + equal `1fr` header/footer rows) **centered short chapters as a floating card** on tall phone viewports; we also mis-mapped UI “页边距” to foliate’s `margin` attribute (which is header/footer band height, not page padding). Fixed via `applyFoliateLayoutAttrs` + body padding in `setStyles`. **Mandatory:** any future reader UI change must pass the Android emulator gate in `docs/ANDROID-BUILD.md` § Device gate (also listed in `CLAUDE.md` Constraints).

## Next: Phase 2 — EPUB Reading Core (READ-01..07)

Immersive themeable reading: pagination↔scroll, font/size/line-height/margins, day/night/sepia, TOC nav, in-book search (CJK-aware), custom fonts. Builds on the proven `pillow://`→foliate-js slice.

Resume the GSD flow:
```
/gsd-plan-phase 2        # research → plan → plan-check (Phase 2 is a UI phase — /gsd-ui-phase 2 first)
/gsd-execute-phase 2
```
`.planning/STATE.md` and `ROADMAP.md` hold live state. Remaining after P2: P3 CJK typography (the moat), P4 library, P5 annotations, P6 TXT, P7 WebDAV sync.
