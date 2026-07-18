---
phase: 07-webdav-self-hosted-sync
plan: 04
subsystem: sync
tags: [webdav, sync, ui, scheduler, status-dot, settings-sheet, placeholder-card, file-sync-toggle, trace-pill, undo-dialog, d-90, d-91, d-92, d-93, d-98, d-99, d-102, upload-pump, vitest, wiremock]

# Dependency graph
requires:
  - phase: 07-webdav-self-hosted-sync/07-01
    provides: connect spine (sync_get_config / sync_test_and_save{input} / sync_disconnect), D-97 classified Chinese Err strings, keychain-only password, PublicSyncConfig wire shape
  - phase: 07-webdav-self-hosted-sync/07-02
    provides: state plane IPC (sync_book_opened/closed/revert_jump/now/status), SOLE "sync-status" event emitter, SyncUndoMap (D-92 replacedLocal), SyncProgressMaps transfer maps
  - phase: 07-webdav-self-hosted-sync/07-03
    provides: file plane (fileplane::upload_book / download_book, DownloadedBook, FileProgress sink, progress_bridge, sync_set_file_sync flag flip, sync_download_book IPC, completed-upload row contract)
provides:
  - src/sync/ — sync-api (10 typed invoke wrappers, password inbound-only), sync-status store + pure §C mappers, scheduler close-gate, sync-form pure validation, SyncStatusButton, SyncSettingsSheet
  - library sync surface — types/LibraryItem fileLocal+fileSyncEnabled, library-store V8-aware list + adoptSyncedFile, sync-card-state five-state matrix, LibraryCard placeholder variants + 同步此书 MenuItem, LibraryGrid syncView threading, LibrarySettingsSheet 同步 section
  - reader sync surface — FoliateView 开书拉/合书推/切后台推 hooks (zero timers), sync-jump trace derivation, ReaderBottomBar sync pill slot, SyncUndoDialog (撤回原位/保留进度)
  - BACKEND WIRING (orchestrator-directed deviation): pending-upload pump in sync_now_inner — pending_uploads scan + pump_pending_uploads + upload_pending_book ([hash8] collision retry) + local_path_for_upload (SAF cache staging) + post-upload re-push; tests/sync_pending_uploads.rs (4)
affects: [phase-7-gate, end-of-phase manual AVD/server-matrix batch]

# Tech tracking
tech-stack:
  added:
    - "Zero new packages (D-13 holds: Cargo.lock untouched, package.json untouched) — the whole plan is new app code over existing deps (@tauri-apps/api event/core, @mui/material, lucide-react)"
  patterns:
    - "Close-gate (createCloseGate): at-most-one close push per open, deduping unmount vs handleBack vs visibilitychange; re-armed on every successful ensure_work (reopenTick-safe) and on return-to-foreground (no re-pull — D-90 open-only)"
    - "Toast-on-transition-only (shouldToastFailure): the sticky error dot never re-toasts; success clears and re-arms (T-07-04-06)"
    - "Dependency-injected framework-free store (createSyncStatusStore(load, listen)) — snapshot init with EMPTY transfer arrays, event folds thereafter; vitest drives it without Tauri"
    - "Password containment: field-local useState only, inbound-only payload field, zero console.log in sync modules (grep-gated), keychain is the sole store"

key-files:
  created:
    - src/sync/sync-api.ts
    - src/sync/sync-status.ts
    - src/sync/sync-status.test.ts
    - src/sync/scheduler.ts
    - src/sync/scheduler.test.ts
    - src/sync/sync-form.ts
    - src/sync/sync-form.test.ts
    - src/sync/SyncStatusButton.tsx
    - src/sync/SyncSettingsSheet.tsx
    - src/library/sync-card-state.ts
    - src/library/sync-card-state.test.ts
    - src/reader/sync-jump.ts
    - src/reader/sync-jump.test.ts
    - src/reader/SyncUndoDialog.tsx
    - src-tauri/tests/sync_pending_uploads.rs
    - .planning/phases/07-webdav-self-hosted-sync/07-04-SUMMARY.md
  modified:
    - src/library/types.ts
    - src/library/library-store.ts
    - src/library/LibraryCard.tsx
    - src/library/LibraryGrid.tsx
    - src/library/LibrarySettingsSheet.tsx
    - src/reader/SettingsSheet.tsx
    - src/reader/ReaderBottomBar.tsx
    - src/reader/FoliateView.tsx
    - src/App.tsx
    - src/App.css
    - src-tauri/src/sync/commands.rs

