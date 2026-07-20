#!/usr/bin/env python3
"""Convert the bundled Noto CJK fonts to Android-loadable WOFF2 files.

Why: Chromium's OTS rejects web fonts whose DECOMPRESSED sfnt payload exceeds
30 MiB. The variable Noto Serif CJK SC (52.8 MiB) failed to decode at all on
Android (silent fallback + per-section flicker), and the Sans VFs (29.3 MiB)
sat 700 KiB from the limit. WOFF2 compression alone does NOT help — OTS
measures the payload after Brotli decompression.

Strategy:
- Sans SC/TC: keep the full variable font, just recompress to WOFF2
  (12.9 MiB each, payload 29.3 MiB — passes).
- Serif SC: instance the VF into two static weights (wght 400/700, full glyph
  coverage preserved), then WOFF2 each (~26.6 MiB payload — passes).

Usage (isolated env, never global site-packages):
    python -m venv target/tmp/fontenv
    target/tmp/fontenv/Scripts/python -m pip install fonttools brotli
    target/tmp/fontenv/Scripts/python scripts/fonts-woff2.py

Inputs live in target/tmp/ (fetch from git history or upstream):
    target/tmp/NotoSansCJKsc-VF.otf, target/tmp/NotoSansCJKtc-VF.otf,
    target/tmp/NotoSerifCJKsc-VF.otf
Outputs are written to src-tauri/assets/fonts/noto-cjk/:
    NotoSansCJKsc-VF.woff2, NotoSansCJKtc-VF.woff2,
    NotoSerifCJKsc-400.woff2, NotoSerifCJKsc-700.woff2
"""
from pathlib import Path
import shutil
import sys

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

HERE = Path(__file__).resolve().parent.parent
SRC = HERE / "target" / "tmp"
OUT = HERE / "src-tauri" / "assets" / "fonts" / "noto-cjk"
OTS_LIMIT = 30 * 1024 * 1024  # Chromium OTS max decompressed web-font size

SANS = ["NotoSansCJKsc-VF.otf", "NotoSansCJKtc-VF.otf"]
SERIF = "NotoSerifCJKsc-VF.otf"
SERIF_WEIGHTS = (400, 700)


def save_woff2(font: TTFont, dst: Path) -> int:
    font.flavor = "woff2"
    font.save(dst)
    return dst.stat().st_size


def sfnt_size(font: TTFont, tmp: Path) -> int:
    """Payload size OTS measures: the plain-sfnt serialization."""
    font.flavor = None
    font.save(tmp)
    return tmp.stat().st_size


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = SRC / "_measure.otf"
    failures = []

    for name in SANS:
        src = SRC / name
        font = TTFont(src)
        assert "fvar" in font, f"{name} lost fvar"
        dst = OUT / src.with_suffix(".woff2").name
        packed = save_woff2(font, dst)
        payload = sfnt_size(TTFont(src), tmp)
        ok = payload <= OTS_LIMIT
        print(f"{name}: woff2 {packed / 2**20:.1f} MiB, payload {payload / 2**20:.1f} MiB  {'OK' if ok else 'OVER LIMIT'}")
        if not ok:
            failures.append(name)

    for w in SERIF_WEIGHTS:
        font = TTFont(SRC / SERIF)
        instantiateVariableFont(font, {"wght": w}, inplace=True)
        dst = OUT / f"NotoSerifCJKsc-{w}.woff2"
        packed = save_woff2(font, dst)
        payload = sfnt_size(font, tmp)
        ok = payload <= OTS_LIMIT
        print(f"serif wght={w}: woff2 {packed / 2**20:.1f} MiB, payload {payload / 2**20:.1f} MiB  {'OK' if ok else 'OVER LIMIT'}")
        if not ok:
            failures.append(f"serif-{w}")

    tmp.unlink(missing_ok=True)
    if failures:
        print(f"OVER OTS LIMIT: {failures}", file=sys.stderr)
        return 2
    print("all fonts converted and verified under OTS 30MiB payload limit")
    return 0


if __name__ == "__main__":
    sys.exit(main())
