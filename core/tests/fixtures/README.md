# protection detector fixtures (FND-04)

Tiny EPUB-shaped fixtures for `core/tests/protection.rs`. All four are generated
deterministically by [`gen_fixtures.py`](./gen_fixtures.py) (Python stdlib only);
regenerate with `python core/tests/fixtures/gen_fixtures.py` from the repo root.
The `.epub` binaries are committed so tests run with no build-time codegen.

| Fixture | Construction | Expected classification |
|---------|--------------|-------------------------|
| `clean.epub` | Valid OCF zip: stored-first `mimetype`, `META-INF/container.xml`, minimal `OEBPS/content.opf` + one `section1.xhtml`. No `encryption.xml`, no `rights.xml`. | `Ok(Protection::None)` |
| `adept.epub` | Clean OCF structure **plus** `META-INF/rights.xml` (an Adobe ADEPT rights token — structure only, no usable key material). | `Ok(Protection::ContentDrm("Adobe ADEPT"))` |
| `font-obfuscated.epub` | Clean OCF structure **plus** a dummy `OEBPS/fonts/obfuscated.ttf` and a `META-INF/encryption.xml` whose only `EncryptionMethod/@Algorithm` is the IDPF font-obfuscation algorithm (`http://www.idpf.org/2008/embedding`) applied to that font. Legitimate obfuscation, **not** content DRM. | `Ok(Protection::FontObfuscationOnly)` |
| `corrupt.epub` | 60 bytes of truncated garbage that is not a valid zip. Deliberately lacks the PalmDB `BOOKMOBI`/`TPZ` magic so it soft-fails as corrupt, not Kindle. | `Err(CoreError::Corrupt)` |

Two more cases are exercised inline in `protection.rs` rather than as committed
binaries, so no hostile/opaque blobs live in the tree:

- **Kindle magic bytes** — a `BOOKMOBI` PalmDB header (not a zip) is built as a byte
  array in the test and must be refused (`ContentDrm("Kindle")` / `CoreError::Unsupported`).
- **Zip-slip** — an archive containing a `../evil` entry is built in-memory with the
  `zip` crate (dev-dependency) and must be rejected (`CoreError::Corrupt`).

The detector never decrypts anything (D-10); these fixtures carry no real keys or
encrypted content — only the structural markers the classifier reads.
