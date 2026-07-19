---
phase: 07-webdav-self-hosted-sync
plan: 01
subsystem: sync
tags: [webdav, sync, keyring, keychain, reqwest-dav, wiremock, tls, d-95, d-97, ipc, sqlx, android, ndk-context, serde]

# Dependency graph
requires:
  - phase: 07-webdav-self-hosted-sync/07-00
    provides: exact-pinned deps (reqwest_dav =0.3.3 / keyring =4.1.5 / dev wiremock =0.6.5) + committed Cargo.lock, SCHEMA_V8 sync_config/sync_state/sync_file_state tables, core/src/sync skeleton (remote layout contract, manifest body shape)
provides:
  - src-tauri/src/sync module: SyncError taxonomy with the locked Chinese class strings + normalize_server_url + now_ms
  - credentials.rs: keyring wrapper (service "pillowtome", account key = normalized url::username), keyring_available() probe, PublicSyncConfig (password-free by construction, camelCase wire names incl. keyringAvailable), Android keyring_core default-store registration (grounding discovery)
  - transport.rs: build_client (D-95 http/self-signed independent gates), classify/classify_http_status (D-97 classes), with_rate_limit_retry (503/429 backoff, 3 attempts), probe/bootstrap_dirs/put_manifest_if_absent/test_and_bootstrap (If-None-Match:* + verbatim ETag capture)
  - tests/sync_transport.rs: 7-test wiremock matrix incl. the If-None-Match wire assertion and expect(3) backoff observation
  - IPC commands sync_get_config / sync_test_and_save / sync_disconnect (D-97 forced test, keychain-only password, shared DbInstances pool) registered in generate_handler!
  - Android ndk-context shim (Keyring.kt + MainActivity init + proguard keep) + launch-time keychain self-test — AVD spike RUN on 2026-07-19: caught+fixed a @JvmStatic JNI-mangling launch crash; launch + Keystore round-trip proven on emulator-5554 (see Task 5 Spike Outcome)
affects: [07-02-state-plane, 07-03-file-plane, 07-04-conflict-scheduler-ui]

# Tech tracking
tech-stack:
  added:
    - "Dep EDGES only, zero new packages (D-13; Cargo.lock diff = 4 lines, all inside the pillowtome package's dep list): reqwest =0.13.4, tokio =1.52.3 +time feature, sqlx =0.8.6 promoted dev→main, serde_json =1.0.150 (dev)"
    - "Android target-gated edges (grounding discovery): android-native-keyring-store =1.0.0 + keyring-core =1.0.0 — both already locked via keyring's feature; needed to register the store v1 never registers"
  patterns:
    - "Password containment by type: PublicSyncConfig has no password field; SyncConfigInput is Deserialize-only; TransportConfig/SyncConfigInput carry manual redacted Debug (password: \"***\"); zero println/eprintln in src-tauri/src/sync"
    - "Two independent D-95 gates: build_client refuses http unless allow_http; danger_accept_invalid_certs wired to trust_self_signed only"
    - "D-97 forced gate: save impossible without a passing probe→MKCOL dirs→conditional manifest PUT; keychain write BEFORE the config row so a row without a secret can never exist"
    - "Conditional writes via client.agent raw reqwest request (Pitfall 2) — the wiremock suite proves If-None-Match reaches the wire; ETag captured verbatim as an opaque token"
    - "Single SQLite binding: commands reuse tauri_plugin_sql::DbInstances pool (sqlite:pillow.db); no pool → treated as 'nothing persisted', never a second binding (A4)"

key-files:
  created:
    - src-tauri/src/sync/mod.rs
    - src-tauri/src/sync/credentials.rs
    - src-tauri/src/sync/transport.rs
    - src-tauri/src/sync/commands.rs
    - src-tauri/tests/sync_transport.rs
    - src-tauri/gen/android/app/src/main/java/io/crates/keyring/Keyring.kt
    - .planning/phases/07-webdav-self-hosted-sync/07-01-SUMMARY.md
  modified:
    - src-tauri/src/lib.rs
    - src-tauri/Cargo.toml
    - Cargo.lock
    - src-tauri/gen/android/app/src/main/java/com/pillowtome/app/MainActivity.kt
    - src-tauri/gen/android/app/proguard-rules.pro

