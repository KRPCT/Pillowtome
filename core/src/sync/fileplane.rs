//! File-plane chunk planner (SYNC-04, plan 07-03) — **pure** functions, no IO.
//!
//! The upload state machine in `src-tauri`'s sync fileplane consumes these:
//! threshold decision ([`needs_chunking`]), the chunk arithmetic
//! ([`plan_chunks`]), zero-padded integer chunk names ([`chunk_name`]) whose
//! lexical order IS the assembly order (Nextcloud chunk v2), the resume diff
//! ([`missing_chunks`]), the 24h upload-dir expiry ([`is_upload_expired`]),
//! and the download integrity predicate ([`hash_matches_work_id`] — work_id IS
//! the blake3 hex, D-100 single source of truth).

use std::collections::BTreeSet;

/// Chunking threshold: at/above this size the capability branch runs
/// (Nextcloud chunk v2 vs generic streaming whole-file PUT); below it a
/// single streaming conditional PUT is used. 10MB satisfies the 5MB
/// Nextcloud chunk floor and stays far under the 100MB proxy body limit
/// (PITFALLS #8).
pub const CHUNK_THRESHOLD: u64 = 10 * 1024 * 1024;

/// Chunk payload size for the Nextcloud chunk v2 path. 10MB per chunk: each
/// in-flight chunk buffer is bounded to this, so a 300MB book never enters
/// memory wholesale (Pitfall 4).
pub const CHUNK_SIZE: u64 = 10 * 1024 * 1024;

/// Nextcloud upload dirs expire after 24h idle — a transfer older than this
/// restarts fresh (the server has already reaped the chunks).
pub const UPLOAD_EXPIRY_MS: i64 = 24 * 3600 * 1000;

/// 坚果云 (Nutstore) single-file upload limit (research A2, official limit).
pub const NUTSTORE_SINGLE_FILE_LIMIT: u64 = 500 * 1024 * 1024;

/// Below the threshold → single PUT; at/above → capability branch.
pub fn needs_chunking(size: u64) -> bool {
    size >= CHUNK_THRESHOLD
}

/// One planned chunk. `index` is 1-based (Nextcloud chunk names are 1..=N);
/// `offset`/`len` locate the payload inside the book file. The last chunk is
/// short unless the size is an exact multiple.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Chunk {
    pub index: u32,
    pub offset: u64,
    pub len: u64,
}

/// Lay out `ceil(size / CHUNK_SIZE)` chunks (indices 1..=N); empty for a
/// zero-byte file. Chunk count stays far under the protocol's 10000-chunk cap
/// for any book ≤ ~100GB.
pub fn plan_chunks(size: u64) -> Vec<Chunk> {
    if size == 0 {
        return Vec::new();
    }
    let count = size.div_ceil(CHUNK_SIZE);
    (0..count)
        .map(|i| {
            let offset = i * CHUNK_SIZE;
            Chunk {
                index: (i + 1) as u32,
                offset,
                len: CHUNK_SIZE.min(size - offset),
            }
        })
        .collect()
}

/// Zero-padded 5-width integer chunk name (`1` → `"00001"`). The padding
/// keeps lexical order == assembly order; 5 digits stay within the protocol's
/// 10000-chunk cap.
pub fn chunk_name(index: u32) -> String {
    format!("{:05}", index)
}

/// The resume diff: planned chunks whose index is NOT in the server-confirmed
/// `present` set. Server state (PROPFIND of the upload dir) is the truth; the
/// local row's chunk list is only a hint.
pub fn missing_chunks(planned: &[Chunk], present: &BTreeSet<u32>) -> Vec<Chunk> {
    planned
        .iter()
        .copied()
        .filter(|c| !present.contains(&c.index))
        .collect()
}

/// True when the transfer started more than [`UPLOAD_EXPIRY_MS`] ago.
pub fn is_upload_expired(started_at_ms: i64, now_ms: i64) -> bool {
    now_ms.saturating_sub(started_at_ms) > UPLOAD_EXPIRY_MS
}

