//! WebDAV sync (SYNC-01..05) — Tauri-side IO spine.
//!
//! The pure sync core (remote serde model, path jail, merge engine) lives in
//! `pillowtome_core::sync` (07-00). This module owns everything that touches
//! the outside world: the OS keychain credential store ([`credentials`]), the
//! `reqwest_dav` transport with the D-95 TLS/http gates ([`transport`]), and
//! the IPC command surface ([`commands`]).
//!
//! Invariants that span every submodule:
//!
//! - The WebDAV password lives only in the OS keychain. It never crosses IPC
//!   back to the WebView, never lands in SQLite, and never appears in a serde
//!   output struct, a `Debug` string, or a log line.
//! - Errors shown to the user are only the classified 简体中文 strings of
//!   [`SyncError::user_message`] (D-97) — raw OS/server error text is a leak
//!   channel and is never surfaced.

pub mod commands;
pub mod credentials;
pub mod transport;

use std::time::{SystemTime, UNIX_EPOCH};

/// The classified sync error taxonomy (D-97 + rate-limit + keyring classes).
///
/// Wiremock integration tests assert on these variants directly, so the enum
/// derives `PartialEq`/`Eq`. Users only ever see [`SyncError::user_message`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncError {
    /// Server unreachable (connect/timeout/DNS/unparseable URL).
    Unreachable,
    /// 401 — bad username or app password.
    Auth,
    /// TLS certificate validation failed.
    Certificate,
    /// 403 — no write permission on the remote directory.
    Permission,
    /// 429/503 — server rate limit (坚果云 免费档 throttling); retry with
    /// exponential backoff, then surface the class.
    RateLimited,
    /// No usable OS keychain backend (e.g. Linux without Secret Service).
    KeyringUnavailable,
    /// `http://` was refused because the 允许 HTTP switch is off (D-95).
    HttpNotAllowed,
    /// 412 on a conditional write — remote state changed under us; the 07-02
    /// state plane consumes this as its re-pull-merge-retry seam.
    RemoteChanged,
    /// Anything else. Never leaks raw internals to the user.
    Internal,
}

impl SyncError {
    /// The exact UI-SPEC copy for each class — do not paraphrase; the settings
    /// UI and toasts render these strings verbatim.
    pub fn user_message(&self) -> &'static str {
        match self {
            SyncError::Unreachable => "无法连接到服务器，请检查地址",
            SyncError::Auth => "认证失败，请检查用户名和应用密码",
            SyncError::Certificate => "证书校验失败，可开启「信任自签名证书」",
            SyncError::Permission => "没有目录写入权限，请检查路径",
            SyncError::RateLimited => "服务器限流，请稍后重试",
            SyncError::KeyringUnavailable => "系统密钥环不可用，无法保存凭据",
            // Plan-owned copy: UI-SPEC defines the switch warning, not the
            // refusal; uses UI-SPEC vocabulary 明文 HTTP / 允许 HTTP / 仅局域网.
            SyncError::HttpNotAllowed => "明文 HTTP 连接已拒绝，请仅在可信局域网内开启「允许 HTTP」",
            SyncError::RemoteChanged | SyncError::Internal => "同步失败，请稍后重试",
        }
    }
}

/// Normalize a user-entered server URL: trim whitespace, strip ALL trailing
/// slashes. Single normalization point so the keychain account key and the
/// transport host always agree (Pitfall 8 defensive normalization starts here).
pub fn normalize_server_url(input: &str) -> String {
    input.trim().trim_end_matches('/').to_string()
}

/// Unix epoch milliseconds for `sync_config.updated_at`.
pub(crate) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
