//! Deterministic merge engine (SYNC-05, 07-RESEARCH Pattern 2).
//!
//! Pure functions over the shared record types — no IO, no uuid minting — so
//! the reconcile layer (07-02) and the no-data-loss property matrix below share
//! the exact same code path. The rules, locked in 07-CONTEXT / SYNC-05:
//!
//! - **Never drop a single-side record**: merge is a set union (PITFALLS #7 —
//!   no whole-file LWW blobs). Anything that exists on only one side survives.
//! - **Progress furthest-wins** by (progress_fraction → updated_at → device_id)
//!   — a documented total order, deterministic under argument swap.
//! - **Annotation by-id union**: (revision → tombstone remove-wins →
//!   same-algorithm content_hash → updated_at → device_id) with a
//!   non-destructive `冲突副本` conflict copy as the explicit fallback.
//! - **Library by-work union**: tombstone anti-resurrection (research Q2) plus
//!   file_sync flag union (D-98).
//! - **hash_algo never crosses algorithms** (Pitfall 6): content_hash compares
//!   only when both records carry the same hash_algo — a sha256 annotation hash
//!   and a blake3 work hash can never be equal.
//! - `MergeOutcome::replaced_local` carries the pre-jump local row whenever a
//!   remote winner displaces an existing local row (D-92 undo payload).

use std::cmp::Ordering;
use std::collections::BTreeMap;

use super::model::{AnnotationRec, FileSyncRec, LibraryRec, ProgressRec};

/// Note prefix marking a non-destructive conflict copy (product copy is 简体中文,
/// D-30): `冲突副本：原笔记` when the loser carries a note, bare `冲突副本` else.
const CONFLICT_NOTE_PREFIX: &str = "冲突副本";

/// Which side won a single-record merge. `Both` keeps one record at the
/// contested id and preserves the loser as a non-destructive conflict copy.
#[derive(Debug, Clone, PartialEq)]
pub enum MergeWinner<T> {
    Local(T),
    Remote(T),
    Both { kept: T, conflict_copy: T },
}

/// The result of merging one record pair. `replaced_local` is the pre-jump
/// local row whenever a remote winner displaces an existing local row (D-92
/// undo payload); `None` when local won or never existed.
#[derive(Debug, Clone, PartialEq)]
pub struct MergeOutcome<T> {
    pub winner: MergeWinner<T>,
    pub replaced_local: Option<T>,
}

fn local_wins<T: Clone>(local: &T) -> MergeOutcome<T> {
    MergeOutcome {
        winner: MergeWinner::Local(local.clone()),
        replaced_local: None,
    }
}

fn remote_wins<T: Clone>(remote: &T, local: &T) -> MergeOutcome<T> {
    MergeOutcome {
        winner: MergeWinner::Remote(remote.clone()),
        replaced_local: Some(local.clone()),
    }
}

/// Total order on progress records: fraction (None sorts BELOW any Some;
/// None == None ties) → updated_at (later wins) → device_id (lexicographically
/// GREATER wins). `total_cmp` keeps even NaN deterministic (validate() rejects
/// NaN before merge anyway).
fn progress_cmp(a: &ProgressRec, a_device: &str, b: &ProgressRec, b_device: &str) -> Ordering {
    let fraction = match (a.progress_fraction, b.progress_fraction) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Less,
        (Some(_), None) => Ordering::Greater,
        (Some(x), Some(y)) => x.total_cmp(&y),
    };
    fraction
        .then_with(|| a.updated_at.cmp(&b.updated_at))
        .then_with(|| a_device.cmp(b_device))
}

/// Progress: furthest-wins under the documented total order (SYNC-05).
/// Remote winner ⇒ `replaced_local = Some(local)` when local existed (D-92).
pub fn merge_progress(
    local: Option<&ProgressRec>,
    remote: &ProgressRec,
    local_device: &str,
    remote_device: &str,
) -> MergeOutcome<ProgressRec> {
    match local {
        None => MergeOutcome {
            winner: MergeWinner::Remote(remote.clone()),
            replaced_local: None,
        },
        Some(l) if progress_cmp(remote, remote_device, l, local_device) == Ordering::Greater => {
            remote_wins(remote, l)
        }
        Some(l) => local_wins(l),
    }
}