key-decisions:
  - "GROUNDING DISCOVERY (Android blocker, fixed): keyring 4.1.5's v1 facade registers NO store on Android — Entry::new would fail NoDefaultStore; the android-native-keyring-store feature only links the crate. credentials.rs::ensure_platform_store() now registers the named store as the keyring_core default (Once per process), needing the two target-gated edges above. Without this the Task 5 AVD spike was guaranteed to fail"
  - "test_and_bootstrap probes the DAV root (\"/\"), not the configured root: on first connect the configured root does not exist yet — probing it would 404 before bootstrap_dirs creates it, making first-save impossible. Plan's probe signature/semantics unchanged; wiremock matrix unaffected"
  - "reqwest_dav 0.3.3 has no Depth::Zero variant (plan text references it) — depth-0 is spelled Depth::Number(0)"
  - "TransportConfig got a pub new(server_url, username, password) constructor: the password field is private, so struct literals cannot be built outside the module — the plan's test sketch (TransportConfig { .. }) was pseudo-code; commands/tests use new() + pub-field mutation"
  - "Capabilities untouched (grounded, per plan): app-defined commands run ungated on tauri 2.11.5 without an app ACL manifest; sync_* permission entries would panic at startup. Minimal surface = zero new plugin permissions"
  - "mkcol already-exists = HTTP 405|409 (RFC/sabre); 403 → Permission; any other status through classify"

patterns-established:
  - "Error surface = SyncError enum + user_message() with the exact locked Chinese strings; classify() never leaks raw OS/server text; wiremock asserts on enum variants, not strings"
  - "503/429 retry = with_rate_limit_retry(base, op) — 3 attempts max, base*2^attempt tokio::time::sleep backoff; wiremock expect(3) + server.verify() proves the wire count"
  - "db_pool(app) helper for plugin-pool reuse is the pattern 07-02's merge writes must follow ($n binds only, no format! in SQL)"

requirements-completed: [SYNC-01]

# Metrics
duration: ~55min
completed: 2026-07-18
---

# Phase 7 Plan 01: WebDAV Connect + Keychain Summary

**The WebDAV connect spine is landed and wire-proven: keychain-only credentials (password-free IPC types, redacted Debug, zero logging), the D-95 http/self-signed gates, the D-97 classified Chinese errors with 503 backoff, a 7-test wiremock matrix that proves If-None-Match reaches the wire, the first three IPC commands on the shared SQLite pool — and an Android keychain that survived its own spike: the AVD caught a `@JvmStatic` JNI-mangling launch crash, fixed and re-verified end-to-end with an on-device Keystore round-trip (see Task 5 Spike Outcome).**

## Performance

- **Duration:** ~55 min
- **Tasks:** 5 (4 auto + 1 checkpoint — code part only)
- **Files modified:** 12 (7 created, 5 modified)

## Accomplishments
- `src-tauri/src/sync/` module landed: `SyncError` taxonomy with the exact UI-SPEC Chinese strings (incl. plan-owned 明文 HTTP refusal copy), `normalize_server_url` single normalization point, `now_ms`.
- Keychain wrapper: `keyring::Entry::new("pillowtome", account_key)` with deterministic `normalize(url)::username` keys, idempotent delete, `keyring_available()` soft probe over a throwaway entry, and `PublicSyncConfig` — password-free by construction (wire: `{configured, serverUrl, username, remotePath, allowHttp, trustSelfSigned, deviceName, keyringAvailable}`).
- Transport: `build_client` with the two independent D-95 gates (http refused unless `allow_http`; `danger_accept_invalid_certs` wired only to `trust_self_signed`), two-layer classifier (status → class; reqwest source-chain TLS sniff → Certificate; connect/timeout → Unreachable), `with_rate_limit_retry` (3 attempts, exponential backoff), and `test_and_bootstrap` (probe → MKCOL root/books/state/devices → manifest `If-None-Match: *` PUT with verbatim ETag capture).
- 7-test wiremock matrix all green: 401→Auth, MKCOL 403→Permission, connect-refused→Unreachable, 503 retried exactly 3×→RateLimited, ETag `"\"v1-abc\""` captured verbatim, `If-None-Match: *` asserted ON THE WIRE, 412→already-exists.
- IPC: `sync_get_config` / `sync_test_and_save` / `sync_disconnect` registered in `generate_handler!`; D-97 forced gate (failed test persists nothing), keychain-before-row ordering, upsert via the plugin's `DbInstances` pool with `$n` binds; `sync_disconnect` is idempotent and retains remote data.
- Android spike code: `Keyring.kt` ndk-context shim (loads `pillowtome_lib`), one-line `MainActivity.onCreate` init, R8 `-keep class io.crates.keyring.**` — plus the Rust-side store registration the plan missed (see Decisions).

