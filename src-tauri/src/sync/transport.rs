//! WebDAV transport (SYNC-01) — client construction with the D-95 TLS/http
//! gates, the D-97 error classifier, rate-limit backoff, and the
//! test-and-bootstrap sequence that gates config persistence.
//!
//! Layering (RESEARCH Pattern 3): `reqwest_dav` high-level methods cover
//! header-less requests (PROPFIND/MKCOL); anything needing custom headers —
//! like the conditional manifest PUT — goes through the public `client.agent`
//! (a raw `reqwest::Client`), because the high-level API cannot send custom
//! headers (Pitfall 2). Both share the injected agent, so one TLS/timeout
//! policy applies to every request.

use std::time::Duration;

use super::{normalize_server_url, SyncError};

/// Remote format marker (remote format v1) — the exact body of `manifest.json`.
const MANIFEST_BODY: &[u8] = br#"{"format":1,"app":"pillowtome"}"#;

/// Everything needed to build a WebDAV client, in memory only.
///
/// NEVER `Serialize`/`Deserialize`: it is built in-memory inside commands from
/// the deserialize-only IPC input. `Debug` is implemented manually so the
/// password prints as `***` — a derived `Debug` on a struct holding a secret
/// is how credentials end up in logs (T-07-01-01).
pub struct TransportConfig {
    pub server_url: String,
    pub username: String,
    password: String,
    pub remote_path: String,
    pub allow_http: bool,
    pub trust_self_signed: bool,
}

impl TransportConfig {
    /// Build with the D-95 defaults (remote root `pillowtome/`, both switches
    /// off); callers adjust the public fields afterwards. The password is only
    /// ever readable through [`TransportConfig::password`].
    pub fn new(server_url: String, username: String, password: String) -> Self {
        Self {
            server_url,
            username,
            password,
            remote_path: "pillowtome/".to_string(),
            allow_http: false,
            trust_self_signed: false,
        }
    }

    /// The only way the secret leaves the struct — by reference, for client
    /// construction.
    pub fn password(&self) -> &str {
        &self.password
    }
}

impl std::fmt::Debug for TransportConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TransportConfig")
            .field("server_url", &self.server_url)
            .field("username", &self.username)
            .field("password", &"***")
            .field("remote_path", &self.remote_path)
            .field("allow_http", &self.allow_http)
            .field("trust_self_signed", &self.trust_self_signed)
            .finish()
    }
}

/// Build a `reqwest_dav` client with the two independent D-95 gates:
///
/// - `http://` is refused unless `allow_http` is set ([`SyncError::HttpNotAllowed`]);
///   `https` is always accepted; any other scheme is [`SyncError::Unreachable`].
/// - `danger_accept_invalid_certs` is wired to `trust_self_signed` and nothing
///   else — `allow_http` never implies certificate bypass (独立开关).
///
/// Basic auth over TLS; Digest auto-negotiates inside `reqwest_dav` when the
/// server demands it (D-96).
pub fn build_client(cfg: &TransportConfig) -> Result<reqwest_dav::Client, SyncError> {
    let normalized = normalize_server_url(&cfg.server_url);
    let url = reqwest::Url::parse(&normalized).map_err(|_| SyncError::Unreachable)?;
    match url.scheme() {
        "https" => {}
        "http" if cfg.allow_http => {}
        "http" => return Err(SyncError::HttpNotAllowed),
        _ => return Err(SyncError::Unreachable),
    }
    let agent = reqwest::Client::builder()
        .user_agent("pillowtome/0.1")
        .timeout(Duration::from_secs(60))
        .danger_accept_invalid_certs(cfg.trust_self_signed)
        .build()
        .map_err(|_| SyncError::Internal)?;
    reqwest_dav::ClientBuilder::new()
        .set_host(normalized)
        .set_auth(reqwest_dav::Auth::Basic(
            cfg.username.clone(),
            cfg.password.clone(),
        ))
        .set_agent(agent)
        .build()
        .map_err(|_| SyncError::Internal)
}

/// The pure HTTP-status layer of the classifier — unit-testable without any IO.
pub fn classify_http_status(status: u16) -> Option<SyncError> {
    match status {
        401 => Some(SyncError::Auth),
        403 => Some(SyncError::Permission),
        429 | 503 => Some(SyncError::RateLimited),
        412 => Some(SyncError::RemoteChanged),
        _ => None,
    }
}

