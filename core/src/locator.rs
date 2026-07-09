//! Composite self-healing locator (seam stub).
//!
//! Filled by plan 01-03 (D-08): a `Locator` type
//! `{ work_id, cfi (or part+offset), progress_fraction, text_context }` — never
//! a bare percentage — so positions survive re-pagination and travel across
//! devices. Used fully by annotations in Phase 5.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A composite, self-healing reading position (D-08).
///
/// A `Locator` is deliberately **not** a bare percentage. It binds a position to
/// a `work_id` (stable identity, not a file path), a primary [`cfi`](Self::cfi)
/// anchor, an always-present `progress_fraction`, and a surrounding
/// [`TextContext`] so the position can re-anchor after re-pagination and travel
/// across devices. Annotations (P5) build on this exact shape.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Locator {
    /// Stable identity of the work this position belongs to (D-09) — never a
    /// file path, so the position survives moves and crosses devices.
    pub work_id: Uuid,

    /// Primary anchor: an EPUB CFI (or, for non-CFI formats, a part+offset
    /// encoded as a string). Optional because some formats/positions have none.
    pub cfi: Option<String>,

    /// Reading progress in `0.0..=1.0`. **Always present** — the coarse fallback
    /// that keeps a usable position even when `cfi`/`text_context` cannot
    /// re-anchor after a layout change (D-08).
    pub progress_fraction: f64,

    /// Surrounding text used to re-find the position after re-pagination.
    pub text_context: TextContext,
}

/// Text surrounding a located position, used to re-anchor it after the layout
/// changes (font size, viewport, pagination). Mirrors the standard
/// pre/exact/post match window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct TextContext {
    /// Text immediately before the position.
    pub pre: String,
    /// The exact text at the position.
    pub exact: String,
    /// Text immediately after the position.
    pub post: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Locator {
        Locator {
            work_id: uuid::Uuid::from_u128(0x1234_5678_90ab_cdef_1234_5678_90ab_cdef),
            cfi: Some("epubcfi(/6/4!/4/2/2[p1]/1:12)".into()),
            progress_fraction: 0.375,
            text_context: TextContext {
                pre: "床前明月".into(),
                exact: "光，疑是地上霜".into(),
                post: "。举头望明月".into(),
            },
        }
    }

    #[test]
    fn locator_round_trips() {
        let loc = sample();
        let json = serde_json::to_string(&loc).unwrap();
        let back: Locator = serde_json::from_str(&json).unwrap();
        assert_eq!(back, loc);
        // progress_fraction is always present, never dropped.
        assert!(json.contains("progress_fraction"));
    }

    #[test]
    fn cfi_is_optional_but_progress_is_not() {
        let mut loc = sample();
        loc.cfi = None;
        let json = serde_json::to_string(&loc).unwrap();
        let back: Locator = serde_json::from_str(&json).unwrap();
        assert_eq!(back.cfi, None);
        assert_eq!(back.progress_fraction, 0.375);
    }
}