key-decisions:
  - "ORCHESTRATOR-DIRECTED BACKEND WIRING (integration gap): nothing in production called fileplane::upload_book — 同步此书 would never have uploaded. sync_now_inner now runs a pending-upload pump AFTER pull+push succeeds: scan = file_sync_enabled=1 AND deleted=0 AND source_id!='sync-remote' AND no completed direction='upload' row WITH remote_path (an interrupted scratch row IS returned so upload_book resumes via transfer_uuid/chunks_done); sequential per book through the existing progress_bridge (TransferKind::Upload); per-book failure → classified copy into last_error and CONTINUE, never fails sync_now; ≥1 success → ONE extra reconcile_push so peers see file_sync.remote_path/size/hash in the same run. The frontend simply calls syncNow() after syncSetFileSync(true); the D-90 manual button covers uploads too"
  - "[hash8] collision retry: upload_book never silently overwrites (same-name different-size → RemoteConflict), so upload_pending_book retries once with book_remote_path(..., collision=true) — the D-105 naming point's caller-side decision, wiremock-proven"
  - "Android SAF staging: ContentUri books read whole via resolve_bytes into app_cache_dir/sync-upload/{work_id}.{fmt}, upload, reap — the documented pre-existing whole-bytes constraint (fileplane.rs module docs); desktop Path sources upload in place via SourceRegistry resolve"
  - "Trace-apply ordering: the open-pull jump applies in an effect gated on (status==='reading' && syncOpenResult) — the pull and the book open race, so neither a .then jump (book not open yet) nor skipping (pull slower than open) is correct; a ref makes it once-per-mount"
  - "Sync pill slot priority: ReaderBottomBar renders the sync pill INSTEAD of the undo pill while a trace is live; captureUndo's first line clears the trace (any manual jump replaces it, §5); session-scoped, no timer"
  - "撤回 target never UI-guessed: the dialog replays the locator RETURNED by sync_revert_jump (trace pill itself is driven by the open-time replacedLocal merge byproduct)"
  - "Placeholder adoption is explicit: onDownload = syncDownloadBook → ingestPathToLibrary(knownHashes EXCLUDING this workId) → adoptSyncedFile UPDATE (source_id, cover_file) → refreshShelf — ingest alone exits skipped_duplicate (import-actions.ts:59) and would leave the sync-remote sentinel row unopenable across restarts"
  - "Manual sync_now success toast gates on the RESOLVED payload's lastError (sync_now returns Ok even on engine failure — the failure toast arrives via the event transition); failures never produce a Dialog anywhere (D-93)"

patterns-established:
  - "Pure-logic extraction per Nyquist: scheduler close-gate, §C dot/aria/toast/relative-time mappers, form validation/normalization, §3 card-state matrix, D-92 trace derivation — all node-vitest-covered (42 new tests)"
  - "One badge slot, never both: cloud badge replaces 已读 on placeholder cards; reading-progress bar survives on placeholders (D-102); 下载中 uses the same 3px progress channel"
  - "Menu gesture unchanged: 同步此书 rides the existing 500ms/10px long-press Menu ABOVE 删除, hidden when fileLocal===false (开关属于持有文件的一端), caption 正在上传… + disabled while uploading"

requirements-completed: [SYNC-01, SYNC-02, SYNC-03, SYNC-04, SYNC-05]
# ^ UI surfaces landed for all five; the DEVICE half (AVD production-APK
#   acceptance + D-94 real-server matrix) is DEFERRED to the end-of-phase
#   manual batch — see Deferred section. Phase gate stays open until it runs.

# Metrics
duration: ~150min
completed: 2026-07-18
---

# Phase 7 Plan 04: Sync UI + Scheduler + Upload Pump Summary

**The entire user-visible sync surface is landed: 开书拉 / 合书推 / 切后台推 / 手动按钮 are the only triggers (zero timers, zero polling — D-90/D-91), the AppBar SyncStatusButton carries the 8px three-state dot with verbatim aria copy, the SyncSettingsSheet force-tests before saving (classified Chinese failures rendered verbatim), placeholder cards download-and-adopt into real local books, 同步此书 now actually uploads via an orchestrator-directed backend pump wired into sync_now, and the D-92 trace pill + 撤回弹窗 restore the exact pre-jump position returned by sync_revert_jump. Failures surface only as dot + one-shot toast — no modal exists for any sync failure (D-93). Task 5 (AVD + real-server matrix) is user-deferred to the end-of-phase manual batch.**

## Performance

