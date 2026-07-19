import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import "../index.css";
import "../App.css";
import { installTauriMock } from "./tauri-mock";

// 必须先装 mock，再加载任何触碰 Tauri API 的应用模块。
installTauriMock();

import App from "../App";
import { ThemeProvider } from "@mui/material/styles";
import { getMuiTheme } from "../theme/mui";
import { ReaderChrome } from "../reader/ReaderChrome";
import { ReaderBottomBar } from "../reader/ReaderBottomBar";
import { SelectionBubble } from "../reader/SelectionBubble";
import { SettingsSheet } from "../reader/SettingsSheet";
import { TocSheet } from "../reader/TocSheet";
import { SearchSheet } from "../reader/SearchSheet";
import { AnnotationsSheet } from "../reader/AnnotationsSheet";
import { NoteEditorSheet } from "../reader/NoteEditorSheet";
import { DEFAULT_PREFS, type ReadingPrefs } from "../reader/apply-reading-styles";
import type { AnnotationRow } from "../reader/annotation-store";

/**
 * 阅读器 chrome 审计 harness：真 ReaderChrome / ReaderBottomBar / 各 sheet /
 * 划词气泡，书页区域用占位段落（folio iframe 布局不在此审计范围）。
 */
function ReaderHarness() {
  const [prefs, setPrefs] = useState<ReadingPrefs>(DEFAULT_PREFS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [annotationsOpen, setAnnotationsOpen] = useState(false);
  const [noteTarget, setNoteTarget] = useState<AnnotationRow | null>(null);
  const [bookmarked, setBookmarked] = useState(false);
  const [bubbleAt, setBubbleAt] = useState<"right" | "left" | null>("right");

  const now = Date.now();
  const annos: AnnotationRow[] = [
    {
      annotation_id: "a1",
      work_id: "work-1",
      type: "highlight",
      cfi: "epubcfi(/6/4!/2/2/1:0)",
      color: "cinnabar",
      text_pre: null,
      text_exact: "女儿是水作的骨肉，男人是泥作的骨肉。",
      text_post: null,
      progress_fraction: 0.12,
      note: "初见即惊",
      created_at: now - 3600_000,
      updated_at: now - 3600_000,
      revision: 0,
      content_hash: null,
      deleted: 0,
    },
    {
      annotation_id: "a2",
      work_id: "work-1",
      type: "bookmark",
      cfi: "epubcfi(/6/8!/2/4/1:0)",
      color: null,
      text_pre: null,
      text_exact: null,
      text_post: null,
      progress_fraction: 0.374,
      note: null,
      created_at: now - 7200_000,
      updated_at: now - 7200_000,
      revision: 0,
      content_hash: null,
      deleted: 0,
    },
  ];

  const hostW = typeof window === "undefined" ? 360 : window.innerWidth;
  const bubbleSel =
    bubbleAt === null
      ? null
      : {
          rect:
            bubbleAt === "right"
              ? { top: 220, left: hostW - 34, width: 26, height: 22 }
              : { top: 220, left: 6, width: 26, height: 22 },
          context: "create" as const,
        };

  const paragraphs = [
    "话说女娲氏炼石补天之时，于大荒山无稽崖炼成高经十二丈、方经二十四丈顽石三万六千五百零一块。娲皇氏只用了三万六千五百块，只单单剩了一块未用，便弃在此山青埂峰下。",
    "谁知此石自经煅炼之后，灵性已通，因见众石俱得补天，独自己无材不堪入选，遂自怨自叹，日夜悲号惭愧。",
    "一日，正当嗟悼之际，俄见一僧一道远远而来，生得骨格不凡，丰神迥异，说说笑笑来至峰下，坐于石边高谈快论。",
    "The quick brown fox jumps over the lazy dog. 中英文混排时应注意间距与基线对齐，1234567890。",
  ];

  return (
    <ThemeProvider theme={getMuiTheme(prefs.theme)}>
      <div className="reader" data-theme={prefs.theme}>
        <ReaderChrome
          title="红楼梦"
          author="曹雪芹"
          chromeVisible
          bookmarked={bookmarked}
          onBack={() => undefined}
          onOpenToc={() => setTocOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenAnnotations={() => setAnnotationsOpen(true)}
          onToggleBookmark={() => setBookmarked((v) => !v)}
        />

        <div className="reader__view" style={{ overflow: "hidden" }}>
          <div
            style={{
              padding: "84px 24px 80px",
              maxWidth: 680,
              margin: "0 auto",
              fontFamily: "var(--font-serif)",
              fontSize: 18,
              lineHeight: 1.75,
              color: "var(--page-fg, #2a251c)",
              background: "var(--page-bg, #fbf8f2)",
              minHeight: "100%",
              boxSizing: "border-box",
            }}
          >
            {paragraphs.map((p, i) => (
              <p key={i} style={{ textIndent: "2em", margin: "0 0 1em" }}>
                {p}
              </p>
            ))}
            <p style={{ fontSize: 12, opacity: 0.6 }}>
              [harness] 气泡边缘：
              <button type="button" onClick={() => setBubbleAt("left")}>
                左缘
              </button>{" "}
              <button type="button" onClick={() => setBubbleAt("right")}>
                右缘
              </button>{" "}
              <button type="button" onClick={() => setBubbleAt(null)}>
                关
              </button>{" "}
              <button
                type="button"
                onClick={() =>
                  setNoteTarget({ ...annos[0] })
                }
              >
                笔记编辑器
              </button>
            </p>
          </div>
          <SelectionBubble
            selection={bubbleSel}
            onCreate={() => setBubbleAt(null)}
            onOpenNote={() => setBubbleAt(null)}
            onCopy={() => undefined}
            onDelete={() => setBubbleAt(null)}
          />
        </div>

        <ReaderBottomBar
          visible
          fraction={0.374}
          chapterLabel="第二十四回 醉金刚轻财尚义侠 痴女儿遗帕惹相思"
          ticks={[0.08, 0.2, 0.35, 0.52, 0.68, 0.83, 0.94]}
          onScrub={() => undefined}
          undoVisible
          onUndo={() => undefined}
        />

        <SettingsSheet
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          prefs={prefs}
          onPrefsChange={(p) => setPrefs((prev) => ({ ...prev, ...p }))}
          theme={prefs.theme}
          fonts={[]}
        />
        <TocSheet
          open={tocOpen}
          onOpenChange={setTocOpen}
          items={[
            { label: "第一回 甄士隐梦幻识通灵", href: "#1" },
            { label: "第二回 贾夫人仙逝扬州城", href: "#2" },
            {
              label:
                "第二十四回 醉金刚轻财尚义侠 痴女儿遗帕惹相思",
              href: "#24",
            },
          ]}
          activeLabel="第二十四回 醉金刚轻财尚义侠 痴女儿遗帕惹相思"
          onNavigate={() => setTocOpen(false)}
          theme={prefs.theme}
        />
        <SearchSheet
          open={searchOpen}
          onOpenChange={setSearchOpen}
          view={null}
          onJump={() => setSearchOpen(false)}
          theme={prefs.theme}
        />
        <AnnotationsSheet
          open={annotationsOpen}
          onOpenChange={setAnnotationsOpen}
          annotations={annos}
          chapterLabel={(s) => `第 ${s + 1} 回`}
          onJump={() => setAnnotationsOpen(false)}
          onDelete={() => undefined}
          theme={prefs.theme}
        />
        <NoteEditorSheet
          annotation={noteTarget}
          onClose={() => setNoteTarget(null)}
          theme={prefs.theme}
        />
      </div>
    </ThemeProvider>
  );
}

const isReader =
  window.location.search.includes("reader") ||
  window.location.hash.startsWith("#reader");
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isReader ? <ReaderHarness /> : <App />}</React.StrictMode>,
);
