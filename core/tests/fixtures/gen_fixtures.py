#!/usr/bin/env python3
"""Deterministic generator for the DRM/corruption detector fixtures (FND-04).

Run from the repo root:  python core/tests/fixtures/gen_fixtures.py

Produces four tiny EPUB-shaped files next to this script:

  clean.epub            valid OCF zip, no encryption.xml / rights.xml   -> Protection::None
  adept.epub            clean structure + META-INF/rights.xml (ADEPT)   -> ContentDrm("Adobe ADEPT")
  font-obfuscated.epub  clean structure + encryption.xml using ONLY the
                        IDPF font-obfuscation algorithm on a font entry  -> FontObfuscationOnly
  corrupt.epub          truncated / non-zip garbage                      -> Err(CoreError::Corrupt)

The zip-slip and Kindle-magic cases are exercised inline in core/tests/protection.rs
(no committed binary needed), so they are intentionally NOT emitted here.

The fixtures are committed; this script exists so their construction stays auditable
(no hand-edited binaries). It uses only the Python standard library.
"""
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))

CONTAINER_XML = """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
"""

CONTENT_OPF = """<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:00000000-0000-0000-0000-000000000001</dc:identifier>
    <dc:title>Pillowtome Fixture</dc:title>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    <item id="s1" href="section1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="s1"/>
  </spine>
</package>
"""

SECTION_XHTML = """<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN">
  <head><title>Fixture</title></head>
  <body><p>枕籍 fixture body.</p></body>
</html>
"""

# ADEPT rights token (structure only; contains no usable key material).
RIGHTS_XML = """<?xml version="1.0"?>
<adept:rights xmlns:adept="http://ns.adobe.com/adept">
  <adept:licenseToken>
    <adept:resource>urn:uuid:00000000-0000-0000-0000-0000000000ff</adept:resource>
  </adept:licenseToken>
</adept:rights>
"""

# encryption.xml using ONLY the IDPF font-obfuscation algorithm, applied to a
# font resource. This is legitimate obfuscation, NOT content DRM (Pitfall 4).
FONT_ENCRYPTION_XML = """<?xml version="1.0" encoding="UTF-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
            xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
    <enc:CipherData>
      <enc:CipherReference URI="OEBPS/fonts/obfuscated.ttf"/>
    </enc:CipherData>
  </enc:EncryptedData>
</encryption>
"""


def _write_ocf(zf: zipfile.ZipFile) -> None:
    """Write the shared clean OCF structure. mimetype MUST be stored-first."""
    zf.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip",
                compress_type=zipfile.ZIP_STORED)
    zf.writestr("META-INF/container.xml", CONTAINER_XML)
    zf.writestr("OEBPS/content.opf", CONTENT_OPF)
    zf.writestr("OEBPS/section1.xhtml", SECTION_XHTML)


def build_clean(path: str) -> None:
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        _write_ocf(zf)


def build_adept(path: str) -> None:
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        _write_ocf(zf)
        zf.writestr("META-INF/rights.xml", RIGHTS_XML)


def build_font_obfuscated(path: str) -> None:
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        _write_ocf(zf)
        # A dummy (already-"obfuscated") font blob; contents are irrelevant to detection.
        zf.writestr("OEBPS/fonts/obfuscated.ttf", b"\x00\x01\x00\x00obfuscated-font-bytes")
        zf.writestr("META-INF/encryption.xml", FONT_ENCRYPTION_XML)


def build_corrupt(path: str) -> None:
    # Not a zip: a truncated / garbage byte sequence. Kept short and deliberately
    # WITHOUT the PalmDB "BOOKMOBI"/"TPZ" magic so it classifies as Corrupt, not Kindle.
    with open(path, "wb") as f:
        f.write(b"PK\x03\x04 truncated pillowtome fixture -- not a real zip archive\n")


def main() -> None:
    build_clean(os.path.join(HERE, "clean.epub"))
    build_adept(os.path.join(HERE, "adept.epub"))
    build_font_obfuscated(os.path.join(HERE, "font-obfuscated.epub"))
    build_corrupt(os.path.join(HERE, "corrupt.epub"))
    for name in ("clean.epub", "adept.epub", "font-obfuscated.epub", "corrupt.epub"):
        p = os.path.join(HERE, name)
        print(f"{name}: {os.path.getsize(p)} bytes")


if __name__ == "__main__":
    main()