/// Annotation: by-id union with (revision → tombstone remove-wins →
/// same-algorithm content_hash → updated_at → device_id) and a non-destructive
/// conflict copy. `conflict_copy_id` is the caller-minted id for the copy —
/// AnnotationRec carries no id field (the id is the map key), so the pure
/// function takes it for contract symmetry and the caller keys the returned
/// `conflict_copy` under it.
pub fn merge_annotation(
    local: Option<&AnnotationRec>,
    remote: &AnnotationRec,
    local_device: &str,
    remote_device: &str,
    conflict_copy_id: &str,
) -> MergeOutcome<AnnotationRec> {
    let _ = conflict_copy_id;
    let Some(l) = local else {
        return MergeOutcome {
            winner: MergeWinner::Remote(remote.clone()),
            replaced_local: None,
        };
    };
    let r = remote;

    // (1) Higher revision wins outright — revision lineage is authoritative
    // (no copy: the loser is an ancestor, not a conflict).
    if r.revision != l.revision {
        return if r.revision > l.revision {
            remote_wins(r, l)
        } else {
            local_wins(l)
        };
    }
    // (2) Equal revision, exactly one tombstone ⇒ the TOMBSTONE wins (OR-Set
    // remove-wins; our tombstone rows retain all content columns, so removal
    // stays non-destructive).
    if (l.deleted == 1) != (r.deleted == 1) {
        return if r.deleted == 1 { remote_wins(r, l) } else { local_wins(l) };
    }
    // (3) Equal revision, same deletedness: identical content under the SAME
    // hash algorithm ⇒ idempotent no-op. A hash_algo mismatch is NEVER a
    // hash-equality verdict (Pitfall 6) — it falls through to the copy.
    if l.hash_algo == r.hash_algo && l.content_hash == r.content_hash {
        return local_wins(l);
    }
    // (4) Hash differs (or algorithm differs): non-destructive conflict copy.
    // kept = chain winner by (updated_at later → device_id greater); the loser
    // is preserved verbatim apart from its id and the note prefix.
    let kept_remote = r
        .updated_at
        .cmp(&l.updated_at)
        .then_with(|| remote_device.cmp(local_device))
        == Ordering::Greater;
    let (kept, loser) = if kept_remote {
        (r.clone(), l.clone())
    } else {
        (l.clone(), r.clone())
    };
    let conflict_copy = AnnotationRec {
        note: Some(match loser.note.as_deref() {
            Some(note) if !note.is_empty() => format!("{CONFLICT_NOTE_PREFIX}：{note}"),
            _ => CONFLICT_NOTE_PREFIX.to_string(),
        }),
        ..loser
    };
    MergeOutcome {
        winner: MergeWinner::Both {
            kept,
            conflict_copy,
        },
        // The local row is displaced from its id only when the remote side is kept.
        replaced_local: if kept_remote { Some(l.clone()) } else { None },
    }
}

/// Library: by-work union with tombstone anti-resurrection (research Q2 —
/// a deleted book never comes back via set-union) and file_sync flag union.
pub fn merge_library(
    local: Option<&LibraryRec>,
    remote: &LibraryRec,
    local_device: &str,
    remote_device: &str,
) -> MergeOutcome<LibraryRec> {
    let Some(l) = local else {
        return MergeOutcome {
            winner: MergeWinner::Remote(remote.clone()),
            replaced_local: None,
        };
    };
    let r = remote;
    // Both tombstones ⇒ Local idempotent (nothing to resurrect).
    if l.deleted == 1 && r.deleted == 1 {
        return local_wins(l);
    }
    // Exactly one tombstone ⇒ tombstone wins (anti-resurrection).
    if (l.deleted == 1) != (r.deleted == 1) {
        return if r.deleted == 1 { remote_wins(r, l) } else { local_wins(l) };
    }
    // Both live ⇒ deterministic kept by (imported_at later → device_id greater).
    let kept_remote = r
        .imported_at
        .cmp(&l.imported_at)
        .then_with(|| remote_device.cmp(local_device))
        == Ordering::Greater;
    let mut kept = if kept_remote { r.clone() } else { l.clone() };
    // file_sync union (D-98): enabled if either side enabled; details from an
    // enabled side, kept side preferred.
    kept.file_sync = union_file_sync(l.file_sync.as_ref(), r.file_sync.as_ref(), kept_remote);
    MergeOutcome {
        winner: if kept_remote {
            MergeWinner::Remote(kept)
        } else {
            MergeWinner::Local(kept)
        },
        replaced_local: if kept_remote { Some(l.clone()) } else { None },
    }
}

