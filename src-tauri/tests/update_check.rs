//! Off-device wire tests for the update check (UPD-01).
//!
//! `fetch_latest_release` takes the endpoint as a parameter, so these run
//! against a local wiremock server — GitHub itself is never touched in tests.

use pillowtome_lib::update::fetch_latest_release;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn newer_release_yields_update_info_with_notes() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/latest"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "tag_name": "v1.1.0",
            "name": "v1.1.0 — 词韵",
            "body": "## 新增\n- 自动检查更新\n\n## 修复\n- 老 WebView 打开 EPUB 报「文件已损坏」",
            "html_url": "https://github.com/KRPCT/Pillowtome/releases/tag/v1.1.0",
            "published_at": "2026-08-01T02:03:04Z"
        })))
        .mount(&server)
        .await;

    let info = fetch_latest_release(&format!("{}/latest", server.uri()), "1.0.0")
        .await
        .expect("request succeeds")
        .expect("newer release is reported");

    assert_eq!(info.version, "1.1.0");
    assert_eq!(info.current, "1.0.0");
    assert!(info.notes.contains("自动检查更新"), "notes carry the release body");
    assert_eq!(
        info.url,
        "https://github.com/KRPCT/Pillowtome/releases/tag/v1.1.0"
    );
    assert_eq!(info.published_at, "2026-08-01T02:03:04Z");
}

#[tokio::test]
async fn same_or_older_release_yields_none() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/latest"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "tag_name": "v1.0.0",
            "body": "",
            "html_url": "https://github.com/KRPCT/Pillowtome/releases/tag/v1.0.0"
        })))
        .mount(&server)
        .await;

    let result = fetch_latest_release(&format!("{}/latest", server.uri()), "1.0.0")
        .await
        .expect("request succeeds");
    assert_eq!(result, None);
}

#[tokio::test]
async fn missing_release_404_is_silent_none() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/latest"))
        .respond_with(ResponseTemplate::new(404).set_body_string("Not Found"))
        .mount(&server)
        .await;

    let result = fetch_latest_release(&format!("{}/latest", server.uri()), "1.0.0")
        .await
        .expect("404 maps to Ok, not an error toast");
    assert_eq!(result, None);
}

#[tokio::test]
async fn server_error_surfaces_as_err() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/latest"))
        .respond_with(ResponseTemplate::new(503))
        .mount(&server)
        .await;

    let err = fetch_latest_release(&format!("{}/latest", server.uri()), "1.0.0")
        .await
        .expect_err("5xx must surface for the manual-check toast");
    assert!(err.contains("503"), "error carries the HTTP status: {err}");
}