## Task Commits

No commits by this executor — wave protocol leaves all git mutations to the orchestrator after wave verification. Working tree holds the full plan diff (`git status`: 5 modified + 7 created paths listed above). **Commit caveat:** `src-tauri/gen/android/` is gitignored except two force-added files; `Keyring.kt` and `proguard-rules.pro` are NEW + ignored → the orchestrator must `git add -f` both (MainActivity.kt is already tracked).

## Files Created/Modified
- `src-tauri/src/sync/mod.rs` — module wiring + `SyncError` (9 variants) + `user_message()` locked strings + `normalize_server_url` + `now_ms`.
- `src-tauri/src/sync/credentials.rs` — `KEYRING_SERVICE="pillowtome"`, `account_key`, save/get/delete (keyring 4.x: `delete_credential`), `is_configured`, `keyring_available()` probe, `PublicSyncConfig` + `unconfigured`, Android `ensure_platform_store()`; 3 unit tests.
- `src-tauri/src/sync/transport.rs` — `TransportConfig` (private password, manual Debug, `new()` + `password()` accessor), `build_client`, `classify_http_status`/`classify`, `with_rate_limit_retry`, `probe`/`bootstrap_dirs`/`put_manifest_if_absent`/`test_and_bootstrap`, `join_url`; 6 unit tests.
- `src-tauri/src/sync/commands.rs` — `DB_URL`, `db_pool`, `SyncConfigInput` (Deserialize-only, redacted Debug), the three `#[tauri::command]` fns; 2 unit tests.
- `src-tauri/tests/sync_transport.rs` — 7 `#[tokio::test]` wiremock cases.
- `src-tauri/src/lib.rs` — `pub mod sync;` + three commands appended to `generate_handler!` after `fonts::remove_font`.
- `src-tauri/Cargo.toml` — dep edges: reqwest/tokio(time)/sqlx(promoted)/serde_json(dev)/android-native-keyring-store/keyring-core(target-gated).
- `Cargo.lock` — +4 lines (pillowtome package dep list only; zero new packages, zero version changes).
- `src-tauri/gen/android/app/src/main/java/io/crates/keyring/Keyring.kt` — NEW (gitignored — needs `git add -f`).
- `src-tauri/gen/android/app/src/main/java/com/pillowtome/app/MainActivity.kt` — one init line after `super.onCreate`; everything else byte-identical.
- `src-tauri/gen/android/app/proguard-rules.pro` — `-keep class io.crates.keyring.** { *; }` appended (gitignored — needs `git add -f`).