fn union_file_sync(
    local: Option<&FileSyncRec>,
    remote: Option<&FileSyncRec>,
    remote_preferred: bool,
) -> Option<FileSyncRec> {
    match (local, remote) {
        (None, None) => None,
        (Some(l), None) => Some(l.clone()),
        (None, Some(r)) => Some(r.clone()),
        (Some(l), Some(r)) => {
            if !l.enabled && !r.enabled {
                // Neither side syncs the file: flag stays off, no stale details.
                return Some(FileSyncRec {
                    enabled: false,
                    remote_path: None,
                    size: None,
                    hash: None,
                });
            }
            let (preferred, fallback) = if remote_preferred { (r, l) } else { (l, r) };
            let detail = if preferred.enabled { preferred } else { fallback };
            Some(FileSyncRec {
                enabled: true,
                remote_path: detail.remote_path.clone(),
                size: detail.size,
                hash: detail.hash.clone(),
            })
        }
    }
}

/// Merge every remote progress register into the local map, iterating the
/// UNION of keys: local-only keys pass through verbatim; remote-only keys
/// merge in. Returns the merged map plus the D-92 undo stash — one
/// (work_id, pre-jump local row) entry per displaced ORIGINAL local row.
pub fn merge_progress_map(
    local: &BTreeMap<String, ProgressRec>,
    remotes: &[(String, BTreeMap<String, ProgressRec>)],
    local_device: &str,
) -> (BTreeMap<String, ProgressRec>, Vec<(String, ProgressRec)>) {
    let mut merged = local.clone();
    let mut stash: Vec<(String, ProgressRec)> = Vec::new();
    for (remote_device, records) in remotes {
        for (work_id, rec) in records {
            let outcome = merge_progress(merged.get(work_id), rec, local_device, remote_device);
            match outcome.winner {
                MergeWinner::Local(w) => {
                    merged.insert(work_id.clone(), w);
                }
                MergeWinner::Remote(w) => {
                    if let Some(old) = outcome.replaced_local {
                        // D-92: stash the ORIGINAL local row, once — a later
                        // remote displacing an already-merged row is not undoable.
                        if local.contains_key(work_id) && !stash.iter().any(|(k, _)| k == work_id) {
                            stash.push((work_id.clone(), old));
                        }
                    }
                    merged.insert(work_id.clone(), w);
                }
                MergeWinner::Both { .. } => unreachable!("progress merge never forks"),
            }
        }
    }
    (merged, stash)
}

/// Merge every remote annotation map into the local map by annotation_id
/// (set union — SYNC-05). Conflict copies are inserted under caller-minted ids
/// from `id_alloc` — uuid generation stays OUT of the pure core (tests pass a
/// counter closure). Re-merging an identical remote is idempotent: a copy
/// whose content already exists is reused, never duplicated.
pub fn merge_annotation_map(
    local: &BTreeMap<String, AnnotationRec>,
    remotes: &[(String, BTreeMap<String, AnnotationRec>)],
    local_device: &str,
    id_alloc: &mut dyn FnMut() -> String,
) -> BTreeMap<String, AnnotationRec> {
    let mut merged = local.clone();
    for (remote_device, records) in remotes {
        for (id, rec) in records {
            let outcome = merge_annotation(merged.get(id), rec, local_device, remote_device, "");
            match outcome.winner {
                MergeWinner::Local(w) | MergeWinner::Remote(w) => {
                    merged.insert(id.clone(), w);
                }
                MergeWinner::Both {
                    kept,
                    conflict_copy,
                } => {
                    merged.insert(id.clone(), kept);
                    if !merged.values().any(|v| *v == conflict_copy) {
                        merged.insert(id_alloc(), conflict_copy);
                    }
                }
            }
        }
    }
    merged
}

