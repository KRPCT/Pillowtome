//! IPC command surface.
//!
//! Only small structured data (metadata, locators, settings, and the DRM-gate
//! verdict below) is allowed to cross Tauri IPC here. **Book bytes never cross
//! IPC (D-06)** — they stream to the WebView exclusively via the `pillow://`
//! custom protocol (see [`crate::protocol`]).
//!
//! [`check_protection`] is the pre-render safety gate (D-10): before the reader
//! fetches a book over `pillow://`, it asks the core to classify the file. The
//! bytes are read here on the Rust side and only the *verdict* (a tiny struct)
//! is returned — the book itself is never serialized across the bridge.

use serde::Serialize;
use tauri::State;

use pillowtome_core::error::CoreError;
use pillowtome_core::protection::{detect_protection, Protection};

use crate::storage::SourceRegistry;

/// Result of the pre-render DRM/corruption gate, shaped for the WebView.
///
/// `can_render` is the only branch the reader needs: when `false`, `message`
/// carries end-user 简体中文 copy for the error card. Only this small struct
/// crosses IPC — never book bytes (D-06).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectionDecision {
    pub can_render: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl ProtectionDecision {
    fn render() -> Self {
        Self { can_render: true, message: None }
    }

    fn refuse(message: &str) -> Self {
        Self { can_render: false, message: Some(message.to_string()) }
    }
}

/// Map a protection-detection result to a render/refuse decision (pure, so it is
/// unit-testable off-device). Font-obfuscation-only books render normally per
/// D-10; content DRM / unknown encryption / corruption refuse with clean copy.
pub fn decide(detected: Result<Protection, CoreError>) -> ProtectionDecision {
    match detected {
        // Clean, or only fonts obfuscated (not content DRM, Pitfall 4) — render.
        Ok(Protection::None) | Ok(Protection::FontObfuscationOnly) => ProtectionDecision::render(),
        // Retailer content DRM / unknown encryption — refuse, never decrypt (D-10).
        Ok(Protection::ContentDrm(_)) | Ok(Protection::Unknown) => {
            ProtectionDecision::refuse("无法打开：不支持的加密书籍。")
        }
        // Damaged / truncated / not a valid EPUB — soft-fail, no crash (Pitfall 5).
        Err(CoreError::Corrupt) => ProtectionDecision::refuse("文件已损坏，无法打开。"),
        Err(CoreError::Drm(_)) => ProtectionDecision::refuse("无法打开：不支持的加密书籍。"),
        Err(CoreError::Unsupported) => ProtectionDecision::refuse("无法打开：不支持的书籍格式。"),
        Err(CoreError::Io(_)) => ProtectionDecision::refuse("无法读取书籍文件。"),
    }
}

/// Pre-render DRM/corruption gate for the book registered under `id`.
///
/// Reads the backing file (resolved only through the registry — never a
/// caller-supplied path, threat T-01-01), classifies it in the portable core,
/// and returns the render/refuse verdict. The book bytes are NOT returned; the
/// WebView fetches them separately over `pillow://` only when `can_render`.
#[tauri::command]
pub fn check_protection(id: String, registry: State<'_, SourceRegistry>) -> ProtectionDecision {
    let Some(path) = registry.resolve(&id) else {
        return ProtectionDecision::refuse("找不到该书籍。");
    };
    match std::fs::read(&path) {
        Ok(bytes) => decide(detect_protection(&bytes)),
        Err(_) => ProtectionDecision::refuse("无法读取书籍文件。"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_and_font_obfuscation_render() {
        assert!(decide(Ok(Protection::None)).can_render);
        assert!(decide(Ok(Protection::FontObfuscationOnly)).can_render);
    }

    #[test]
    fn content_drm_and_unknown_refuse_as_unsupported() {
        let drm = decide(Ok(Protection::ContentDrm("Adobe ADEPT")));
        assert!(!drm.can_render);
        assert_eq!(drm.message.as_deref(), Some("无法打开：不支持的加密书籍。"));
        assert!(!decide(Ok(Protection::Unknown)).can_render);
    }

    #[test]
    fn corrupt_soft_fails_with_damaged_copy() {
        let d = decide(Err(CoreError::Corrupt));
        assert!(!d.can_render);
        assert_eq!(d.message.as_deref(), Some("文件已损坏，无法打开。"));
    }

    #[test]
    fn refuse_always_carries_a_message() {
        for d in [
            decide(Ok(Protection::ContentDrm("Kindle"))),
            decide(Ok(Protection::Unknown)),
            decide(Err(CoreError::Corrupt)),
            decide(Err(CoreError::Unsupported)),
        ] {
            assert!(!d.can_render);
            assert!(d.message.is_some());
        }
    }
}