## Decisions Made
- **Android keyring store registration (grounding discovery, the big one):** verified against vendored keyring-4.1.5 `src/v1.rs` — `set_credential_store()` has macOS/Windows/Linux-Secret-Service arms only; on Android it compiles to a no-op, so `Entry::new` → `NoDefaultStore`. The `android-native-keyring-store` feature links the crate (and its `Java_io_crates_keyring_Keyring_00024Companion_initializeNdkContext` export) but never wires it into the v1 API. Fix: `ensure_platform_store()` in credentials.rs registers `android_native_keyring_store::Store::new()` via `keyring_core::set_default_store` exactly once (std::sync::Once) before any keyring call; no-op on desktop. Required two target-gated dep edges (`android-native-keyring-store =1.0.0`, `keyring-core =1.0.0`) — both already in Cargo.lock from 07-00, so D-13 holds (lock diff: 4 lines, edges only).
- **probe target in test_and_bootstrap:** probes `/` (DAV root), because the configured root cannot exist before bootstrap creates it; probing it would 404 → first save impossible. Documented in-code.
- **`Depth::Number(0)`** replaces the plan's `Depth::Zero` (absent in reqwest_dav 0.3.3's `Depth` enum).
- **Capabilities:** NO edits to `capabilities/*.json` (plan's grounded deviation followed; `git diff --stat src-tauri/capabilities/` is empty).
- **`now_ms` is `pub(crate)`** (used by commands for `updated_at`); the temporary dead-code warning disappeared once commands.rs landed.

## Deviations from Plan
1. **Android store registration + two target-gated dep edges** (above) — not in the plan text; required for the plan's own Task 5 gate to be passable. Flagging for 07-00's owner: the wave-0 dep pinning was correct but insufficient by itself for Android.
2. **`test_and_bootstrap` probes `/`** instead of the configured root (above) — the plan's literal sequence would fail first-run against any fresh server.
3. **`Depth::Number(0)`** for `Depth::Zero` (above).
4. **`TransportConfig::new()` constructor** — the plan's struct-literal sketches are impossible with a private field outside the defining module; behavior identical.
5. **The plan's Keyring.kt snippet carried a `@JvmStatic` that crashes at launch** — the spike caught it; see the section below.

## Task 5 AVD Spike Outcome (ran 2026-07-19, AVD `Pillowtome_Review` = emulator-5554, production-path debug APK)

The end-of-phase manual batch ran the spike — and it **caught a real bug immediately**, exactly the gate RESEARCH Pitfall 1 exists for.

**Crash (fresh-install first launch):** `java.lang.UnsatisfiedLinkError: No implementation found for void io.crates.keyring.Keyring.initializeNdkContext(android.content.Context) (tried Java_io_crates_keyring_Keyring_initializeNdkContext …)` at `MainActivity.onCreate`.

**Root cause (verified, not guessed):**
- The symbol WAS in the library: `nm -D target/x86_64-linux-android/debug/libpillowtome_lib.so` shows `T Java_io_crates_keyring_Keyring_00024Companion_initializeNdkContext` — no linking/feature/stripping problem; the crate was compiled in and exported.
- But the JVM looked up the OUTER-class name (`…_Keyring_initializeNdkContext`, no `00024Companion`). Cause: the plan's shim declared `@JvmStatic external fun` — Kotlin's `@JvmStatic` emits an outer-class static native forwarder, and the runtime resolves THAT name. The official crate README/lib.rs shim has **no `@JvmStatic`**: with the plain companion declaration, `Keyring.initializeNdkContext(...)` resolves through the Companion instance → the `00024Companion` mangled name → matches the export.
- So the crash was a Kotlin-side JNI-mangling mismatch in the shim I wrote from the plan's snippet, not an Android-store or ndk-context defect. The 07-01 Rust-side grounding discovery (v1 never registers an Android store) remains true and required.

**Fix (3 files):**
- `Keyring.kt` — removed `@JvmStatic` (official crate shape restored; comment documents why the shape is load-bearing).
- `MainActivity.kt` — added `Log.i` lines around the init call for logcat evidence.
- `credentials.rs` + `lib.rs` — added a launch-time `keychain_self_test()` (cfg-android): save → read-back-byte-identical → delete through the REAL credentials wrappers (a bare read probe can pass without touching Keystore encryption); verdict written to `app_data_dir/keychain-selftest.txt` + stderr. This is the spike's store-registration/Keystore evidence hook; 07-04+ may keep or drop it.

**Evidence (cold start, force-stop → monkey launch, pid 6461 alive at 15s):**
- logcat: `I Pillowtome: keyring ndk-context init: invoking native initializeNdkContext` → `I Pillowtome: keyring ndk-context init: native init OK` → `I Pillowtome: onWebViewCreate: WebView reparented into ActionMode suppressor` — native init returned cleanly and the app proceeded to WebView setup.
- `run-as com.pillowtome.app cat /data/data/com.pillowtome.app/keychain-selftest.txt` → `[pillowtome] keychain self-test: OK` — ndk-context + default-store registration + Keystore-backed save/read/delete round-trip all work on device.
- logcat scan: `FATAL EXCEPTION`/`UnsatisfiedLinkError` count = 0. (`setprop log.redirect-stdio` is SELinux-blocked on this image, so the Rust verdict is evidenced via the marker file rather than a logcat stderr line.)
- Desktop regression: `cargo test -p pillowtome sync` green (cfg-gated changes; desktop unaffected).

**Remaining manual items (user's UI-level review, NOT done in this spike):** no WebDAV server was configured here — checklist steps 5–8 of the original Task 5 (chrome://inspect IPC drive of `sync_test_and_save`/`sync_get_config`/`sync_disconnect` against a real server at `http://10.0.2.2:<port>`, password-hygiene logcat grep, config-survives-process-death via the UI path) remain for manual review. The launch-blocking defect class (Pitfall 1) those steps depended on is now cleared and the keychain write path is device-proven.

## Issues Encountered
- reqwest_dav 0.3.3 API reality vs plan text: no `Depth::Zero` (used `Depth::Number(0)`); high-level `put()` indeed cannot carry headers (manifest PUT goes through `client.agent` as planned).
- keyring 4.x renamed the delete method (`delete_credential`, not `delete_password`) — our public wrapper keeps the plan's `delete_password` name.
- One self-inflicted acceptance-grep failure: a doc comment in commands.rs named the banned log macros, breaking the plan's `grep -rc "println!|eprintln!" src-tauri/src/sync/ == 0` check — reworded; total is now 0.
- `git check-ignore` finding: `src-tauri/gen/android` is gitignored; the two new Android files need force-add at commit time (see Task Commits).

## Known Stubs
None in the shipped code paths. `SyncError::RemoteChanged` (412) is a deliberate seam consumed by 07-02's re-pull-merge-retry; `TransportConfig::password()` exists for 07-02/07-03 client construction from stored config. `keychain_self_test()` (cfg-android) is an intentional launch-time evidence hook from the Task 5 spike, not a stub.

## Next Phase Readiness
- **07-02 (state plane):** reuse `db_pool()`-style `DbInstances` access; build clients from the stored row + `credentials::get_password` + `TransportConfig::new`; conditional PUT seam is proven — `put_manifest_if_absent` shows the pattern (`client.agent` + `If-None-Match`, verbatim ETag); 412 → `SyncError::RemoteChanged` is the re-pull-merge-retry trigger; wrap sync runs in `with_rate_limit_retry(Duration::from_millis(500), …)`.
- **07-03 (file plane):** remote dirs `books/ state/ devices/` + `manifest.json` (`{"format":1,"app":"pillowtome"}`, format v1) are bootstrapped at connect time; large bodies must continue to go through `client.agent` streaming (Pitfall 4), never reqwest_dav `put(Vec<u8>)`.
- **07-04 (UI):** IPC contract (camelCase) — `sync_get_config()` → `{configured, serverUrl, username, remotePath, allowHttp, trustSelfSigned, deviceName, keyringAvailable}`; `sync_test_and_save({input: {serverUrl, username, password, remotePath?, allowHttp?, trustSelfSigned?, deviceName?}})` → `Ok(())` (show 连接成功，已保存) or `Err(<one of the classified Chinese strings>)` render verbatim; `sync_disconnect()` → `Ok(())`. When `keyringAvailable` is false, disable 测试并保存 with caption 系统密钥环不可用，无法保存凭据.
- **Keychain layout:** service `pillowtome`, account key = `normalize_server_url(url)::username`; Android store = keyring_core default (registered lazily, once) backed by SharedPreferences `keyring-default` + Keystore.
- **Android gate:** Task 5 spike PASSED at the keychain layer on 2026-07-19 (launch crash → root cause → fix → on-device Keystore round-trip; see Task 5 Spike Outcome). Only the UI-level WebDAV config steps remain for manual review.

## Self-Check: PASSED (desktop + Android keychain layer; UI-level WebDAV steps remain for manual review)

- `RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc cargo test -p pillowtome sync::credentials` — 3/3 green.
- `… cargo test -p pillowtome sync::transport` — 6/6 green.
- `… cargo test -p pillowtome --test sync_transport` — 7/7 green (incl. If-None-Match wire assertion + 503 expect(3) verify).
- `… cargo test -p pillowtome sync` — 11/11 green (Task 4 verify, both invocations green).
- `… cargo test --workspace` — exit 0, all 9 suites green, zero warnings (no regressions).
- `… cargo check --workspace` — green.
- `git diff --stat src-tauri/capabilities/` — EMPTY (grounded no-edit decision).
- `grep -rc "println!\|eprintln!" src-tauri/src/sync/` — totals 0.
- All per-task acceptance greps verified (KEYRING_SERVICE/pillowtome-probe counts, manifest byte-literal == 1, user_agent == 1, `ON CONFLICT(id) DO UPDATE` == 1, format! == 0, tauri::command == 3, no Serialize in commands.rs, PublicSyncConfig password-free, handler registration present).
- Task 5 AVD spike — RAN 2026-07-19 on emulator-5554: caught+fixed the `@JvmStatic` JNI-mangling launch crash; cold start clean (0 FATAL/UnsatisfiedLinkError), ndk-context init logged in logcat, on-device Keystore save/read/delete round-trip proven via the `keychain-selftest.txt` marker; UI-level WebDAV config steps deferred to manual review (see Task 5 Spike Outcome).

---
*Phase: 07-webdav-self-hosted-sync*
*Completed: 2026-07-18*