/// Merge every remote library catalog into the local map by work_id (set
/// union, tombstone anti-resurrection, file_sync union — see [`merge_library`]).
pub fn merge_library_map(
    local: &BTreeMap<String, LibraryRec>,
    remotes: &[(String, BTreeMap<String, LibraryRec>)],
    local_device: &str,
) -> BTreeMap<String, LibraryRec> {
    let mut merged = local.clone();
    for (remote_device, records) in remotes {
        for (work_id, rec) in records {
            let outcome = merge_library(merged.get(work_id), rec, local_device, remote_device);
            match outcome.winner {
                MergeWinner::Local(w) | MergeWinner::Remote(w) => {
                    merged.insert(work_id.clone(), w);
                }
                // Library merge never forks — there are no catalog conflict copies.
                MergeWinner::Both { kept, .. } => {
                    merged.insert(work_id.clone(), kept);
                }
            }
        }
    }
    merged
}

#[cfg(test)]
mod tests {
    use super::*;

    fn progress(fraction: Option<f64>, updated_at: i64) -> ProgressRec {
        ProgressRec {
            cfi: Some("epubcfi(/6/4)".into()),
            progress_fraction: fraction,
            text_pre: None,
            text_exact: None,
            text_post: None,
            updated_at,
        }
    }

    /// Fixture annotation: `content` drives cfi/text_exact/content_hash so two
    /// records with different `content` always differ in content_hash (same
    /// sha256 tag by default — the dual-algorithm fixture overrides it).
    fn annotation(content: &str, revision: i64, deleted: i64, updated_at: i64) -> AnnotationRec {
        AnnotationRec {
            work_id: "w1".into(),
            annotation_type: "highlight".into(),
            cfi: format!("epubcfi(/6/{content})"),
            color: Some("cinnabar".into()),
            text_pre: None,
            text_exact: Some(content.into()),
            text_post: None,
            progress_fraction: Some(0.4),
            note: None,
            created_at: 0,
            updated_at,
            revision,
            content_hash: Some(format!("hash-{content}")),
            hash_algo: Some("sha256".into()),
            deleted,
        }
    }

    fn library(
        title: &str,
        imported_at: i64,
        deleted: i64,
        file_sync: Option<FileSyncRec>,
    ) -> LibraryRec {
        LibraryRec {
            title: title.into(),
            author: None,
            format: "epub".into(),
            content_hash: "blake3hex".into(),
            imported_at,
            deleted,
            file_sync,
        }
    }

    // ---- progress -------------------------------------------------------

    #[test]
    fn progress_remote_further_wins_and_stashes_local() {
        let local = progress(Some(0.3), 100);
        let remote = progress(Some(0.6), 50); // further fraction beats newer clock
        let out = merge_progress(Some(&local), &remote, "dev-a", "dev-b");
        assert_eq!(out.winner, MergeWinner::Remote(remote));
        assert_eq!(out.replaced_local, Some(local));
    }

    #[test]
    fn progress_local_further_wins_with_no_stash() {
        let local = progress(Some(0.7), 100);
        let remote = progress(Some(0.6), 200);
        let out = merge_progress(Some(&local), &remote, "dev-a", "dev-b");
        assert_eq!(out.winner, MergeWinner::Local(local));
        assert_eq!(out.replaced_local, None);
    }

    #[test]
    fn progress_equal_fraction_falls_to_updated_at() {
        let older = progress(Some(0.5), 100);
        let newer = progress(Some(0.5), 200);
        let out = merge_progress(Some(&older), &newer, "dev-a", "dev-b");
        assert_eq!(out.winner, MergeWinner::Remote(newer));
        assert_eq!(out.replaced_local, Some(older));
    }

    #[test]
    fn progress_full_tie_device_id_decides_deterministically_under_swap() {
        let a = progress(Some(0.5), 100);
        let b = progress(Some(0.5), 100);
        // dev-b > dev-a ⇒ b's record wins regardless of argument order.
        let ab = merge_progress(Some(&a), &b, "dev-a", "dev-b");
        let ba = merge_progress(Some(&b), &a, "dev-b", "dev-a");
        let winner_ab = match ab.winner {
            MergeWinner::Remote(w) => w,
            other => panic!("expected Remote, got {other:?}"),
        };
        let winner_ba = match ba.winner {
            MergeWinner::Local(w) => w,
            other => panic!("expected Local, got {other:?}"),
        };
        assert_eq!(winner_ab, winner_ba, "same winning record under swap");
        assert_eq!(winner_ab, b);
    }

