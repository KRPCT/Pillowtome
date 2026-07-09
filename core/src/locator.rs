//! Composite self-healing locator (seam stub).
//!
//! Filled by plan 01-03 (D-08): a `Locator` type
//! `{ work_id, cfi (or part+offset), progress_fraction, text_context }` — never
//! a bare percentage — so positions survive re-pagination and travel across
//! devices. Used fully by annotations in Phase 5.

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
