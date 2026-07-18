//! Serde model for the remote WebDAV layout (07-RESEARCH Pattern 1).
//!
//! The remote device-state file is **untrusted input**: it crosses the
//! server → core trust boundary on every pull, so it is validated by
//! [`DeviceStateFile::validate`] before any merge reads it (V5, T-07-00-05).
//! Maps are `BTreeMap`-keyed for deterministic iteration (merge depends on it).
//!
//! Canonical remote layout (D-104/D-105):
//! `pillowtome/{manifest.json, books/, state/<device_id>.json, devices/<device_id>.json}`

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Remote layout format version. Files with any other `format` are rejected by
/// [`DeviceStateFile::validate`] — never parsed best-effort.
pub const REMOTE_FORMAT: u32 = 1;

/// `manifest.json` — remote structure version marker, written once at bootstrap.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Manifest {
    pub format: u32,
    pub app: String,
}

/// The canonical compact `manifest.json` body (core carries no serde_json
/// runtime dep — this literal is the single source of truth for the wire form).
pub fn manifest_json() -> &'static str {
    r#"{"format":1,"app":"pillowtome"}"#
}

/// `devices/<device_id>.json` — the device registry entry (friendly name shown
/// in settings; `last_seen` drives future tombstone GC, out of scope for v1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeviceRecord {
    pub device_id: String,
    pub device_name: String,
    pub first_seen: i64,
    pub last_seen: i64,
}

/// One work's reading position — a **register**, not a log: the remote file
/// keeps only the latest value per work (07-RESEARCH Pattern 1). Mirrors the
/// `locator` table (D-08 composite: never a bare percentage).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProgressRec {
    pub cfi: Option<String>,
    pub progress_fraction: Option<f64>,
    pub text_pre: Option<String>,
    pub text_exact: Option<String>,
    pub text_post: Option<String>,
    pub updated_at: i64,
}

/// One annotation, keyed by `annotation_id` in the map (the id is the map key —
/// it is deliberately NOT embedded in the record). Mirrors the `annotation`
/// table including the tombstone (`deleted`, D-80). `hash_algo` rides per
/// record (Pitfall 6): sha256 annotation hashes never compare against blake3.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnnotationRec {
    pub work_id: String,
    #[serde(rename = "type")]
    pub annotation_type: String,
    pub cfi: String,
    pub color: Option<String>,
    pub text_pre: Option<String>,
    pub text_exact: Option<String>,
    pub text_post: Option<String>,
    pub progress_fraction: Option<f64>,
    pub note: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub revision: i64,
    pub content_hash: Option<String>,
    pub hash_algo: Option<String>,
    pub deleted: i64,
}

/// Per-book file-sync state (D-98 opt-in), travels inside [`LibraryRec`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FileSyncRec {
    pub enabled: bool,
    pub remote_path: Option<String>,
    pub size: Option<i64>,
    pub hash: Option<String>,
}

/// One library catalog entry, keyed by `work_id` in the map (not embedded).
/// Local-only V4 columns (`item_id`, `source_id`, `cover_file`, `last_opened_at`,
/// `last_read_at`) are intentionally absent — the reconcile layer preserves
/// them, merge never sees them. `deleted` is the catalog tombstone (research
/// Q2 ADOPTED): merge set-union must never resurrect a deleted book.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LibraryRec {
    pub title: String,
    pub author: Option<String>,
    pub format: String,
    pub content_hash: String,
    pub imported_at: i64,
    pub deleted: i64,
    pub file_sync: Option<FileSyncRec>,
}

/// `state/<device_id>.json` — one device owns exactly one remote file (write
/// conflicts impossible by construction; 07-RESEARCH Pattern 1). Sections are
/// `#[serde(default)]` so a partial file (progress only, no annotations yet)
/// still deserializes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeviceStateFile {
    pub format: u32,
    pub device_id: String,
    pub device_name: String,
    pub clock: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub progress: BTreeMap<String, ProgressRec>,
    #[serde(default)]
    pub annotations: BTreeMap<String, AnnotationRec>,
    #[serde(default)]
    pub library: BTreeMap<String, LibraryRec>,
}

/// Input-validation failures for untrusted remote JSON (V5).
#[derive(Debug, Error, PartialEq)]
pub enum ModelError {
    #[error("unsupported remote format {0} (expected {REMOTE_FORMAT})")]
    UnsupportedFormat(u32),
    #[error("progress_fraction {0} out of range 0.0..=1.0")]
    InvalidFraction(f64),
    #[error("device_id must be non-empty")]
    EmptyDeviceId,
}