    #[test]
    fn progress_none_fraction_sorts_below_any_some() {
        let local = progress(None, 999);
        let remote = progress(Some(0.0), 1);
        let out = merge_progress(Some(&local), &remote, "dev-a", "dev-b");
        assert_eq!(out.winner, MergeWinner::Remote(remote));
        // None == None ties and falls through to updated_at.
        let out = merge_progress(
            Some(&progress(None, 100)),
            &progress(None, 200),
            "dev-a",
            "dev-b",
        );
        assert!(matches!(out.winner, MergeWinner::Remote(_)));
    }

    #[test]
    fn progress_missing_local_is_remote_union_keep() {
        let remote = progress(Some(0.5), 100);
        let out = merge_progress(None, &remote, "dev-a", "dev-b");
        assert_eq!(out.winner, MergeWinner::Remote(remote));
        assert_eq!(out.replaced_local, None);
    }

    // ---- annotation -----------------------------------------------------

    #[test]
    fn annotation_remote_only_record_survives_union() {
        let remote = annotation("x", 1, 0, 100);
        let out = merge_annotation(None, &remote, "dev-a", "dev-b", "copy-1");
        assert_eq!(out.winner, MergeWinner::Remote(remote));
        assert_eq!(out.replaced_local, None);
    }

    #[test]
    fn annotation_higher_revision_wins_outright() {
        let local = annotation("x", 1, 0, 100);
        let remote = annotation("x", 2, 0, 50); // newer lineage, older clock
        let out = merge_annotation(Some(&local), &remote, "dev-a", "dev-b", "c");
        assert_eq!(out.winner, MergeWinner::Remote(remote));
        assert_eq!(out.replaced_local, Some(local));

        let local = annotation("x", 3, 0, 100);
        let remote = annotation("x", 2, 0, 500);
        let out = merge_annotation(Some(&local), &remote, "dev-a", "dev-b", "c");
        assert_eq!(out.winner, MergeWinner::Local(local));
        assert_eq!(out.replaced_local, None);
    }

    #[test]
    fn annotation_equal_revision_tombstone_remove_wins() {
        let live = annotation("x", 2, 0, 100);
        let tomb = annotation("x", 2, 1, 100);
        let out = merge_annotation(Some(&live), &tomb, "dev-a", "dev-b", "c");
        assert_eq!(out.winner, MergeWinner::Remote(tomb.clone()));
        assert_eq!(out.replaced_local, Some(live.clone()));
        // A local tombstone also wins over a remote live record.
        let out = merge_annotation(Some(&tomb), &live, "dev-a", "dev-b", "c");
        assert_eq!(out.winner, MergeWinner::Local(tomb));
        assert_eq!(out.replaced_local, None);
    }

    #[test]
    fn annotation_equal_revision_same_hash_is_idempotent() {
        let local = annotation("x", 2, 0, 100);
        let mut remote = local.clone();
        remote.updated_at = 999; // transport-level difference, same content hash
        let out = merge_annotation(Some(&local), &remote, "dev-a", "dev-b", "c");
        assert_eq!(out.winner, MergeWinner::Local(local));
        assert_eq!(out.replaced_local, None);
    }

    #[test]
    fn annotation_equal_revision_different_hash_makes_conflict_copy() {
        let local = AnnotationRec {
            note: Some("原笔记".into()),
            ..annotation("x", 2, 0, 100)
        };
        let remote = annotation("y", 2, 0, 200); // same id+revision, other content
        let out = merge_annotation(Some(&local), &remote, "dev-a", "dev-b", "copy-uuid");
        match out.winner {
            MergeWinner::Both {
                kept,
                conflict_copy,
            } => {
                assert_eq!(kept, remote, "later updated_at keeps");
                // The copy keeps the loser's revision/content_hash/timestamps.
                assert_eq!(conflict_copy.revision, local.revision);
                assert_eq!(conflict_copy.content_hash, local.content_hash);
                assert_eq!(conflict_copy.created_at, local.created_at);
                assert_eq!(conflict_copy.updated_at, local.updated_at);
                assert_eq!(conflict_copy.note.as_deref(), Some("冲突副本：原笔记"));
            }
            other => panic!("expected Both, got {other:?}"),
        }
        assert_eq!(out.replaced_local, Some(local), "local displaced from its id");
    }

