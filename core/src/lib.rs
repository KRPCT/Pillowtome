//! # pillowtome-core
//!
//! Portable, platform-agnostic core for Pillowtome. This crate has **zero**
//! Tauri or platform dependencies (D-03) so it cross-compiles to Android via
//! the NDK unchanged and is unit-testable off-device.
//!
//! ## Seam modules (declared here, filled by later plans)
//!
//! These modules are pre-declared so downstream plans add real logic to their
//! own files without ever touching this shared crate root:
//!
//! - [`error`] — typed `CoreError` for DRM/corruption soft-fail (plan 01-02, D-10)
//! - [`protection`] — DRM / corruption detect-and-refuse (plan 01-02, FND-04)
//! - [`publication`] — `Publication` trait + `Format` enum (plan 01-03, D-07)
//! - [`locator`] — composite self-healing `Locator` (plan 01-03, D-08)
//! - [`source`] — opaque `BookSource` storage-handle (plan 01-03, D-05)
//! - [`sync`] — WebDAV sync pure core: remote model, path hygiene, merge (plan 07-00)

pub mod error;
pub mod locator;
pub mod protection;
pub mod publication;
pub mod source;
pub mod sync;
