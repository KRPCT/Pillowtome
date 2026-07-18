//! Sync IPC commands (SYNC-01) — part 1: config read / test-and-save /
//! disconnect.
//!
//! Security invariants (D-97 / T-07-01-01):
//!
//! - The password rides IN on [`SyncConfigInput`] (deserialize-only, redacted
//!   `Debug`) and never rides back OUT: the only output shape is
//!   [`PublicSyncConfig`], which is password-free by construction.
//! - A config is persisted only after a live `test_and_bootstrap` passes —
//!   a failed test saves nothing: no `sync_config` row, no keychain entry
//!   (不允许错误配置静默保存).
//! - The keychain write happens BEFORE the config row, so a row without a
//!   secret can never exist.
//! - All SQL goes through the plugin's shared pool with `$n` binds only.
//! - Nothing in this module prints or logs; the password never reaches any
//!   output channel.

use serde::Deserialize;
use std::time::Duration;
use tauri::{AppHandle, Manager};

use super::credentials::{self, PublicSyncConfig};
use super::transport::{self, TransportConfig};
use super::{normalize_server_url, now_ms, SyncError};

/// The exact pool key the SQL plugin registers — matches `lib.rs`
/// `.add_migrations("sqlite:pillow.db", …)` and the frontend `DB_PATH`.
const DB_URL: &str = "sqlite:pillow.db";

/// Reuse `tauri_plugin_sql::DbInstances` — the plugin's shared pool map and
/// the app's single SQLite binding (Pitfall 6; RESEARCH Assumption A4).
/// Returns `None` when the plugin has no pool for [`DB_URL`] yet (the frontend
/// opens the DB on startup; a sync command racing ahead of it treats the
/// config as absent instead of opening a second binding — the documented A4
/// fallback would route these writes through the frontend plugin-sql path if
/// pool access ever proves impossible).
async fn db_pool(app: &AppHandle) -> Option<sqlx::SqlitePool> {
    let instances = app.state::<tauri_plugin_sql::DbInstances>();
    let lock = instances.0.read().await;
    match lock.get(DB_URL) {
        Some(tauri_plugin_sql::DbPool::Sqlite(pool)) => Some(pool.clone()),
        _ => None,
    }
}

/// IPC input for [`sync_test_and_save`]. The password deserializes IN and is
/// never serialized back OUT (T-07-01-01); `Debug` is manual so it can never
/// print the secret either.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfigInput {
    pub server_url: String,
    pub username: String,
    pub password: String,
    pub remote_path: Option<String>,
    pub allow_http: Option<bool>,
    pub trust_self_signed: Option<bool>,
    pub device_name: Option<String>,
}

impl std::fmt::Debug for SyncConfigInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SyncConfigInput")
            .field("server_url", &self.server_url)
            .field("username", &self.username)
            .field("password", &"***")
            .field("remote_path", &self.remote_path)
            .field("allow_http", &self.allow_http)
            .field("trust_self_signed", &self.trust_self_signed)
            .field("device_name", &self.device_name)
            .finish()
    }
}

/// Read the current sync configuration for the settings UI.
///
/// Wire shape (camelCase, phase-wide contract): `{configured, serverUrl,
/// username, remotePath, allowHttp, trustSelfSigned, deviceName,
/// keyringAvailable}` — never any secret. A config row whose keychain entry
/// is unreadable reports `configured: false` so the UI re-asks for the
/// password instead of pretending; both paths carry the `keyring_available`
/// probe so the UI can disable 测试并保存 up front with the
/// 系统密钥环不可用 caption instead of failing at save time.
#[tauri::command]
pub async fn sync_get_config(app: AppHandle) -> Result<PublicSyncConfig, String> {
    let keyring_available = credentials::keyring_available();
    let Some(pool) = db_pool(&app).await else {
        return Ok(PublicSyncConfig::unconfigured(keyring_available));
    };
    let row: Option<(String, String, String, bool, bool, Option<String>)> = sqlx::query_as(
        "SELECT server_url, username, remote_path, allow_http, trust_self_signed, device_name \
         FROM sync_config WHERE id = 'config'",
    )
    .fetch_optional(&pool)
    .await
    .map_err(|_| SyncError::Internal.user_message().to_string())?;
    let Some((server_url, username, remote_path, allow_http, trust_self_signed, device_name)) =
        row
    else {
        return Ok(PublicSyncConfig::unconfigured(keyring_available));
    };
    Ok(PublicSyncConfig {
        configured: credentials::is_configured(&server_url, &username),
        server_url: Some(server_url),
        username: Some(username),
        remote_path,
        allow_http,
        trust_self_signed,
        device_name,
        keyring_available,
    })
}