    #[test]
    fn annotation_conflict_copy_bare_prefix_when_no_note() {
        let local = annotation("x", 2, 0, 200); // kept (later updated_at)
        let remote = annotation("y", 2, 0, 100); // loses, note is None
        let out = merge_annotation(Some(&local), &remote, "dev-a", "dev-b", "c");
        match out.winner {
            MergeWinner::Both {
                kept,
                conflict_copy,
            } => {
                assert_eq!(kept, local);
                assert_eq!(conflict_copy.note.as_deref(), Some("冲突副本"));
            }
            other => panic!("expected Both, got {other:?}"),
        }
        assert_eq!(out.replaced_local, None, "local stayed at its id");
    }

    #[test]
    fn annotation_dual_hash_algo_never_cross_compares() {
        // Same id + revision; local tagged sha256, remote tagged blake3 with
        // the SAME hash string. A cross-algorithm compare would call this
        // identical content — the correct verdict is a conflict copy instead.
        let local = annotation("x", 2, 0, 100); // hash_algo sha256
        let mut remote = local.clone();
        remote.hash_algo = Some("blake3".into());
        let out = merge_annotation(Some(&local), &remote, "dev-a", "dev-b", "c");
        assert!(
            matches!(out.winner, MergeWinner::Both { .. }),
            "dual hash_algo must fork a conflict copy, never compare across algorithms"
        );
    }

    // ---- library --------------------------------------------------------

    #[test]
    fn library_remote_only_work_survives_union() {
        let remote = library("书", 100, 0, None);
        let out = merge_library(None, &remote, "dev-a", "dev-b");
        assert_eq!(out.winner, MergeWinner::Remote(remote));
        assert_eq!(out.replaced_local, None);
    }

    #[test]
    fn library_tombstone_anti_resurrection() {
        let live = library("书", 100, 0, None);
        let tomb = library("书", 100, 1, None);
        let out = merge_library(Some(&live), &tomb, "dev-a", "dev-b");
        assert_eq!(out.winner, MergeWinner::Remote(tomb.clone()));
        assert_eq!(out.replaced_local, Some(live.clone()));
        let out = merge_library(Some(&tomb), &live, "dev-a", "dev-b");
        assert_eq!(out.winner, MergeWinner::Local(tomb.clone()));
        // Both tombstones ⇒ idempotent.
        let out = merge_library(Some(&tomb), &tomb.clone(), "dev-a", "dev-b");
        assert!(matches!(out.winner, MergeWinner::Local(_)));
        assert_eq!(out.replaced_local, None);
    }

    #[test]
    fn library_both_live_file_sync_enabled_union() {
        let local = library(
            "书",
            100,
            0,
            Some(FileSyncRec {
                enabled: true,
                remote_path: Some("books/作者 - 书.epub".into()),
                size: Some(10),
                hash: Some("h".into()),
            }),
        );
        let remote = library("书", 200, 0, None); // kept (later imported_at)
        let out = merge_library(Some(&local), &remote, "dev-a", "dev-b");
        match out.winner {
            MergeWinner::Remote(kept) => {
                let fs = kept.file_sync.expect("file_sync union must survive");
                assert!(fs.enabled, "enabled if either side enabled");
                assert_eq!(fs.remote_path.as_deref(), Some("books/作者 - 书.epub"));
                assert_eq!(fs.size, Some(10));
                assert_eq!(fs.hash.as_deref(), Some("h"));
            }
            other => panic!("expected Remote, got {other:?}"),
        }
    }

