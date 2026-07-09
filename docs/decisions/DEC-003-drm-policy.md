# DEC-003: DRM Policy — detect-and-refuse, never decrypt, soft-fail on corrupt

- **Status:** Accepted
- **Date:** 2026-07-09
- **Phase:** 1 (Foundation & Cross-Platform Skeleton)
- **Sources:** CONTEXT.md D-10; PITFALLS.md §§4,5; ARCHITECTURE.md safety boundary; implemented by `core::protection::detect_protection` (Plan 01-02)

## Statement

Pillowtome's DRM policy is **detect-and-refuse only**. The core detects protected
content — Adobe ADEPT (`META-INF/rights.xml`), Kindle containers (PalmDB
`BOOKMOBI`/`TPZ` magic bytes), and unknown/retailer content-encryption
algorithms in `META-INF/encryption.xml` — and **refuses cleanly** with a plain
"unsupported" message. We **never link a decryption library and never attempt
decryption**. Malformed, truncated, or otherwise corrupt EPUBs **soft-fail**
with a friendly "damaged" error and **never crash** (no panic). EPUBs that use
**font obfuscation only** (the legitimate IDPF/Adobe reversible scheme, keyed
from the book's own UID) are classified **distinctly** from content DRM and
**MAY** be refused-with-message or rendered in P1 — both satisfy this policy.

## Rationale

- **Legal / repudiation:** attempting to circumvent DRM, or linking a decryption
  library, creates legal and license exposure. Detect-and-refuse keeps the app
  cleanly on the right side of that boundary (aligns with the clean-room
  discipline in DEC-001).
- **`META-INF/encryption.xml` is three-valued** (PITFALLS §4): it is present for
  (a) legitimate **font obfuscation** — *not* DRM, safe to read, (b) algorithm
  encryption, and (c) retailer content DRM. Refusing *every* book with an
  `encryption.xml` would wrongly reject legitimately-obfuscated-font books, so
  classification distinguishes font-obfuscation-only from content DRM.
- **Robustness:** untrusted book bytes must never crash the reader. A bad zip,
  missing `container.xml`, or a zip-slip entry returns a typed
  `CoreError::Corrupt` surfaced as an error card — never a panic (PITFALLS §5).

## Consequences

- The detector lives in portable `core` (`detect_protection` → `Protection`),
  reads the EPUB zip **read-only**, and is fully unit-testable off-device
  (delivered in Plan 01-02, satisfying FND-04).
- No crypto/decrypt dependency is ever linked; the render layer calls
  `detect_protection` as a **pre-serve gate** before streaming any bytes over
  `pillow://`.
- ADEPT and Kindle are refused as content DRM; unknown algorithms are refused;
  font-obfuscation-only is classified separately (render-or-refuse is a UX call
  for the reading slice — either is compliant).
- Corrupt/hostile archives soft-fail as `CoreError::Corrupt`; zip-slip entries
  are rejected on the read path.

## References

- D-10 (detect-and-refuse; never decrypt; corrupt EPUBs soft-fail, no crash).
- `core::protection::detect_protection` (Plan 01-02): three-way `Protection`
  classification (None / FontObfuscationOnly / ContentDrm / Unknown), zip-slip
  guard, Kindle magic-byte detection.
- PITFALLS.md §4 (font-obfuscation vs content DRM), §5 (soft-fail on malformed).