/// Extract the server-returned HTTP status from a `reqwest_dav` error, if the
/// failure got as far as a response (non-2xx on the high-level methods).
/// `pub(crate)` since 07-03's file plane classifies PROPFIND 404/405 itself.
pub(crate) fn http_status_of(err: &reqwest_dav::Error) -> Option<u16> {
    match err {
        reqwest_dav::Error::Decode(reqwest_dav::DecodeError::StatusMismatched(e)) => {
            Some(e.response_code)
        }
        reqwest_dav::Error::Decode(reqwest_dav::DecodeError::Server(e)) => Some(e.response_code),
        _ => None,
    }
}

/// Classify any transport failure into the D-97 error classes. Raw OS/server
/// error text NEVER reaches the user — only the class string does.
pub fn classify(err: &reqwest_dav::Error) -> SyncError {
    // HTTP-status layer first: the server answered, so classify by status.
    if let Some(code) = http_status_of(err) {
        return classify_http_status(code).unwrap_or(SyncError::Internal);
    }
    // Transport layer: reqwest-stage failures (connect / timeout / TLS).
    if let reqwest_dav::Error::Reqwest(req_err) = err {
        if req_err.is_timeout() || req_err.is_connect() {
            return SyncError::Unreachable;
        }
        // Certificate failures surface in the reqwest error source chain
        // (rustls / platform-verifier). The raw text is only inspected here —
        // it is never shown to the user.
        let mut chain = req_err.to_string().to_lowercase();
        let mut source = std::error::Error::source(req_err);
        while let Some(s) = source {
            chain.push(' ');
            chain.push_str(&s.to_string().to_lowercase());
            source = s.source();
        }
        if chain.contains("certificate") || chain.contains("tls") || chain.contains("rustls") {
            return SyncError::Certificate;
        }
        // Any other reqwest-stage failure is a connection problem to the user.
        return SyncError::Unreachable;
    }
    // Decode / digest-handshake leftovers (XML parse, auth negotiation, …).
    SyncError::Internal
}

/// Retry `op` on [`SyncError::RateLimited`] only, with exponential backoff
/// (`base * 2^attempt` between attempts), at most 3 attempts total (Pitfall 3).
/// Production callers pass `Duration::from_millis(500)`; tests pass a few ms.
pub async fn with_rate_limit_retry<T, F, Fut>(base: Duration, mut op: F) -> Result<T, SyncError>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, SyncError>>,
{
    const MAX_ATTEMPTS: u32 = 3;
    let mut attempt: u32 = 0;
    loop {
        match op().await {
            Err(SyncError::RateLimited) if attempt + 1 < MAX_ATTEMPTS => {
                tokio::time::sleep(base * 2u32.pow(attempt)).await;
                attempt += 1;
            }
            result => return result,
        }
    }
}

/// D-97 liveness + auth check: a depth-0 PROPFIND on `root` ("/" probes the
/// DAV root). Classified via [`classify`].
///
/// NOTE: the plan text references `reqwest_dav::Depth::Zero`; reqwest_dav
/// 0.3.3 has no such variant — `Depth::Number(0)` is the depth-0 spelling.
pub async fn probe(client: &reqwest_dav::Client, root: &str) -> Result<(), SyncError> {
    client
        .list(root, reqwest_dav::Depth::Number(0))
        .await
        .map(|_| ())
        .map_err(|e| classify(&e))
}

/// Create the remote layout under `root`: `root` itself, then `books/`,
/// `state/`, `devices/`, in order. Already-exists (HTTP 405 or 409, per
/// RESEARCH Code Example) is success; anything else classifies (403 →
/// [`SyncError::Permission`]).
pub async fn bootstrap_dirs(client: &reqwest_dav::Client, root: &str) -> Result<(), SyncError> {
    let root = root.trim_end_matches('/');
    for dir in [
        root.to_string(),
        format!("{root}/books"),
        format!("{root}/state"),
        format!("{root}/devices"),
    ] {
        match client.mkcol(&dir).await {
            Ok(()) => {}
            Err(e) => match http_status_of(&e) {
                Some(405) | Some(409) => {}
                _ => return Err(classify(&e)),
            },
        }
    }
    Ok(())
}

