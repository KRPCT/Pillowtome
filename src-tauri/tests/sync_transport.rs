//! Off-device WebDAV transport integration matrix (SYNC-01) — wiremock fake
//! server, no real network, no real keychain, no clock sleeps above ~10ms.
//!
//! Asserts on the classified [`SyncError`] enum — never on raw error text —
//! and proves on the wire that the conditional manifest PUT actually carries
//! `If-None-Match: *` (Pitfall 2: if anyone refactors to the high-level
//! `reqwest_dav::Client::put`, which cannot send custom headers, the header
//! matcher stops matching and the test fails).

use std::time::Duration;

use pillowtome_lib::sync::transport::{
    bootstrap_dirs, build_client, probe, put_manifest_if_absent, with_rate_limit_retry,
    TransportConfig,
};
use pillowtome_lib::sync::SyncError;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// Build a client against the wiremock server. wiremock serves plain http, so
/// `allow_http` is set — this positively exercises the D-95 http gate (the
/// same config with `allow_http: false` is refused in the unit tests).
fn dav_client(server: &MockServer) -> reqwest_dav::Client {
    let mut cfg = TransportConfig::new(server.uri(), "user".to_string(), "pass".to_string());
    cfg.allow_http = true;
    build_client(&cfg).expect("build client against wiremock server")
}

/// Minimal RFC 4918 multistatus body for a collection at `/`.
const MULTISTATUS_207: &str = r#"<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>"#;

#[tokio::test]
async fn probe_401_maps_to_auth_class() {
    let server = MockServer::start().await;
    Mock::given(method("PROPFIND"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;
    let client = dav_client(&server);
    assert_eq!(probe(&client, "/").await, Err(SyncError::Auth));
}

#[tokio::test]
async fn mkcol_403_maps_to_permission_class() {
    let server = MockServer::start().await;
    Mock::given(method("PROPFIND"))
        .respond_with(
            ResponseTemplate::new(207)
                .insert_header("content-type", "application/xml")
                .set_body_string(MULTISTATUS_207),
        )
        .mount(&server)
        .await;
    Mock::given(method("MKCOL"))
        .respond_with(ResponseTemplate::new(403))
        .mount(&server)
        .await;
    let client = dav_client(&server);
    assert_eq!(
        bootstrap_dirs(&client, "/pillowtome").await,
        Err(SyncError::Permission)
    );
}

#[tokio::test]
async fn connect_refused_maps_to_unreachable() {
    // A closed loopback port — deterministic, no sleep. (Covers the
    // connect-stage branch; TLS-cert classification has no off-device fixture
    // and is covered by the D-94 manual matrix, not here.)
    let mut cfg = TransportConfig::new(
        "http://127.0.0.1:1".to_string(),
        "user".to_string(),
        "pass".to_string(),
    );
    cfg.allow_http = true;
    let client = build_client(&cfg).expect("build client");
    assert_eq!(probe(&client, "/").await, Err(SyncError::Unreachable));
}

#[tokio::test]
async fn rate_limited_503_retries_with_backoff_then_surfaces_class() {
    let server = MockServer::start().await;
    Mock::given(method("PROPFIND"))
        .respond_with(ResponseTemplate::new(503))
        .expect(3)
        .mount(&server)
        .await;
    let client = dav_client(&server);
    let result = with_rate_limit_retry(Duration::from_millis(2), || probe(&client, "/")).await;
    assert_eq!(result, Err(SyncError::RateLimited));
    // Exactly 3 requests hit the wire — the backoff actually retried (Pitfall 3).
    server.verify().await;
}

#[tokio::test]
async fn etag_response_header_is_captured_verbatim() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .respond_with(ResponseTemplate::new(201).insert_header("etag", "\"v1-abc\""))
        .mount(&server)
        .await;
    let client = dav_client(&server);
    // Quotes preserved: the ETag is an opaque equality token, never parsed.
    assert_eq!(
        put_manifest_if_absent(&client, "pillowtome").await,
        Ok(Some("\"v1-abc\"".to_string()))
    );
}

#[tokio::test]
async fn conditional_put_carries_if_none_match_star_to_the_wire() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/pillowtome/manifest.json"))
        .and(header("If-None-Match", "*"))
        // Post-07-03: the raw agent must also carry the configured Basic
        // credentials (reqwest_dav only auths its own high-level methods).
        // Without the header this mock stops matching and the test fails.
        .and(header("Authorization", "Basic dXNlcjpwYXNz"))
        .respond_with(ResponseTemplate::new(201))
        .expect(1)
        .mount(&server)
        .await;
    let client = dav_client(&server);
    put_manifest_if_absent(&client, "pillowtome")
        .await
        .expect("conditional PUT succeeds");
    server.verify().await;
}

#[tokio::test]
async fn manifest_put_412_treated_as_already_exists() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .respond_with(ResponseTemplate::new(412))
        .mount(&server)
        .await;
    let client = dav_client(&server);
    assert_eq!(put_manifest_if_absent(&client, "pillowtome").await, Ok(None));
}