impl DeviceStateFile {
    /// Validate a freshly deserialized remote file BEFORE any merge reads it
    /// (T-07-00-05): exact format version, non-empty device_id, and every
    /// progress_fraction (progress + annotation registers) inside 0.0..=1.0.
    /// NaN fails the range check — it is rejected, never merged.
    pub fn validate(&self) -> Result<(), ModelError> {
        if self.format != REMOTE_FORMAT {
            return Err(ModelError::UnsupportedFormat(self.format));
        }
        if self.device_id.is_empty() {
            return Err(ModelError::EmptyDeviceId);
        }
        for rec in self.progress.values() {
            if let Some(f) = rec.progress_fraction {
                if !(0.0..=1.0).contains(&f) {
                    return Err(ModelError::InvalidFraction(f));
                }
            }
        }
        for rec in self.annotations.values() {
            if let Some(f) = rec.progress_fraction {
                if !(0.0..=1.0).contains(&f) {
                    return Err(ModelError::InvalidFraction(f));
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn progress(fraction: Option<f64>) -> ProgressRec {
        ProgressRec {
            cfi: Some("epubcfi(/6/4)".into()),
            progress_fraction: fraction,
            text_pre: None,
            text_exact: None,
            text_post: None,
            updated_at: 1_000,
        }
    }

    fn annotation(fraction: Option<f64>) -> AnnotationRec {
        AnnotationRec {
            work_id: "w1".into(),
            annotation_type: "highlight".into(),
            cfi: "epubcfi(/6/4)".into(),
            color: Some("cinnabar".into()),
            text_pre: None,
            text_exact: Some("句子".into()),
            text_post: None,
            progress_fraction: fraction,
            note: None,
            created_at: 0,
            updated_at: 1_000,
            revision: 1,
            content_hash: Some("ab".repeat(32)),
            hash_algo: Some("sha256".into()),
            deleted: 0,
        }
    }

    fn state_file() -> DeviceStateFile {
        DeviceStateFile {
            format: REMOTE_FORMAT,
            device_id: "dev-a".into(),
            device_name: "小明的 Pixel 8".into(),
            clock: 42,
            updated_at: 1_000,
            progress: BTreeMap::from([("w1".to_string(), progress(Some(0.42)))]),
            annotations: BTreeMap::from([("a1".to_string(), annotation(Some(0.4)))]),
            library: BTreeMap::from([(
                "w1".to_string(),
                LibraryRec {
                    title: "书名".into(),
                    author: Some("作者".into()),
                    format: "epub".into(),
                    content_hash: "blake3hex".into(),
                    imported_at: 0,
                    deleted: 0,
                    file_sync: Some(FileSyncRec {
                        enabled: true,
                        remote_path: Some("books/作者 - 书名.epub".into()),
                        size: Some(12_345_678),
                        hash: Some("blake3hex".into()),
                    }),
                },
            )]),
        }
    }

    #[test]
    fn device_state_file_round_trips_the_research_pattern1_shape() {
        let file = state_file();
        let json = serde_json::to_string(&file).unwrap();
        // The wire shape matches 07-RESEARCH Pattern 1: "type" (renamed),
        // format/device/clock plus the three maps.
        assert!(json.contains(r#""format":1"#));
        assert!(json.contains(r#""type":"highlight""#));
        assert!(json.contains(r#""hash_algo":"sha256""#));
        let back: DeviceStateFile = serde_json::from_str(&json).unwrap();
        assert_eq!(back, file);
    }

    #[test]
    fn deserialize_tolerates_missing_sections() {
        // A progress-only file (no annotations/library keys at all) still parses.
        let json = r#"{
            "format": 1, "device_id": "dev-a", "device_name": "d",
            "clock": 1, "updated_at": 1000,
            "progress": {"w1": {"cfi": null, "progress_fraction": 0.5,
                "text_pre": null, "text_exact": null, "text_post": null,
                "updated_at": 1000}}
        }"#;
        let file: DeviceStateFile = serde_json::from_str(json).unwrap();
        assert_eq!(file.progress.len(), 1);
        assert!(file.annotations.is_empty());
        assert!(file.library.is_empty());
        file.validate().unwrap();
    }

    #[test]
    fn validate_rejects_wrong_format() {
        let mut file = state_file();
        file.format = 2;
        assert_eq!(file.validate(), Err(ModelError::UnsupportedFormat(2)));
    }

    #[test]
    fn validate_rejects_out_of_range_fractions_including_nan() {
        for bad in [Some(1.5), Some(-0.1), Some(f64::NAN)] {
            let mut file = state_file();
            file.progress.insert("w2".into(), progress(bad));
            assert!(
                matches!(file.validate(), Err(ModelError::InvalidFraction(_))),
                "fraction {bad:?} must be rejected"
            );
        }
        // Boundaries and None pass.
        for ok in [Some(0.0), Some(1.0), None] {
            let mut file = state_file();
            file.progress.insert("w2".into(), progress(ok));
            file.validate().unwrap();
        }
        // Annotation fractions are range-checked too.
        let mut file = state_file();
        file.annotations.insert("a2".into(), annotation(Some(2.0)));
        assert!(matches!(
            file.validate(),
            Err(ModelError::InvalidFraction(_))
        ));
    }

    #[test]
    fn validate_rejects_empty_device_id() {
        let mut file = state_file();
        file.device_id = String::new();
        assert_eq!(file.validate(), Err(ModelError::EmptyDeviceId));
    }

    #[test]
    fn manifest_json_is_the_canonical_compact_form() {
        assert_eq!(manifest_json(), r#"{"format":1,"app":"pillowtome"}"#);
        let parsed: Manifest = serde_json::from_str(manifest_json()).unwrap();
        assert_eq!(parsed.format, REMOTE_FORMAT);
        assert_eq!(parsed.app, "pillowtome");
    }
}