    #[test]
    fn library_kept_is_deterministic_under_argument_swap() {
        let a = library("书", 100, 0, None);
        let b = library("书", 200, 0, None);
        let ab = merge_library(Some(&a), &b, "dev-a", "dev-b");
        let ba = merge_library(Some(&b), &a, "dev-b", "dev-a");
        let kept_ab = match ab.winner {
            MergeWinner::Remote(w) => w,
            other => panic!("expected Remote, got {other:?}"),
        };
        let kept_ba = match ba.winner {
            MergeWinner::Local(w) => w,
            other => panic!("expected Local, got {other:?}"),
        };
        assert_eq!(kept_ab, kept_ba, "same kept record under swap");
        assert_eq!(kept_ab.imported_at, 200);
    }

    // ---- map drivers ----------------------------------------------------

    #[test]
    fn progress_map_merges_union_and_stashes_displaced_local() {
        let local = BTreeMap::from([
            ("w1".to_string(), progress(Some(0.3), 100)),
            ("w2".to_string(), progress(Some(0.9), 100)), // local further — verbatim
        ]);
        let remotes = vec![(
            "dev-b".to_string(),
            BTreeMap::from([
                ("w1".to_string(), progress(Some(0.6), 50)),
                ("w3".to_string(), progress(Some(0.1), 10)), // remote-only — union keep
            ]),
        )];
        let (merged, stash) = merge_progress_map(&local, &remotes, "dev-a");
        assert_eq!(merged.len(), 3);
        assert_eq!(merged["w1"].progress_fraction, Some(0.6));
        assert_eq!(merged["w2"].progress_fraction, Some(0.9));
        assert_eq!(merged["w3"].progress_fraction, Some(0.1));
        assert_eq!(stash, vec![("w1".to_string(), progress(Some(0.3), 100))]);
    }

    #[test]
    fn annotation_map_adds_conflict_copies_under_allocated_ids() {
        let local = BTreeMap::from([("a1".to_string(), annotation("x", 2, 0, 100))]);
        let remotes = vec![(
            "dev-b".to_string(),
            BTreeMap::from([("a1".to_string(), annotation("y", 2, 0, 200))]),
        )];
        let mut n = 0u64;
        let mut id_alloc = || {
            n += 1;
            format!("copy-{n}")
        };
        let merged = merge_annotation_map(&local, &remotes, "dev-a", &mut id_alloc);
        assert_eq!(merged.len(), 2, "kept record plus one conflict copy");
        assert_eq!(merged["a1"].text_exact.as_deref(), Some("y"));
        assert_eq!(merged["copy-1"].text_exact.as_deref(), Some("x"));
        assert!(
            merged["copy-1"]
                .note
                .as_deref()
                .unwrap()
                .starts_with(CONFLICT_NOTE_PREFIX)
        );
    }

    // ---- property matrix (SYNC-05 no-data-loss) --------------------------

    /// Tiny deterministic PRNG (fixed-seed LCG — no rand dependency).
    struct Lcg(u64);

    impl Lcg {
        fn next(&mut self) -> u64 {
            self.0 = self
                .0
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            self.0 >> 11
        }

        fn below(&mut self, n: u64) -> u64 {
            self.next() % n
        }
    }

    /// The conflict-copy form of a record (note prefixed, everything else kept).
    fn prefixed(rec: &AnnotationRec) -> AnnotationRec {
        AnnotationRec {
            note: Some(match rec.note.as_deref() {
                Some(n) if !n.is_empty() => format!("{CONFLICT_NOTE_PREFIX}：{n}"),
                _ => CONFLICT_NOTE_PREFIX.to_string(),
            }),
            ..rec.clone()
        }
    }

