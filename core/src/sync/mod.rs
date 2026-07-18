//! WebDAV sync pure core (plan 07-00, SYNC-02/SYNC-03/SYNC-05).
//!
//! Everything here is **pure** — no IO, no network, no SQLite — so the whole
//! module is unit-testable off-device. The IO plane (reqwest_dav transport,
//! keychain credentials, reconcile writes through the tauri-plugin-sql pool)
//! lives in `src-tauri`'s sync plane (plans 07-01+).
//!
//! - [`model`] — serde types for the remote layout (07-RESEARCH Pattern 1):
//!   `pillowtome/{manifest.json, state/<device_id>.json, devices/<device_id>.json}`.
//! - [`remote`] — remote-path hygiene: the single point every WebDAV path is
//!   born from, jailed under the configured root (T-07-00-01).
//! - [`merge`] — the deterministic merge engine: set-union drivers that never
//!   drop a single-side record, tombstone remove-wins, per-record `hash_algo`.

pub mod merge;
pub mod model;
pub mod remote;