- **Duration:** ~150 min
- **Tasks:** 4 auto (Task 5 checkpoint DEFERRED — user batch)
- **Files modified:** 26 (15 created, 11 modified)

## Accomplishments

- **Scheduler (D-90/D-91):** `createCloseGate()` pure close-gate + FoliateView wiring — pull once per mount after ensure_work (real path only, `work-*` fallback skipped); close push through the gate from teardown, handleBack, and a new visibilitychange effect (background → push, foreground → re-arm, NO re-pull); all failures `console.warn`-only in the reader. Zero `setInterval`/sync `setTimeout` anywhere new.
- **Status chrome (D-93):** `createSyncStatusStore(load, listen)` dependency-injected store (snapshot init with EMPTY transfer arrays; event folds) + pure mappers `dotFor`/`ariaLabelFor`/`shouldToastFailure`/`formatRelativeSyncTime`; SyncStatusButton (RefreshCw, 8px dot, aria-busy, muted-when-unconfigured, spin/pulse disabled under prefers-reduced-motion); AppBar placement immediately left of the settings gear; failure toasts exactly once per error transition via the existing Snackbar channel.
- **SyncSettingsSheet (SYNC-01):** MUI Drawer with the touch-gate #3 structure (header shrink-0, body flex-1 min-h-0 overflow-y-auto, pan-y, `min(85vh, 720px)`), all §2 sections in order, every Copywriting-Contract string verbatim, two INDEPENDENT TLS switches with warning captions (D-95), forced test with inline verbatim Err rendering (client-side owns only the invalid-URL class), keyring-unavailable state, 同步状态 read-only rows + 立即同步, 断开连接 behind the MUI confirm dialog. Password is field-local state only — never logged, never toasted, always empty on reopen with the 凭据已保存在系统密钥环 caption.
- **Library surfaces (SYNC-04):** V8-aware list query + `fileLocal`/`fileSyncEnabled` derivation (sync-remote sentinel), `adoptSyncedFile` UPDATE helper, five-state `deriveCardState` matrix, LibraryCard placeholder variants (cloud badge / 下载中 {n}% bar+caption with tap disabled / failed retry / 未同步 55%-grey with explanatory toast), 同步此书 MenuItem above 删除 (Check/CloudUpload icon, 正在上传… disabled state), LibraryGrid syncView threading, App handlers for download-adopt-refresh and toggle-then-syncNow.
- **Reader surfaces (SYNC-02/SYNC-05):** `traceFromOpenResult`/`syncUndoBody` pure derivation (「{设备名称}」上读到了 {n}%，已自动跳到最远位置。 verbatim), session-scoped trace pill in the undo slot with priority, SyncUndoDialog replaying the locator returned by sync_revert_jump, `setSyncTrace(null)` as captureUndo's first line; annotation merge stays UI-silent (冲突副本 renders via the existing text-node path — zero code change, grep-asserted).
- **Backend upload pump (orchestrator-directed):** `pending_uploads` scan + `pump_pending_uploads` + `upload_pending_book` ([hash8] collision retry) + `local_path_for_upload` (SAF cache staging, always reaped) in commands.rs; wired at the tail of `sync_now_inner` with a post-success re-push; 4 wiremock tests prove the scan filters, the upload happens, completed books are skipped, a failure is recorded while others continue, and the collision retry never overwrites a foreign file.

## Task Commits

No commits by this executor — wave protocol leaves all git mutations to the orchestrator after wave verification. Working tree holds the full plan diff (`git status`: 11 modified + 15 created paths listed above; the two untracked `.planning` files `05-PATTERNS.md` / `v1.0-MILESTONE-AUDIT.md` predate this run and are not mine).

## Files Created/Modified

