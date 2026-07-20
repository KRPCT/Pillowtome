#!/usr/bin/env python3
"""Generate a deterministic 50-chapter EPUB for acceptance/stress testing.

Stdlib only (zipfile). Output: target/tmp/stress-50ch.epub
Each chapter: heading + 60 paragraphs of CJK prose (~4-8 pages per chapter on
a phone), plus an EPUB3 nav TOC with 50 entries.
"""
import zipfile
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent.parent / "target" / "tmp" / "stress-50ch.epub"
CHAPTERS = 50
PARAS = 60

SENTENCES = [
    "灯下翻书的人，最懂得纸页之间的安静。",
    "中文排版讲究从容，字与字之间不逼仄，行与行之间有呼吸。",
    "标点该压则压，该悬则悬；断行不生硬，翻页不突兀。",
    "夜色渐深，窗外的风把树影摇得斑驳。",
    "一本好书与一堆乱码的分野，往往就在这些看似细微的地方。",
    "阅读器的本分，是让每一页都稳稳地落在读者眼前。",
    "长句用来铺陈思绪，短句用来收束节奏。",
    "枕上闲读，是忙碌一天之后小小的仪式。",
]

CONTAINER = """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
"""


def chapter_xhtml(i: int) -> str:
    paras = "\n".join(
        f"    <p>{SENTENCES[(i + p) % len(SENTENCES)] * 2}（第{i}章·第{p + 1}段）</p>"
        for p in range(PARAS)
    )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN">
<head><title>第{i}章</title></head>
<body>
  <h1>第{i}章 · 长夜读书</h1>
{paras}
</body>
</html>
"""


def nav_xhtml() -> str:
    items = "\n".join(
        f'      <li><a href="ch{i:02d}.xhtml">第{i}章 · 长夜读书</a></li>' for i in range(1, CHAPTERS + 1)
    )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN">
<head><title>目录</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
{items}
    </ol>
  </nav>
</body>
</html>
"""


def content_opf() -> str:
    manifest = "\n".join(
        f'    <item id="ch{i:02d}" href="ch{i:02d}.xhtml" media-type="application/xhtml+xml"/>'
        for i in range(1, CHAPTERS + 1)
    )
    spine = "\n".join(f'    <itemref idref="ch{i:02d}"/>' for i in range(1, CHAPTERS + 1))
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">pillowtome-stress-50ch</dc:identifier>
    <dc:title>枕籍压力测试书 · 五十章</dc:title>
    <dc:language>zh-CN</dc:language>
    <dc:creator>枕籍测试夹具</dc:creator>
    <meta property="dcterms:modified">2026-07-20T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
{manifest}
  </manifest>
  <spine>
{spine}
  </spine>
</package>
"""


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        # mimetype must be first and stored uncompressed per OCF spec.
        z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", CONTAINER)
        z.writestr("OEBPS/content.opf", content_opf())
        z.writestr("OEBPS/nav.xhtml", nav_xhtml())
        for i in range(1, CHAPTERS + 1):
            z.writestr(f"OEBPS/ch{i:02d}.xhtml", chapter_xhtml(i))
    size = OUT.stat().st_size
    print(f"wrote {OUT} ({size / 2**20:.2f} MiB, {CHAPTERS} chapters)")


if __name__ == "__main__":
    main()
