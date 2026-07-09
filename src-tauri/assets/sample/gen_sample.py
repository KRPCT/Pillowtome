#!/usr/bin/env python3
"""Generate the bundled DRM-free sample EPUB (`sample.epub`) for FND-01/FND-02.

Self-authored, deterministic, stdlib-only. The text is original prose written
for this project and released CC0 (see LICENSE.txt) — it is genuinely DRM-free
and redistributable, and doubles as an early CJK (Simplified Chinese) render
smoke test. Chapter 1 is intentionally long enough to paginate across several
pages so the page-turn check (`renderer.next()`) has somewhere to go.

Run from the repo root:  python src-tauri/assets/sample/gen_sample.py
Rebuilds src-tauri/assets/sample/sample.epub byte-deterministically.
"""
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "sample.epub")

# A fixed DOS timestamp so the archive is byte-reproducible across runs.
FIXED_DATE = (2026, 7, 9, 0, 0, 0)
BOOK_ID = "urn:uuid:9f1c0a2e-7b3d-4e6a-8c5f-000000000001"

CONTAINER_XML = """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
"""

CONTENT_OPF = f"""<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">{BOOK_ID}</dc:identifier>
    <dc:title>枕籍示例书</dc:title>
    <dc:creator>Pillowtome</dc:creator>
    <dc:language>zh-CN</dc:language>
    <dc:rights>CC0 1.0 Universal (Public Domain Dedication)</dc:rights>
    <meta property="dcterms:modified">2026-07-09T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>
"""

NAV_XHTML = """<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
<head><meta charset="utf-8"/><title>目录</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
      <li><a href="ch1.xhtml">第一章 · 枕上闲话</a></li>
      <li><a href="ch2.xhtml">第二章 · 灯下细读</a></li>
    </ol>
  </nav>
</body>
</html>
"""

STYLE_CSS = """html { font-family: serif; }
body { margin: 1em; line-height: 1.8; }
h1 { font-size: 1.4em; margin: 0.6em 0; }
p { margin: 0 0 0.9em; text-indent: 2em; text-align: justify; }
"""

# Original CC0 prose (Simplified Chinese). Repeated blocks give chapter 1 enough
# length to span multiple paginated columns for the page-turn check.
CH1_PARAS = [
    "枕籍者，枕于书而籍于卷也。古人云，书中自有千钟粟，书中自有黄金屋；而于今日读书之人，所求不过是灯下一册、案头一茶，心神俱静，读得进去。",
    "这本小书并无深意，只是为了验证阅读器能否把中文的段落、标点与行距，妥帖地铺陈在一页之上。若你此刻能读到这一行字，那么渲染管线便是通的。",
    "中文排版讲究的是从容：字与字之间不逼仄，行与行之间有呼吸。标点该压则压，该悬则悬；断行不生硬，翻页不突兀。这些看似细微，却是一册好书与一堆乱码的分野。",
    "翻过这一页，故事仍在继续。请你轻点向后，看看下一页是否如约而至——若它来了，便说明分页与翻页都已就位，跨端阅读的第一步，算是稳稳地迈了出去。",
    "夜色渐深，窗外的风把树影摇得斑驳。屋内只余一盏小灯，照着摊开的书页，也照着读书人微微前倾的侧脸。他并不急着读完，只愿这一刻久一些，再久一些。",
    "文字是安静的旅伴。它不喧哗，不催促，只在你愿意的时候，缓缓向你走来。你读它一句，它便回你一程；你合上书页，它便在原地等你，从不走远。",
]

CH2_PARAS = [
    "第二章并不比第一章更长，它的存在只是为了证明：书不止一节，翻到尽头还能续上下一篇。跨越章节的那一下轻点，是阅读器最基本、也最要紧的本事。",
    "愿每一位在枕上、在灯下、在通勤的车厢里翻开这本小书的人，都能读得舒服，读得安心。中文阅读的体面，正是从这样一页页干净的排版里，一点一点长出来的。",
]


def _chapter(title: str, paras) -> str:
    body = "\n".join(f"  <p>{p}</p>" for p in paras)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN" lang="zh-CN">
<head><meta charset="utf-8"/><title>{title}</title>
<link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
  <h1>{title}</h1>
{body}
</body>
</html>
"""


def _add(zf: zipfile.ZipFile, name: str, data: str, *, store: bool = False) -> None:
    info = zipfile.ZipInfo(name, date_time=FIXED_DATE)
    info.compress_type = zipfile.ZIP_STORED if store else zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    zf.writestr(info, data)


def main() -> None:
    with zipfile.ZipFile(OUT, "w") as zf:
        # OCF requires "mimetype" first and stored (uncompressed), no extra field.
        _add(zf, "mimetype", "application/epub+zip", store=True)
        _add(zf, "META-INF/container.xml", CONTAINER_XML)
        _add(zf, "OEBPS/content.opf", CONTENT_OPF)
        _add(zf, "OEBPS/nav.xhtml", NAV_XHTML)
        _add(zf, "OEBPS/style.css", STYLE_CSS)
        _add(zf, "OEBPS/ch1.xhtml", _chapter("第一章 · 枕上闲话", CH1_PARAS))
        _add(zf, "OEBPS/ch2.xhtml", _chapter("第二章 · 灯下细读", CH2_PARAS))
    print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes)")


if __name__ == "__main__":
    main()