- `src/sync/sync-api.ts` — NEW: the ten contract commands, typed; password inbound-only; sync_test_and_save wrapped in `{input}` per the 07-01 deviation.
- `src/sync/sync-status.ts` / `.test.ts` — NEW: store + §C pure mappers (21 tests).
- `src/sync/scheduler.ts` / `.test.ts` — NEW: close-gate (4 tests).
- `src/sync/sync-form.ts` / `.test.ts` — NEW: URL validation, D-104 path normalization, client-side-only invalid copy (5 tests).
- `src/sync/SyncStatusButton.tsx` — NEW: §1 button + §C dot.
- `src/sync/SyncSettingsSheet.tsx` — NEW: §2 sheet + disconnect confirm.
- `src/library/sync-card-state.ts` / `.test.ts` — NEW: §3 five-state matrix (6 tests).
- `src/library/types.ts` — `fileLocal?`/`fileSyncEnabled?` + `file_sync_enabled` row field.
- `src/library/library-store.ts` — V8 SELECT column, sentinel derivation, `adoptSyncedFile`.
- `src/library/LibraryCard.tsx` — placeholder variants + 同步此书 MenuItem (same family, extended in place).
- `src/library/LibraryGrid.tsx` — SyncCardViewMaps + per-item card props.
- `src/library/LibrarySettingsSheet.tsx` — §6 同步 section (both configured states).
- `src/reader/SettingsSheet.tsx` — optional `syncSection` slot after the 书库 block.
- `src/reader/sync-jump.ts` / `.test.ts` — NEW: trace derivation + verbatim dialog body (8 tests).
- `src/reader/ReaderBottomBar.tsx` — sync pill slot (priority over undo pill).
- `src/reader/SyncUndoDialog.tsx` — NEW: 撤回原位/保留进度 dialog.
- `src/reader/FoliateView.tsx` — open/close/background hooks, trace apply effect, dialog wiring.
- `src/App.tsx` — store wiring, SyncStatusButton, failure toasts, download/toggle handlers, sheet mounts.
- `src/App.css` — dot pulse/spin (reduced-motion safe), placeholder card styles, sync pill icon accent.
- `src-tauri/src/sync/commands.rs` — Part 4: the pending-upload pump + sync_now_inner wiring.
- `src-tauri/tests/sync_pending_uploads.rs` — NEW: 4 wiremock scenarios.

## Decisions Made