/// The download hard gate (D-100): the streamed blake3 hex of the received
/// bytes must equal the work_id — `work_id_from_hash` is identity, so this is
/// plain string equality. A mismatch means a corrupted/tampered payload that
/// must never reach the library.
pub fn hash_matches_work_id(blake3_hex: &str, work_id: &str) -> bool {
    blake3_hex == work_id
}

#[cfg(test)]
mod tests {
    use super::*;

    const MB: u64 = 1024 * 1024;

    #[test]
    fn threshold_boundary() {
        assert!(!needs_chunking(0));
        assert!(!needs_chunking(CHUNK_THRESHOLD - 1));
        assert!(needs_chunking(CHUNK_THRESHOLD));
        assert!(needs_chunking(CHUNK_THRESHOLD + 1));
    }

    #[test]
    fn chunk_plan_arithmetic() {
        // Empty file plans nothing.
        assert!(plan_chunks(0).is_empty());
        // Tiny file: one short chunk.
        let tiny = plan_chunks(7);
        assert_eq!(
            tiny,
            vec![Chunk {
                index: 1,
                offset: 0,
                len: 7
            }]
        );
        // Exact multiple: no short tail.
        let exact = plan_chunks(2 * CHUNK_SIZE);
        assert_eq!(exact.len(), 2);
        assert_eq!(exact[1], Chunk {
            index: 2,
            offset: CHUNK_SIZE,
            len: CHUNK_SIZE
        });
        // Remainder: last chunk is short.
        let rem = plan_chunks(CHUNK_SIZE + 3);
        assert_eq!(rem.len(), 2);
        assert_eq!(rem[1], Chunk {
            index: 2,
            offset: CHUNK_SIZE,
            len: 3
        });
        // Offsets/tiles cover the file exactly.
        let plan = plan_chunks(2 * CHUNK_SIZE + 123);
        let total: u64 = plan.iter().map(|c| c.len).sum();
        assert_eq!(total, 2 * CHUNK_SIZE + 123);
        assert_eq!(plan[0].offset, 0);
        assert_eq!(plan[1].offset, CHUNK_SIZE);
        assert_eq!(plan[2].offset, 2 * CHUNK_SIZE);
        assert!(MB == 1024 * 1024); // sanity on the test constant
    }

    #[test]
    fn chunk_names_are_zero_padded_and_sort_in_assembly_order() {
        assert_eq!(chunk_name(1), "00001");
        assert_eq!(chunk_name(42), "00042");
        assert_eq!(chunk_name(9999), "09999");
        let mut names: Vec<String> = (1..=105).map(chunk_name).collect();
        let mut shuffled = names.clone();
        shuffled.reverse();
        shuffled.sort();
        names.sort();
        assert_eq!(shuffled, names, "lexical order must equal assembly order");
    }

    #[test]
    fn missing_chunks_diffs_against_the_server_set() {
        let planned = plan_chunks(2 * CHUNK_SIZE + 1); // 3 chunks
        let present: BTreeSet<u32> = [1, 2].into_iter().collect();
        let missing = missing_chunks(&planned, &present);
        assert_eq!(missing.len(), 1);
        assert_eq!(missing[0].index, 3);
        // Nothing present → everything missing; all present → nothing missing.
        assert_eq!(missing_chunks(&planned, &BTreeSet::new()).len(), 3);
        assert!(
            missing_chunks(&planned, &[1, 2, 3].into_iter().collect()).is_empty()
        );
    }

    #[test]
    fn expiry_edge() {
        assert!(!is_upload_expired(1_000, 1_000 + UPLOAD_EXPIRY_MS));
        assert!(is_upload_expired(1_000, 1_000 + UPLOAD_EXPIRY_MS + 1));
        // Clock skew backwards never expires.
        assert!(!is_upload_expired(2_000, 1_000));
    }

    #[test]
    fn hash_predicate_is_plain_equality() {
        assert!(hash_matches_work_id("abc123", "abc123"));
        assert!(!hash_matches_work_id("abc123", "abc124"));
        assert!(!hash_matches_work_id("", "abc"));
    }
}
