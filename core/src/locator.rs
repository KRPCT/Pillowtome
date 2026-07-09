//! Composite self-healing locator (seam stub).
//!
//! Filled by plan 01-03 (D-08): a `Locator` type
//! `{ work_id, cfi (or part+offset), progress_fraction, text_context }` — never
//! a bare percentage — so positions survive re-pagination and travel across
//! devices. Used fully by annotations in Phase 5.