See key-decisions above — the load-bearing ones: the upload pump lives in `sync_now_inner` (not a new trigger — D-90's manual button + the post-enable call share it); per-book upload failure is recorded in `last_error` and the pump continues (a broken book must not starve the others or fail the state round); one extra `reconcile_push` after ≥1 completed upload so the metadata reaches peers in the same run; the trace jump waits for `status==='reading'` via an effect because pull-resolution and book-open race; the store gained a `refresh()` for connect/disconnect re-init; MUI v9 `ListItemText` uses `slotProps.primary` (primaryTypographyProps removed).

## Deviations from Plan

1. **ORCHESTRATOR-DIRECTED BACKEND WIRING (the big one):** the plan's files_modified lists no Rust, but the orchestrator found nothing in production called `fileplane::upload_book` (07-03's "upload scheduling is 07-04's" comment was stale). Implemented exactly as directed: pending-upload scan + sequential pump in `sync_now_inner` after pull+push, progress via the existing bridge (TransferKind::Upload), per-book failure → `last_error` + continue, SAF staging via cache temp file, plus a wiremock integration suite (enabled→uploads / completed→skipped / failed→recorded+continue / collision→[hash8]). Documented here as directed.
2. **Post-upload re-push** (one extra `reconcile_push` when ≥1 upload completed): without it the fresh `file_sync.remote_path/size/hash` would only ride some LATER push, leaving peer placeholder cards non-downloadable (该书没有可下载的远端文件) after the enabling sync run.
3. **`[hash8]` collision retry in `upload_pending_book`** — the D-105 naming contract requires a caller decision on RemoteConflict; the pump tries the plain name, then the hash8 name, then records the failure.
4. **Trace apply via `status==='reading'` effect** instead of jumping inside the syncBookOpened `.then` — pull and book-open race; a once-per-mount ref (`syncTraceAppliedRef`) prevents double application on reopenTick.
5. **Close-gate re-arm semantics:** the reopenTick (简繁/词不拆行 re-open) teardown consumes one close push and the re-run's ensure path re-arms — an acceptable EXTRA push, never a missed one; `sync_book_opened` stays once-per-mount via `syncOpenedRef`. `pushSyncClose` also skips `work-*` fallback ids (real-ensure path only).
6. **`createSyncStatusStore.refresh()` added** (not in the plan's export list) — connect/disconnect/save must re-run the snapshot load.
7. **MUI v9 API:** `ListItemText` `slotProps.primary` replaces the removed `primaryTypographyProps`.
8. **Task 5 (checkpoint) NOT run — DEFERRED, not waived** (orchestrator instruction; see Deferred section).

## Issues Encountered

- MUI v9 removed `ListItemText.primaryTypographyProps` (tsc) → `slotProps.primary`.
- TS flow-narrowing refused calling a closure-captured listener in the store test → boxed capture pattern.
- One self-inflicted comment-drop in FoliateView (restored the max-block-size comment immediately).
- No logic defects beyond the above; every suite green on first full runs except the two compile fixes.

## Known Stubs

None in the shipped paths. Deliberate seams unchanged from 07-03: `abort_upload` still has no IPC surface (user-cancel is a later scheduler feature); the Nextcloud capability probe remains per-upload (batching belongs to a future scheduler refinement).

## Deferred (Task 5 checkpoint — user-deferred to the end-of-phase manual batch)

The ENTIRE Task 5 is deferred, not waived. Until it runs, every SYNC-01..05 requirement is code-complete but DEVICE-UNVERIFIED:

- [ ] Full automated gate on-device: AVD production APK (`pnpm tauri android build --debug --target x86_64 --apk`, `adb install -r`, force-stop + cold start).
- [ ] AVD checklist 1-5: sync sheet finger scroll (touch gate #3); status dot three states + failure toast never-modal; placeholder flow end-to-end (cloud card → 下载中 {n}% → adopted local book, opens with progress/annotations); undo dialog 撤回原位 to the exact pre-jump position; keychain survives relaunch (password field empty + 凭据已保存在系统密钥环).
- [ ] Real-server matrix (D-94, one full round each): 坚果云 free (incl. 503/429 rate-limit backoff + verbatim 同步失败：服务器限流，请稍后重试 toast); proxied Nextcloud with a >10MB book (chunk v2); dufs over plain HTTP with the 允许 HTTP switch ON (streaming whole-PUT, generic-server class).
- [ ] Every sync_* command exercised on the production APK with zero capabilities edits (phase posture).

Also still open from earlier plans: the 07-01 Task 5 AVD keychain checklist (same batch).

## Next Phase Readiness

- **Phase gate (/gsd-verify-work):** run the deferred batch above; record the matrix table (server, version, round outcome, ETag/412/限流 quirks) in this file or the phase validation doc.
- **UI contract consumed:** all copy verbatim from 07-UI-SPEC; the only sync Dialogs are user-initiated (撤回弹窗, 断开连接确认); failures = dot + transition toast only.

## Requirements Final State

| Req | State |
|-----|-------|
| SYNC-01 | UI + engine code-complete (sheet, forced test, keychain captions); AVD keychain gate deferred |
| SYNC-02 | Open/close/background/manual triggers + dot/toast wired over the 07-02 engine; device verify deferred |
| SYNC-03 | Engine 07-02; UI silent by design; 冲突副本 text-node path asserted (no change) |
| SYNC-04 | 同步此书 toggle + placeholder download-adopt + the upload pump wiring; device verify deferred |
| SYNC-05 | Trace pill + 撤回 dialog driven by replacedLocal / sync_revert_jump response; device verify deferred |

## Self-Check: PASSED (desktop side; device batch deferred)

- `pnpm test` — 29 files / 212 tests green (incl. new: scheduler 4, sync-status 21, sync-form 5, sync-card-state 6, sync-jump 8).
- `pnpm exec tsc --noEmit` — clean. `pnpm build` — green (pre-existing chunk-size warning only).
- `RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc cargo test -p pillowtome sync` — 54/54 green (18 lib + 3 migration + 5 e2e + 9 fileplane + 4 pending_uploads + 15 reconcile).
- `RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc cargo test --workspace` — 174 passed / 0 failed across all 13 suites (full log: target/tmp/cargo-workspace-0704.log).
- Acceptance greps ALL pass: sync_book_opened/closed call sites (3/2); zero setInterval in sync modules; visibilitychange wired; warn-only sync handlers in FoliateView; SyncStatusButton before the gear; aria-busy; dot CSS + reduced-motion; 同步 section copy ×3; syncSection slot; zero Dialog in status modules; ALL §2 verbatim strings present; client-side-only error mapping (backend classes NOT re-mapped); touch-gate greps (min(85vh,720px)==1, pan-y≥1, type="password"==1); console.log==0 + dangerouslySetInnerHTML==0 in sync modules; file_sync_enabled/sentinel/adoptSyncedFile greps; 同步此书 above 删除 + 正在上传…; cloud icons; 已从其他设备同步 ×4; 撤回原位/保留进度; setSyncTrace(null) first line of captureUndo; verbatim toasts (已开启/已关闭同步《》, 下载失败…, 该书未开启文件同步…).
- Forbidden diffs empty: `src-tauri/capabilities/*`, `src-tauri/src/migrations.rs`, `Cargo.toml`/`Cargo.lock`, `package.json` — untouched.

---
*Phase: 07-webdav-self-hosted-sync*
*Completed: 2026-07-18*
