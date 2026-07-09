//! # pillowtome-core
//!
//! Portable, platform-agnostic core for Pillowtome. This crate has **zero**
//! Tauri or platform dependencies (D-03) so it cross-compiles to Android via
//! the NDK unchanged and is unit-testable off-device.
//!
//! The seam modules (`error`, `protection`, `publication`, `locator`,
//! `source`) are declared in plan 01-02 (Task 2). This Task-1 root is
//! intentionally minimal so the Cargo workspace compiles before those seams
//! land.
