//! OS keychain credential store (SYNC-01 / RESEARCH Pattern 4).
//!
//! The WebDAV password lives ONLY here — Windows Credential Manager, macOS
//! Keychain, Secret Service, or Android Keystore — keyed by a deterministic
//! account key derived from the normalized server URL + username. It is never
//! written to SQLite, never synced to the remote, and never serialized across
//! IPC: the only config shape the frontend ever receives is
//! [`PublicSyncConfig`], which has no password field by construction.
//!
//! Nothing in this module logs; the password never appears in a `Debug`
//! string, an error message, or a toast.

use serde::Serialize;

use super::{normalize_server_url, SyncError};

/// Keychain service name — verbatim per RESEARCH Pattern 4.
const KEYRING_SERVICE: &str = "pillowtome";

/// Deterministic keychain account key: save/get/delete always derive the same
/// key for the same (normalized) server + username pair; changing either one
/// produces a distinct entry (stale entries are cleaned by `sync_disconnect`).
pub fn account_key(server_url: &str, username: &str) -> String {
    format!("{}::{}", normalize_server_url(server_url), username)
}

/// Android only: register the android-native-keyring-store named store as the
/// keyring_core default, once per process.
///
/// GROUNDING DISCOVERY (not in the plan text): keyring 4.1.5's `v1` facade
/// auto-registers a store on macOS/Windows/Linux-Secret-Service but has NO
/// Android arm (`v1.rs set_credential_store` compiles to a no-op there), so a
/// bare `keyring::Entry::new` on Android fails with `NoDefaultStore`. The
/// `android-native-keyring-store` feature only *links* the crate (providing
/// the `initializeNdkContext` JNI export the Keyring.kt shim calls); wiring it
/// into the v1 API is the app's job — same pattern as the crate's own `cli`
/// module (`use_android_native_store`). Both crates were already pinned in
/// Cargo.lock by the feature, so this adds dep edges only (D-13 holds).
/// Store names are unique per process — the `Once` prevents a double create.
#[cfg(target_os = "android")]
fn ensure_platform_store() -> Result<(), SyncError> {
    use std::sync::Once;
    static INIT: Once = Once::new();
    let mut result = Ok(());
    INIT.call_once(|| {
        result = match android_native_keyring_store::Store::new() {
            Ok(store) => {
                keyring_core::set_default_store(store);
                Ok(())
            }
            Err(_) => Err(SyncError::KeyringUnavailable),
        };
    });
    result
}

/// Desktop platforms: the keyring v1 facade registers its own store.
#[cfg(not(target_os = "android"))]
fn ensure_platform_store() -> Result<(), SyncError> {
    Ok(())
}

/// Build the keychain entry for (server, username), or report the keychain as
/// unavailable. Never touches the password itself.
fn entry(server_url: &str, username: &str) -> Result<keyring::Entry, SyncError> {
    ensure_platform_store()?;
    keyring::Entry::new(KEYRING_SERVICE, &account_key(server_url, username))
        .map_err(|_| SyncError::KeyringUnavailable)
}

/// Persist the password in the OS keychain. Any failure is reported as
/// [`SyncError::KeyringUnavailable`] so the caller can abort the config save
/// (a `sync_config` row without a secret must never exist).
pub fn save_password(server_url: &str, username: &str, password: &str) -> Result<(), SyncError> {
    entry(server_url, username)?
        .set_password(password)
        .map_err(|_| SyncError::KeyringUnavailable)
}

/// Read the password back (transport construction in later waves). A missing
/// entry after a saved config row is an inconsistent state — not a user typo —
/// so `NoEntry` maps to [`SyncError::Internal`], never to `Auth`. Everything
/// else is a keychain-backend problem.
pub fn get_password(server_url: &str, username: &str) -> Result<String, SyncError> {
    entry(server_url, username)?
        .get_password()
        .map_err(|e| match e {
            keyring::Error::NoEntry => SyncError::Internal,
            _ => SyncError::KeyringUnavailable,
        })
}