    fn check_direction(
        local: &BTreeMap<String, AnnotationRec>,
        remote: &BTreeMap<String, AnnotationRec>,
        local_device: &str,
        remote_device: &str,
    ) {
        let remotes = || vec![(remote_device.to_string(), remote.clone())];
        let merge = |local: &BTreeMap<String, AnnotationRec>| {
            let mut n = 0u64;
            merge_annotation_map(local, &remotes(), local_device, &mut || {
                n += 1;
                format!("copy-{n:04}")
            })
        };
        let merged = merge(local);

        // 1) Union completeness — every annotation_id ever created on either
        // side is present under its own id, and no side record is silently
        // dropped: a displaced record is either authoritatively superseded
        // (revision lineage / tombstone rule) or survives as a conflict copy.
        for id in local.keys().chain(remote.keys()) {
            assert!(
                merged.contains_key(id),
                "union id {id} missing from merged output"
            );
            match (local.get(id), remote.get(id)) {
                (Some(l), None) => assert_eq!(
                    merged.get(id),
                    Some(l),
                    "local-only record at {id} was altered"
                ),
                (None, Some(r)) => assert_eq!(
                    merged.get(id),
                    Some(r),
                    "remote-only record at {id} was dropped"
                ),
                (Some(l), Some(r)) => {
                    let kept = &merged[id];
                    for rec in [l, r] {
                        if kept == rec {
                            continue;
                        }
                        let authoritative = rec.revision != kept.revision
                            || (rec.deleted == 1) != (kept.deleted == 1);
                        let as_copy = merged.values().any(|v| *v == prefixed(rec));
                        assert!(
                            authoritative || as_copy,
                            "side record at {id} silently dropped (SYNC-05)"
                        );
                    }
                }
                (None, None) => unreachable!(),
            }
        }

        // 2) Determinism — the same inputs merged twice give identical maps.
        assert_eq!(merge(local), merged, "same inputs must merge identically");

        // 3) Idempotence — merging the output again against the same remote
        // changes nothing (conflict copies are reused, never duplicated).
        assert_eq!(merge(&merged), merged, "re-merge must be idempotent");
    }

    /// Two devices perform interleaved create/edit/delete ops over a fixed pool
    /// of annotation ids (~200 ops, revision bumps per edit, deletes tombstone),
    /// then the merge runs (a) A-local/B-remote and (b) B-local/A-remote.
    #[test]
    fn dual_device_interleavings_never_lose_data() {
        const POOL: usize = 12;
        let ids: Vec<String> = (0..POOL).map(|i| format!("anno-{i:02}")).collect();
        let mut rng = Lcg(0x5EED);
        let mut dev_a: BTreeMap<String, AnnotationRec> = BTreeMap::new();
        let mut dev_b: BTreeMap<String, AnnotationRec> = BTreeMap::new();

        for op in 0..200i64 {
            let (map, tag) = if op % 2 == 0 {
                (&mut dev_a, "a")
            } else {
                (&mut dev_b, "b")
            };
            let id = ids[rng.below(POOL as u64) as usize].clone();
            match rng.below(10) {
                // create (falls back to edit when the id is already live here)
                0..=3 => {
                    let content = format!("{tag}-op{op}");
                    if map.get(&id).is_some_and(|r| r.deleted == 0) {
                        let rec = map.get_mut(&id).unwrap();
                        rec.revision += 1;
                        rec.updated_at = op;
                        rec.text_exact = Some(content.clone());
                        rec.content_hash = Some(format!("hash-{content}"));
                    } else {
                        map.insert(id.clone(), annotation(&content, 1, 0, op));
                    }
                }
                // edit a live record (revision bump + new content hash)
                4..=7 => {
                    let live: Vec<String> = map
                        .iter()
                        .filter(|(_, r)| r.deleted == 0)
                        .map(|(k, _)| k.clone())
                        .collect();
                    if !live.is_empty() {
                        let pick = &live[rng.below(live.len() as u64) as usize];
                        let content = format!("{tag}-edit{op}");
                        let rec = map.get_mut(pick).unwrap();
                        rec.revision += 1;
                        rec.updated_at = op;
                        rec.text_exact = Some(content.clone());
                        rec.content_hash = Some(format!("hash-{content}"));
                    }
                }
                // delete ⇒ tombstone (content columns retained, revision bump)
                _ => {
                    let live: Vec<String> = map
                        .iter()
                        .filter(|(_, r)| r.deleted == 0)
                        .map(|(k, _)| k.clone())
                        .collect();
                    if !live.is_empty() {
                        let pick = &live[rng.below(live.len() as u64) as usize];
                        let rec = map.get_mut(pick).unwrap();
                        rec.deleted = 1;
                        rec.revision += 1;
                        rec.updated_at = op;
                        rec.content_hash = Some(format!("hash-{tag}-del{op}"));
                    }
                }
            }
        }

        check_direction(&dev_a, &dev_b, "dev-a", "dev-b");
        check_direction(&dev_b, &dev_a, "dev-b", "dev-a");
    }
}