/// The D-97 forced gate: live-test the server, then persist. On `Ok` the
/// frontend shows 连接成功，已保存 (UI-SPEC); this command returns only
/// success or one of the classified [`SyncError::user_message`] strings.
#[tauri::command]
pub async fn sync_test_and_save(app: AppHandle, input: SyncConfigInput) -> Result<(), String> {
    // 1) In-memory transport config, D-95 defaults applied, URL normalized.
    let server_url = normalize_server_url(&input.server_url);
    let mut cfg = TransportConfig::new(
        server_url.clone(),
        input.username.clone(),
        input.password.clone(),
    );
    cfg.remote_path = input
        .remote_path
        .clone()
        .unwrap_or_else(|| "pillowtome/".to_string());
    cfg.allow_http = input.allow_http.unwrap_or(false);
    cfg.trust_self_signed = input.trust_self_signed.unwrap_or(false);

    // 2) Forced live test with rate-limit backoff. Any failure persists
    //    NOTHING — no sync_config row, no keychain entry.
    let client = transport::build_client(&cfg).map_err(|e| e.user_message().to_string())?;
    let root = cfg.remote_path.clone();
    transport::with_rate_limit_retry(Duration::from_millis(500), || {
        transport::test_and_bootstrap(&client, &root)
    })
    .await
    .map_err(|e| e.user_message().to_string())?;

    // 3) Keychain BEFORE the config row — KeyringUnavailable aborts here so a
    //    row without a secret can never exist (no half-configured state).
    credentials::save_password(&server_url, &input.username, &input.password)
        .map_err(|e| e.user_message().to_string())?;

    // 4) Upsert the single config row. If this fails after the keychain
    //    write, the orphaned keychain entry is harmless: the next save
    //    overwrites it and sync_disconnect cleans it.
    let pool = db_pool(&app)
        .await
        .ok_or_else(|| SyncError::Internal.user_message().to_string())?;
    sqlx::query(
        "INSERT INTO sync_config (id, server_url, username, remote_path, allow_http, \
         trust_self_signed, device_name, updated_at) \
         VALUES ('config', $1, $2, $3, $4, $5, $6, $7) \
         ON CONFLICT(id) DO UPDATE SET server_url = excluded.server_url, \
         username = excluded.username, remote_path = excluded.remote_path, \
         allow_http = excluded.allow_http, trust_self_signed = excluded.trust_self_signed, \
         device_name = excluded.device_name, updated_at = excluded.updated_at",
    )
    .bind(&server_url)
    .bind(&input.username)
    .bind(&cfg.remote_path)
    .bind(i64::from(cfg.allow_http))
    .bind(i64::from(cfg.trust_self_signed))
    .bind(&input.device_name)
    .bind(now_ms())
    .execute(&pool)
    .await
    .map_err(|_| SyncError::Internal.user_message().to_string())?;
    Ok(())
}

/// Disconnect: remove the local config row and the OS-keychain credential.
/// Remote data is retained — only the local machine's configuration is removed
/// (UI-SPEC: 仅移除本机的服务器配置与凭据。服务器上的数据保留). Idempotent:
/// no row means there is nothing to do.
#[tauri::command]
pub async fn sync_disconnect(app: AppHandle) -> Result<(), String> {
    let Some(pool) = db_pool(&app).await else {
        return Ok(());
    };
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT server_url, username FROM sync_config WHERE id = 'config'")
            .fetch_optional(&pool)
            .await
            .map_err(|_| SyncError::Internal.user_message().to_string())?;
    let Some((server_url, username)) = row else {
        return Ok(());
    };
    sqlx::query("DELETE FROM sync_config WHERE id = 'config'")
        .execute(&pool)
        .await
        .map_err(|_| SyncError::Internal.user_message().to_string())?;
    credentials::delete_password(&server_url, &username)
        .map_err(|e| e.user_message().to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_deserializes_camelcase_with_defaults_absent() {
        let input: SyncConfigInput = serde_json::from_str(
            r#"{"serverUrl":"https://dav.example.com","username":"u","password":"p"}"#,
        )
        .expect("camelCase input deserializes");
        assert_eq!(input.server_url, "https://dav.example.com");
        assert_eq!(input.username, "u");
        assert_eq!(input.password, "p");
        assert!(input.remote_path.is_none());
        assert!(input.allow_http.is_none());
        assert!(input.trust_self_signed.is_none());
        assert!(input.device_name.is_none());
    }

    #[test]
    fn input_debug_redacts_the_password() {
        use std::fmt::Write as _;
        let input: SyncConfigInput = serde_json::from_str(
            r#"{"serverUrl":"https://dav.example.com","username":"alice","password":"s3cret"}"#,
        )
        .expect("camelCase input deserializes");
        let mut dbg = String::new();
        write!(&mut dbg, "{input:?}").expect("write to string");
        assert!(dbg.contains("***"));
        assert!(!dbg.contains("s3cret"));
    }
}