/// Delete the password. Idempotent: a missing entry is the desired end state,
/// so `NoEntry` is success (disconnect can run against an already-clean
/// keychain); any other error means the keychain backend failed.
pub fn delete_password(server_url: &str, username: &str) -> Result<(), SyncError> {
    match entry(server_url, username)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(SyncError::KeyringUnavailable),
    }
}

/// True when a non-empty password is retrievable for (server, username).
/// Never exposes or logs the password itself.
pub fn is_configured(server_url: &str, username: &str) -> bool {
    get_password(server_url, username)
        .map(|p| !p.is_empty())
        .unwrap_or(false)
}

/// Soft probe for a usable OS keychain backend, without touching any real
/// entry: build a throwaway entry and read it. `Ok` or `NoEntry` means the
/// backend is present (merely empty); any other error — or the entry build
/// itself failing — means no usable provider (the Linux no-Secret-Service
/// case). Feeds `PublicSyncConfig.keyring_available` so the settings UI can
/// disable 测试并保存 up front instead of failing at save time.
pub fn keyring_available() -> bool {
    if ensure_platform_store().is_err() {
        return false;
    }
    match keyring::Entry::new(KEYRING_SERVICE, "pillowtome-probe") {
        Ok(probe) => match probe.get_password() {
            Ok(_) | Err(keyring::Error::NoEntry) => true,
            Err(_) => false,
        },
        Err(_) => false,
    }
}

/// The ONLY config shape that ever crosses IPC back to the frontend.
///
/// Password-free by construction (T-07-01-01): there is no field that could
/// carry the secret, so no serde/log/toast path can leak it. Wire names are
/// camelCase (house IPC convention), e.g. `keyring_available` →
/// `keyringAvailable`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicSyncConfig {
    pub configured: bool,
    pub server_url: Option<String>,
    pub username: Option<String>,
    pub remote_path: String,
    pub allow_http: bool,
    pub trust_self_signed: bool,
    pub device_name: Option<String>,
    pub keyring_available: bool,
}

impl PublicSyncConfig {
    /// The shape returned when no `sync_config` row exists (or the DB pool is
    /// not reachable yet): not configured, default remote root, both D-95
    /// switches off, the keychain probe result passed through.
    pub fn unconfigured(keyring_available: bool) -> Self {
        Self {
            configured: false,
            server_url: None,
            username: None,
            remote_path: "pillowtome/".to_string(),
            allow_http: false,
            trust_self_signed: false,
            device_name: None,
            keyring_available,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // NOTE: no real keychain reads/writes here (and no keyring_available()
    // probe either) — on a dev/CI machine those touch the real OS credential
    // store and are not hermetic. The keyring round-trip is verified by the
    // Task 5 AVD gate and manual desktop smoke instead.

    #[test]
    fn normalize_server_url_trims_and_strips_trailing_slashes() {
        assert_eq!(
            normalize_server_url("  https://dav.example.com/dav/  "),
            "https://dav.example.com/dav"
        );
        assert_eq!(
            normalize_server_url("https://dav.example.com///"),
            "https://dav.example.com"
        );
        assert_eq!(
            normalize_server_url("https://dav.example.com"),
            "https://dav.example.com"
        );
    }

    #[test]
    fn account_key_is_deterministic_and_discriminating() {
        let a = account_key("https://dav.example.com/", "alice");
        let b = account_key("https://dav.example.com", "alice");
        assert_eq!(a, b, "trailing slash must not change the key");
        assert_ne!(
            account_key("https://dav.example.com", "bob"),
            a,
            "username change → distinct entry"
        );
        assert_ne!(
            account_key("https://other.example.com", "alice"),
            a,
            "server change → distinct entry"
        );
    }

    #[test]
    fn unconfigured_defaults_pass_probe_result_through() {
        let on = PublicSyncConfig::unconfigured(true);
        assert!(!on.configured);
        assert_eq!(on.remote_path, "pillowtome/");
        assert!(!on.allow_http);
        assert!(!on.trust_self_signed);
        assert!(on.server_url.is_none());
        assert!(on.username.is_none());
        assert!(on.device_name.is_none());
        assert!(on.keyring_available);

        let off = PublicSyncConfig::unconfigured(false);
        assert!(!off.configured);
        assert!(!off.keyring_available);
    }
}