/// Single path-join point: strip trailing `/` from host, leading `/` from
/// rel, join with one `/` (Pitfall 8 — trailing-slash quirks live HERE only).
pub(crate) fn join_url(host: &str, rel: &str) -> String {
    format!("{}/{}", host.trim_end_matches('/'), rel.trim_start_matches('/'))
}

/// Create `{root}/manifest.json` with `If-None-Match: *` — via `client.agent`,
/// NEVER the high-level `put()` which cannot carry custom headers (Pitfall 2).
///
/// Returns the response ETag captured VERBATIM (quotes included — ETags are
/// opaque equality tokens, never parsed) when the manifest was created
/// (200|201|204; `None` if the server sent no ETag header), `Ok(None)` when
/// the manifest already existed (412), and a classified error otherwise.
pub async fn put_manifest_if_absent(
    client: &reqwest_dav::Client,
    root: &str,
) -> Result<Option<String>, SyncError> {
    let url = join_url(
        &client.host,
        &format!("{}/manifest.json", root.trim_end_matches('/')),
    );
    let resp = client
        .agent
        .put(url)
        .header("If-None-Match", "*")
        .header("Content-Type", "application/json")
        .body(MANIFEST_BODY.to_vec())
        .send()
        .await
        .map_err(|e| classify(&reqwest_dav::Error::from(e)))?;
    match resp.status().as_u16() {
        200 | 201 | 204 => Ok(resp
            .headers()
            .get(reqwest::header::ETAG)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned)),
        412 => Ok(None),
        code => Err(classify_http_status(code).unwrap_or(SyncError::Internal)),
    }
}

/// The D-97 forced gate (RESEARCH Code Example 连接测试 + 远端引导): probe →
/// create dirs → conditional manifest PUT, in that order. `root` is the
/// configured `remote_path` (e.g. `pillowtome/`), joined under the client host
/// by the helpers.
pub async fn test_and_bootstrap(client: &reqwest_dav::Client, root: &str) -> Result<(), SyncError> {
    // Probe the DAV root, not the configured root: on first connect the
    // configured root does not exist yet (bootstrap_dirs below creates it),
    // and probing it would 404 before auth/liveness are even checked.
    probe(client, "/").await?;
    bootstrap_dirs(client, root).await?;
    put_manifest_if_absent(client, root).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_http_status_maps_the_d97_classes() {
        assert_eq!(classify_http_status(401), Some(SyncError::Auth));
        assert_eq!(classify_http_status(403), Some(SyncError::Permission));
        assert_eq!(classify_http_status(429), Some(SyncError::RateLimited));
        assert_eq!(classify_http_status(503), Some(SyncError::RateLimited));
        assert_eq!(classify_http_status(412), Some(SyncError::RemoteChanged));
        assert_eq!(classify_http_status(200), None);
        assert_eq!(classify_http_status(404), None);
    }

    #[test]
    fn build_client_refuses_plain_http_unless_allowed() {
        let mut cfg = TransportConfig::new(
            "http://nas.local/dav".to_string(),
            "u".to_string(),
            "p".to_string(),
        );
        assert_eq!(build_client(&cfg).unwrap_err(), SyncError::HttpNotAllowed);
        cfg.allow_http = true;
        assert!(build_client(&cfg).is_ok());
    }

    #[test]
    fn build_client_rejects_garbage_url() {
        let cfg =
            TransportConfig::new("not a url".to_string(), "u".to_string(), "p".to_string());
        assert_eq!(build_client(&cfg).unwrap_err(), SyncError::Unreachable);
    }

    #[test]
    fn build_client_accepts_https_by_default() {
        let cfg = TransportConfig::new(
            "https://dav.example.com/".to_string(),
            "u".to_string(),
            "p".to_string(),
        );
        assert!(build_client(&cfg).is_ok());
    }

    #[test]
    fn join_url_collapses_slash_variants() {
        assert_eq!(join_url("http://a/", "/b"), "http://a/b");
        assert_eq!(join_url("http://a", "b"), "http://a/b");
        assert_eq!(join_url("http://a///", "///b"), "http://a/b");
    }

    #[test]
    fn debug_redacts_the_password() {
        let cfg = TransportConfig::new(
            "https://dav.example.com".to_string(),
            "alice".to_string(),
            "s3cret".to_string(),
        );
        let dbg = format!("{cfg:?}");
        assert!(dbg.contains("***"));
        assert!(!dbg.contains("s3cret"));
    }
}
