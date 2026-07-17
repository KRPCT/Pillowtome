import { useCallback, useEffect, useRef, useState } from "react";
import { ThemeProvider } from "@mui/material/styles";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getMuiTheme } from "../theme/mui";
import { makeBook } from "../vendor/foliate-js/view.js";
import {
  coerceToString,
  isHtmlType,
  needsTransform,
  transformSectionHtml,
} from "./cjk-content-transform";
import { pillowUrl } from "../lib/pillow";
import { ErrorCard } from "./error-card";
import { ReaderChrome } from "./ReaderChrome";
import { ReaderTapZones, type TapZoneAction } from "./ReaderTapZones";
import { SettingsSheet } from "./SettingsSheet";
import { SearchSheet } from "./SearchSheet";
import { TocSheet, normalizeToc } from "./TocSheet";
import {
  DEFAULT_PREFS,
  applyFoliateLayoutAttrs,
  buildReadingCss,
  flowAttr,
  type ReadingPrefs,
} from "./apply-reading-styles";
import {
  PREFS_SAVE_DEBOUNCE_MS,
  loadReadingPrefs,
  saveReadingPrefs,
} from "./reading-prefs";
import {
  LOCATOR_DEBOUNCE_MS,
  ensureWorkRow,
  loadLocator,
  relocateToLocatorRow,
  textContextFromRange,
  upsertLocator,
} from "./locator-store";
import {
  buildBundledCjkFontFaceCss,
  buildFontFaceCss,
  fontFamilyCssFor,
  importCustomFont,
  listCustomFonts,
  removeCustomFont,
  type CustomFont,
} from "./fonts";
import {
  detectCjkCssCaps,
  type CjkCssCaps,
} from "./cjk-feature-detect";
import {
  installAutospaceShim,
  shouldInstallAutospaceShim,
} from "./cjk-autospace-shim";
import type {
  FoliateBook,
  FoliateBookSection,
  FoliateViewElement,
  RelocateDetail,
} from "./foliate-types";
import { makeTxtBook } from "./txt-book";
import { updateLibraryItemMeta } from "../library/library-store";
import type { TocItem } from "./toc";
import {
  encodeScrollPosition,
  isRealCfi,
  positionFromLocatorCfi,
  spineToLinearIndex,
  wholeBookFraction,
  type ReadingPosition,
} from "./reading-position";
import {
  capturePosition,
  planJump,
  positionForTocSpine,
  spineFromResolvedNav,
} from "./position-bus";
import { cfiToRange, spineFromCfi } from "./scroll-cfi";
import { resolveAnchor } from "./anchor-resolver";
import { paletteColor, type PaletteColor } from "./css-highlight";
import { Overlayer } from "../vendor/foliate-js/overlayer.js";
import {
  deleteAnnotation,
  listAnnotations,
  upsertAnnotation,
  type AnnotationRow,
} from "./annotation-store";
import { SelectionBubble, type BubbleSelection } from "./SelectionBubble";
import {
  ContinuousScrollStream,
  type ContinuousScrollApi,
  type ContinuousSection,
  type ScrollAnchorResolver,
  type ScrollSelection,
} from "./ContinuousScrollStream";
import { ReaderBottomBar } from "./ReaderBottomBar";

/**
 * foliate-js 阅读视图 + immersive chrome + TOC + locator progress (READ-01..05).
 *
 * Constraints:
 * - Book bytes only via `fetch(pillow://...)` — never IPC (D-06).
 * - DRM gate via `check_protection` before `view.open` (D-10).
 * - Flow via `renderer.setAttribute("flow", flowAttr(mode))`.
 * - Typography/theme via `setStyles` + `margin` attribute + `data-theme` (D-22).
 * - Prefs: SQLite global only — never localStorage (D-20).
 * - Locator: CFI + fraction + text; debounced relocate + unmount flush (D-23..25).
 * - work_id via ensure_work (hash only over IPC, D-26).
 * - Immersive default + tap zones + desktop keys (READ-04, D-33).
 * - Clean-room chrome from UI-SPEC; no Readest AGPL (T-02-agpl / DEC-001).
 */

/** `check_protection` gate decision (small struct over IPC only). */
interface ProtectionDecision {
  canRender: boolean;
  message?: string;
}

/** `ensure_work` result — workId + contentHash only, never bytes (D-06). */
interface EnsureWorkResult {
  workId: string;
  contentHash: string;
}

/**
 * A settled text selection surfaced to the 05-04 bubble. `rects` are the
 * selection client rects in the section doc's own viewport; 05-04 maps them to
 * page coords via `iframe` (scroll) or the `foliate-view` host rect (paginate).
 */
export interface ReaderSelection {
  cfi: string;
  rects: DOMRect[];
  doc: Document;
  /** Present in scroll mode only (per-section iframe). */
  iframe?: HTMLIFrameElement;
  /** Spine index (paginate) or linear index (scroll) — mode-local carrier. */
  index: number;
}

export interface FoliateViewProps {
  /** Registered book id (SourceRegistry). */
  id?: string;
  /** Close reader → home shell. */
  onClose?: () => void;
  /**
   * Register a back handler with the shell (Android system back).
   * Handler returns true if the event was consumed (sheet/chrome/close).
   */
  registerBackHandler?: (handler: (() => boolean) | null) => void;
  /** A settled selection (paginate or scroll), or null on dismiss (05-04 bubble). */
  onSelection?: (sel: ReaderSelection | null) => void;
  /** Tapping an existing annotation → its CFI, so 05-04 reopens an edit bubble (D-73). */
  onSelectExisting?: (cfi: string) => void;
  /** The work's annotations, drawn/replayed in both modes (05-04 owns the store). */
  annotations?: AnnotationRow[];
}

type Status = "loading" | "reading" | "error";

/** Works whose engine metadata has already been backfilled this session. */
const metaBackfilled = new Set<string>();

/**
 * EPUB sniff (OCF): a zip whose uncompressed first entry is `mimetype` holding
 * `application/epub+zip`, so the literal string sits in the first bytes. EPUB
 * gets real metadata at import; MOBI/AZW3 also expose `transformTarget`, so that
 * is not a usable discriminator — this is.
 */
async function isEpubBlob(blob: Blob): Promise<boolean> {
  try {
    const head = new Uint8Array(await blob.slice(0, 200).arrayBuffer());
    if (head[0] !== 0x50 || head[1] !== 0x4b) return false; // not a zip
    return new TextDecoder("latin1")
      .decode(head)
      .includes("mimetypeapplication/epub+zip");
  } catch {
    return false;
  }
}

/** foliate metadata.author is a string, a creator object, or an array of them. */
function authorToString(a: unknown): string | null {
  const nameOf = (x: unknown): string =>
    typeof x === "string"
      ? x
      : x && typeof x === "object" && "name" in x
        ? String((x as { name: unknown }).name ?? "")
        : "";
  const names = (Array.isArray(a) ? a : [a]).map(nameOf).filter(Boolean);
  return names.length ? names.join("、").trim() || null : null;
}

/**
 * Backfill real title/author/cover for engine-parsed formats (Phase B). EPUB
 * alone exposes `transformTarget` (epub.js Loader) and already carries metadata
 * from import, so it is skipped. Best-effort and non-blocking.
 */
async function backfillMetadata(
  book: FoliateBook & { getCover?: () => Promise<Blob | null | undefined> },
  workId: string | null,
  isEpub: boolean,
): Promise<void> {
  if (!workId || isEpub || metaBackfilled.has(workId)) return;
  metaBackfilled.add(workId);
  try {
    const meta = (book.metadata ?? {}) as { title?: string; author?: unknown };
    const title = typeof meta.title === "string" ? meta.title.trim() : "";
    const author = authorToString(meta.author);

    // Cover extraction is the flaky part (render/parse); isolate it so a failure
    // never blocks the title/author backfill.
    let coverFile: string | null = null;
    try {
      if (typeof book.getCover === "function") {
        const blob = await book.getCover();
        if (blob && blob.size > 0) {
          const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
          const ext = blob.type.includes("png")
            ? "png"
            : blob.type.includes("webp")
              ? "webp"
              : "jpg";
          coverFile = await invoke<string>("save_cover", { workId, bytes, ext });
        }
      }
    } catch (coverErr) {
      console.warn("[FoliateView] cover backfill failed", coverErr);
    }

    if (title || author || coverFile) {
      await updateLibraryItemMeta(workId, { title, author, coverFile });
    }
  } catch (err) {
    console.warn("[FoliateView] metadata backfill failed", err);
    metaBackfilled.delete(workId); // allow a retry next open
  }
}

export function FoliateView({
  id = "sample",
  onClose,
  registerBackHandler,
  annotations,
}: FoliateViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<FoliateViewElement | null>(null);
  const onSelectionRef = useRef<(sel: ReaderSelection | null) => void>(() => {});
  const onSelectExistingRef = useRef<(cfi: string) => void>(() => {});
  const annotationsRef = useRef<AnnotationRow[]>(annotations ?? []);
  /** Section docs handed out by the paginate `load` event (closed shadow seam). */
  const sectionDocsRef = useRef<Map<number, Document>>(new Map());
  /** CFI keys currently drawn per section, so a redraw can remove stale overlays. */
  const drawnKeysRef = useRef<Map<number, Set<string>>>(new Map());
  const fxlRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefsRef = useRef<ReadingPrefs>(DEFAULT_PREFS);
  const workIdRef = useRef<string | null>(null);
  const pendingLocatorRef = useRef<ReturnType<typeof relocateToLocatorRow> | null>(
    null,
  );
  const locationRef = useRef<RelocateDetail | null>(null);

  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState<string>("");
  const [location, setLocation] = useState<RelocateDetail | null>(null);
  const [prefs, setPrefs] = useState<ReadingPrefs>(DEFAULT_PREFS);
  // Immersive default when reading (READ-04); starts true only during load chrome.
  const [chromeVisible, setChromeVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [fxlLocked, setFxlLocked] = useState(false);
  const [bookTitle, setBookTitle] = useState("");
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [customFonts, setCustomFonts] = useState<CustomFont[]>([]);
  const [fontStatus, setFontStatus] = useState<string | null>(null);
  /** The work's annotations (store-owned; drives both hosts' draw/replay). */
  const [annos, setAnnos] = useState<AnnotationRow[]>(annotations ?? []);
  const annosRef = useRef<AnnotationRow[]>(annos);
  annosRef.current = annos;
  annotationsRef.current = annos;
  /** Selection bubble anchor (reader-root coords) + create/edit context, or null. */
  const [bubble, setBubble] = useState<BubbleSelection | null>(null);
  /** The live selection backing the bubble's create/edit actions. */
  const bubbleSelRef = useRef<{
    cfi: string;
    textPre: string | null;
    textExact: string | null;
    textPost: string | null;
    fraction: number | null;
    editId?: string;
    type?: AnnotationRow["type"];
    color?: string | null;
  } | null>(null);
  /** Linear spine for continuous scroll mode (foliate has no continuous scroll). */
  const [continuousSections, setContinuousSections] = useState<
    ContinuousSection[]
  >([]);
  const [continuousCss, setContinuousCss] = useState("");
  const continuousStartRef = useRef(0);
  const continuousOffsetRef = useRef(0);
  const streamApiRef = useRef<ContinuousScrollApi | null>(null);
  /** Set when a scroll-mode seed already ran (handlePrefsChange / open restore)
   *  so the mode-switch effect doesn't re-seed + remount the stream a 2nd time. */
  const pendingSwitchSeedRef = useRef(false);
  /** Increment to force ContinuousScrollStream jump (TOC / resume / mode switch). */
  const [scrollJumpKey, setScrollJumpKey] = useState(0);
  const [scrollJumpSpine, setScrollJumpSpine] = useState<number | null>(null);
  /** Top-edge offset 0..1 within the jump target section. */
  const [scrollJumpOffset, setScrollJumpOffset] = useState(0);
  /** Optional real CFI for finer mid-section resume. */
  const [scrollJumpCfi, setScrollJumpCfi] = useState<string | null>(null);
  /** Optional real CFI for first mount of the stream (open resume). */
  const [initialCfi, setInitialCfi] = useState<string | null>(null);
  /** Bump to remount ContinuousScrollStream with fresh initial* props. */
  const [streamMountKey, setStreamMountKey] = useState(0);
  /** Bumped to re-open the book when 简繁/词不拆行 changes (content transform is
   *  applied at load via transformTarget, so it needs a fresh open to re-run). */
  const [reopenTick, setReopenTick] = useState(0);
  /** Cache the fetched EPUB bytes so a 简繁/词不拆行 re-open reuses them instead of
   *  re-streaming the whole (image-heavy) book over pillow:// each toggle. */
  const bookBlobRef = useRef<{ id: string; blob: Blob } | null>(null);
  /** Set when a re-open is a 简繁/词不拆行 toggle → load() uses in-memory prefs
   *  instead of re-reading the (possibly not-yet-flushed) DB. */
  const skipPrefsReloadRef = useRef(false);
  /** Session-cached CJK CSS caps (D-35) — probe once per reader open. */
  const cjkCapsRef = useRef<CjkCssCaps | null>(null);
  /** Disposers for paginate render-doc autospace shims. */
  const autospaceDisposersRef = useRef<Array<() => void>>([]);
  const [autospaceShimEnabled, setAutospaceShimEnabled] = useState(false);
  /** Chapter tick fractions (0..1) for the bottom scrubber. */
  const [chapterTicks, setChapterTicks] = useState<number[]>([]);
  /** "返回原位" undo pill visibility + captured pre-jump position. */
  const [undoVisible, setUndoVisible] = useState(false);
  const undoPosRef = useRef<ReadingPosition | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  prefsRef.current = prefs;
  locationRef.current = location;

  const anySheetOpen = settingsOpen || tocOpen || searchOpen;
  const anySheetOpenRef = useRef(false);
  anySheetOpenRef.current = anySheetOpen;
  const useContinuousScroll =
    prefs.mode === "scroll" && !fxlLocked && continuousSections.length > 0;

  // Stable identities: inline handlers change every render, which makes the
  // stream's onReady effect re-run and briefly null streamApiRef — a jump command
  // arriving in that window is lost (READER-POS C5).
  const handleStreamReady = useCallback((api: ContinuousScrollApi | null) => {
    streamApiRef.current = api;
  }, []);
  const handleStreamTap = useCallback(() => {
    if (!anySheetOpenRef.current) setChromeVisible((v) => !v);
  }, []);
  /** Normalize a scroll-mode selection into the shared ReaderSelection (05-04). */
  const handleScrollSelection = useCallback(
    (sel: ScrollSelection | null) => {
      onSelectionRef.current(
        sel
          ? {
              cfi: sel.cfi,
              rects: sel.rects,
              doc: sel.doc,
              iframe: sel.iframe,
              index: sel.linearIndex,
            }
          : null,
      );
    },
    [],
  );

  /** Reload the store list; state change redraws both hosts (Pitfall 9 lazy). */
  const reloadAnnos = useCallback(async () => {
    const wid = workIdRef.current;
    if (!wid) return;
    setAnnos(await listAnnotations(wid));
    streamApiRef.current?.redrawAnnotations();
  }, []);

  /** Map a section-doc rect + its origin into reader-root (`.reader__view`) coords. */
  const anchorRectInHost = useCallback(
    (
      rects: DOMRect[],
      origin: DOMRect | undefined,
    ): BubbleSelection["rect"] | null => {
      const host = hostRef.current?.getBoundingClientRect();
      const r = rects[0];
      if (!host || !r || !origin) return null;
      return {
        top: origin.top + r.top - host.top,
        left: origin.left + r.left - host.left,
        width: r.width,
        height: r.height,
      };
    },
    [],
  );

  /** A settled selection → open the create bubble anchored over it. */
  const handleReaderSelection = useCallback(
    (sel: ReaderSelection | null) => {
      if (!sel) {
        bubbleSelRef.current = null;
        setBubble(null);
        return;
      }
      const origin = sel.iframe
        ? sel.iframe.getBoundingClientRect()
        : viewRef.current?.getBoundingClientRect();
      const rect = anchorRectInHost(sel.rects, origin);
      if (!rect) {
        setBubble(null);
        return;
      }
      const selo = sel.doc.getSelection?.();
      const range =
        selo && selo.rangeCount > 0 ? selo.getRangeAt(0) : null;
      const ctx = textContextFromRange(range);
      bubbleSelRef.current = {
        cfi: sel.cfi,
        textPre: ctx.text_pre,
        textExact: ctx.text_exact,
        textPost: ctx.text_post,
        fraction: locationRef.current?.fraction ?? null,
      };
      setBubble({ rect, context: "create" });
    },
    [anchorRectInHost],
  );

  /** Tap on an existing highlight (paginate show-annotation) → edit bubble (D-73). */
  const handleSelectExisting = useCallback(
    (cfi: string) => {
      const a = annosRef.current.find((x) => x.cfi === cfi);
      const spine = spineFromCfi(cfi);
      const doc = spine != null ? sectionDocsRef.current.get(spine) : null;
      let rect: BubbleSelection["rect"] | null = null;
      if (doc) {
        const range = cfiToRange(doc, cfi);
        if (range) {
          rect = anchorRectInHost(
            Array.from(range.getClientRects()),
            viewRef.current?.getBoundingClientRect(),
          );
        }
      }
      if (!rect) {
        const host = hostRef.current?.getBoundingClientRect();
        rect = host ? { top: 12, left: host.width / 2, width: 0, height: 0 } : null;
      }
      if (!rect) return;
      bubbleSelRef.current = {
        cfi,
        textPre: a?.text_pre ?? null,
        textExact: a?.text_exact ?? null,
        textPost: a?.text_post ?? null,
        fraction: a?.progress_fraction ?? null,
        editId: a?.annotation_id,
        type: a?.type,
        color: a?.color ?? null,
      };
      setBubble({
        rect,
        context: "edit",
        color: (a?.color as PaletteColor) ?? undefined,
      });
    },
    [anchorRectInHost],
  );

  onSelectionRef.current = handleReaderSelection;
  onSelectExistingRef.current = handleSelectExisting;

  /** Build the shared field set for a create/recolor upsert from the live bubble. */
  const rowFromBubbleSelection = useCallback(
    (
      id: string,
      type: AnnotationRow["type"],
      color: string | null,
      note: string | null,
    ): AnnotationRow | null => {
      const s = bubbleSelRef.current;
      const wid = workIdRef.current;
      if (!s || !wid) return null;
      const now = Date.now();
      return {
        annotation_id: id,
        work_id: wid,
        type,
        cfi: s.cfi,
        color,
        text_pre: s.textPre,
        text_exact: s.textExact,
        text_post: s.textPost,
        progress_fraction: s.fraction,
        note,
        created_at: now,
        updated_at: now,
        revision: 0,
        content_hash: null,
        deleted: 0,
      };
    },
    [],
  );

  const handleBubbleCreate = useCallback(
    (type: "highlight" | "underline", color: PaletteColor) => {
      const s = bubbleSelRef.current;
      const id = s?.editId ?? crypto.randomUUID();
      // Recolor/retype keeps any existing note (D-73 edit context).
      const keepNote = s?.editId
        ? annosRef.current.find((a) => a.annotation_id === id)?.note ?? null
        : null;
      const row = rowFromBubbleSelection(id, type, color, keepNote);
      if (row) void upsertAnnotation(row).then(reloadAnnos);
      setBubble(null);
    },
    [reloadAnnos, rowFromBubbleSelection],
  );

  // Note editor is wired in Task 2; for now 笔记 ensures a highlight exists so
  // the note has something to hang off (D-72 — a note always attaches to a mark).
  const handleBubbleNote = useCallback(() => {
    const s = bubbleSelRef.current;
    if (!s) {
      setBubble(null);
      return;
    }
    if (!s.editId) {
      const row = rowFromBubbleSelection(
        crypto.randomUUID(),
        "highlight",
        (s.color as string) ?? "cinnabar",
        null,
      );
      if (row) void upsertAnnotation(row).then(reloadAnnos);
    }
    setBubble(null);
  }, [reloadAnnos, rowFromBubbleSelection]);

  const handleBubbleCopy = useCallback(() => {
    const text = bubbleSelRef.current?.textExact;
    if (text) void navigator.clipboard?.writeText?.(text);
  }, []);

  const handleBubbleDelete = useCallback(() => {
    const id = bubbleSelRef.current?.editId;
    if (id) void deleteAnnotation(id).then(reloadAnnos);
    setBubble(null);
  }, [reloadAnnos]);

  const ensureCjkCaps = useCallback((): CjkCssCaps => {
    if (!cjkCapsRef.current) {
      cjkCapsRef.current = detectCjkCssCaps();
    }
    return cjkCapsRef.current;
  }, []);

  const clearAutospaceShims = useCallback(() => {
    for (const dispose of autospaceDisposersRef.current) {
      try {
        dispose();
      } catch {
        /* soft-fail */
      }
    }
    autospaceDisposersRef.current = [];
  }, []);


  const buildCss = useCallback(
    (next: ReadingPrefs) => {
      const caps = ensureCjkCaps();
      const faces =
        buildFontFaceCss(next.activeFontId) + buildBundledCjkFontFaceCss();
      return buildReadingCss(
        next,
        faces,
        fontFamilyCssFor(next.fontFamilyKey, next.activeFontId),
        caps,
      );
    },
    [ensureCjkCaps],
  );

  /** Apply flow + layout attrs + setStyles to the live renderer (READ-01/02/03/06). */
  const applyPrefsToRenderer = useCallback(
    (next: ReadingPrefs) => {
      const caps = ensureCjkCaps();
      const css = buildCss(next);
      setContinuousCss(css);
      const wantShim = shouldInstallAutospaceShim(next, caps);
      setAutospaceShimEnabled(wantShim);

      // Continuous scroll owns the surface — skip foliate flow while scrolled.
      if (next.mode === "scroll" && !fxlRef.current) {
        clearAutospaceShims();
        return;
      }

      const view = viewRef.current;
      const renderer = view?.renderer;
      if (!renderer) return;
      if (fxlRef.current) return;

      const prevFlow = renderer.getAttribute?.("flow");
      const nextFlow = flowAttr(next.mode);
      renderer.setAttribute?.("flow", nextFlow);
      applyFoliateLayoutAttrs(renderer, hostRef.current?.clientHeight);
      renderer.setStyles?.(css);

      // Re-install autospace shim on paginate docs when needed (D-36/D-37).
      // NOTE: 简繁转换/词不拆行 are applied in SCROLL mode via the stream's own
      // per-iframe shim. They are NOT wired for paginate yet: foliate's paginator
      // iframe lives inside a CLOSED shadow root (paginator.js/view.js) that a DOM
      // shim can't reach — paginate needs foliate's `book.transformTarget`
      // content-transform hook (epub.js Loader.createURL) instead. See report.
      clearAutospaceShims();
      if (wantShim) {
        try {
          const root = view as unknown as {
            shadowRoot?: ShadowRoot | null;
            querySelectorAll?: (s: string) => NodeListOf<Element>;
          };
          const docs: Document[] = [];
          const collect = (node: ParentNode | null | undefined) => {
            if (!node?.querySelectorAll) return;
            node.querySelectorAll("iframe").forEach((frame) => {
              const d = (frame as HTMLIFrameElement).contentDocument;
              if (d) docs.push(d);
            });
          };
          collect(root?.shadowRoot ?? null);
          collect(hostRef.current);
          for (const d of docs) {
            autospaceDisposersRef.current.push(installAutospaceShim(d));
          }
        } catch {
          /* silent degrade D-38 */
        }
      }

      if (prevFlow !== nextFlow) {
        const cfi = locationRef.current?.cfi;
        requestAnimationFrame(() => {
          applyFoliateLayoutAttrs(renderer, hostRef.current?.clientHeight);
          renderer.setStyles?.(css);
          if (cfi && view) {
            void view.goTo(cfi).catch(() => {
              /* soft-fail */
            });
          }
        });
      }
    },
    [buildCss, clearAutospaceShims, ensureCjkCaps],
  );

  const scheduleSave = useCallback((next: ReadingPrefs) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveReadingPrefs(next).catch((err) => {
        console.warn("[FoliateView] prefs save failed", err);
      });
    }, PREFS_SAVE_DEBOUNCE_MS);
  }, []);

  const flushLocator = useCallback(async () => {
    if (locatorTimerRef.current) {
      clearTimeout(locatorTimerRef.current);
      locatorTimerRef.current = null;
    }
    const pending = pendingLocatorRef.current;
    if (!pending) return;
    pendingLocatorRef.current = null;
    try {
      await upsertLocator(pending);
    } catch (err) {
      console.warn("[FoliateView] locator flush failed", err);
    }
  }, []);

  /**
   * Replay this section's annotations through foliate (paginate). `addAnnotation`
   * only draws once the section's overlayer is rendered, so this runs on
   * `load`/`create-overlay` — lazily, per visible section (Pitfall 9), never a
   * whole-book bulk loop. When a stored CFI no longer resolves (structural CFI
   * broke after a 简繁/词不拆行 toggle), the shared resolver recovers a Range,
   * `getCFI` recomputes a fresh CFI, and the healed CFI is written back
   * (self-heal) before drawing.
   */
  const replayPaginateSection = useCallback((index: number) => {
    const view = viewRef.current;
    if (!view) return;
    const doc = sectionDocsRef.current.get(index) ?? null;
    // Remove this section's previously-drawn overlays first so deletes/edits are
    // reflected (addAnnotation keys by CFI value; a dropped annotation would linger).
    const prevKeys = drawnKeysRef.current.get(index);
    if (prevKeys) for (const key of prevKeys) void view.addAnnotation?.({ value: key }, true);
    const nextKeys = new Set<string>();
    for (const a of annotationsRef.current) {
      if (a.type !== "highlight" && a.type !== "underline") continue;
      if (spineFromCfi(a.cfi) !== index) continue;
      let value = a.cfi;
      if (doc) {
        const range = cfiToRange(doc, a.cfi);
        const ok = !!range && (range.getClientRects?.().length ?? 0) > 0;
        if (!ok) {
          const res = resolveAnchor(doc, a);
          const healedRange = res && "range" in res ? res.range : null;
          const healed = healedRange ? view.getCFI?.(index, healedRange) : null;
          if (healed && healed !== a.cfi) {
            value = healed;
            void upsertAnnotation({ ...a, cfi: healed });
          }
        }
      }
      nextKeys.add(value);
      void view.addAnnotation?.({ value, type: a.type, color: a.color });
    }
    drawnKeysRef.current.set(index, nextKeys);
  }, []);

  /** Attach selection→CFI on a paginate section doc (closed-shadow `load` seam). */
  const attachPaginateSelection = useCallback(
    (doc: Document, index: number) => {
      const emit = () => {
        const view = viewRef.current;
        const selo = doc.getSelection?.();
        if (!view || !selo || selo.isCollapsed || selo.rangeCount === 0) {
          onSelectionRef.current?.(null);
          return;
        }
        const range = selo.getRangeAt(0);
        if (range.collapsed) {
          onSelectionRef.current?.(null);
          return;
        }
        const cfi = view.getCFI?.(index, range);
        if (!cfi) return;
        onSelectionRef.current?.({
          cfi,
          rects: Array.from(range.getClientRects()),
          doc,
          index,
        });
      };
      const settle = () => doc.defaultView?.setTimeout(emit, 0);
      doc.addEventListener("pointerup", settle, { passive: true });
      doc.addEventListener("mouseup", settle, { passive: true });
      doc.addEventListener("selectionchange", () => {
        const s = doc.getSelection?.();
        if (!s || s.isCollapsed) onSelectionRef.current?.(null);
      });
    },
    [],
  );

  const scheduleLocatorUpsert = useCallback(
    (detail: RelocateDetail) => {
      const workId = workIdRef.current;
      if (!workId) {
        console.warn("[FoliateView] relocate ignored — no workId yet");
        return;
      }
      const row = relocateToLocatorRow(workId, detail);
      // Keep the best pending row even if CFI is momentarily missing.
      if (!row.cfi && row.progress_fraction == null) return;
      pendingLocatorRef.current = row;
      if (locatorTimerRef.current) clearTimeout(locatorTimerRef.current);
      locatorTimerRef.current = setTimeout(() => {
        locatorTimerRef.current = null;
        void flushLocator();
      }, LOCATOR_DEBOUNCE_MS);
    },
    [flushLocator],
  );

  /**
   * Synchronously resolve the current reading position → continuous linear start,
   * so switching paginate→scroll seeds the stream at the right section instead of
   * mounting at book start (READER-POS C6). Spine precedence: relocate
   * section.current → engine resolveCFI → pure spineFromCfi.
   */
  const readCurrentScrollStart = useCallback((): {
    spineIndex: number;
    linearIdx: number;
    offset: number;
    cfi: string | null;
  } | null => {
    const view = viewRef.current;
    const loc = locationRef.current;
    const last = (view as unknown as { lastLocation?: RelocateDetail })
      ?.lastLocation;
    const cfi =
      (typeof loc?.cfi === "string" ? loc.cfi : null) ??
      (typeof last?.cfi === "string" ? last.cfi : null);
    let spine: number | null =
      typeof loc?.section?.current === "number"
        ? loc.section.current
        : typeof last?.section?.current === "number"
          ? last.section.current
          : null;
    if (spine == null && isRealCfi(cfi)) {
      try {
        const r = view?.resolveCFI?.(cfi!);
        if (typeof r?.index === "number") spine = r.index;
      } catch {
        /* soft-fail */
      }
      if (spine == null) spine = spineFromCfi(cfi);
    }
    if (spine == null) return null;
    const li = spineToLinearIndex(spine, continuousSections);
    return {
      spineIndex: spine,
      linearIdx: li >= 0 ? li : 0,
      offset: continuousOffsetRef.current || 0,
      cfi: isRealCfi(cfi) ? cfi : null,
    };
  }, [continuousSections]);

  const handlePrefsChange = useCallback(
    (partial: Partial<ReadingPrefs> | ReadingPrefs) => {
      const prev = prefsRef.current;
      const next: ReadingPrefs = { ...prev, ...partial };
      // 简繁/词不拆行 rewrite section content at load (transformTarget) — a live
      // change needs a fresh open (foliate caches the transformed blob per href).
      const transformChanged =
        next.wordKeep !== prev.wordKeep || next.cnConvert !== prev.cnConvert;
      if (transformChanged) {
        prefsRef.current = next; // transform handler reads this on re-open
        setPrefs(next);
        scheduleSave(next);
        skipPrefsReloadRef.current = true; // re-open must use these prefs, not stale DB
        setReopenTick((k) => k + 1);
        return;
      }
      // Fully seed the stream BEFORE the switch commits so it mounts once, at the
      // right position (not book start, no double-mount). The mode-switch effect
      // sees pendingSwitchSeedRef and skips its own re-seed + remount.
      if (
        next.mode === "scroll" &&
        prefsRef.current.mode !== "scroll" &&
        !fxlRef.current
      ) {
        const start = readCurrentScrollStart();
        if (start) {
          continuousStartRef.current = start.linearIdx;
          continuousOffsetRef.current = start.offset;
          setInitialCfi(start.cfi);
          setScrollJumpCfi(start.cfi);
          setScrollJumpOffset(start.offset);
          setScrollJumpSpine(start.spineIndex);
          setStreamMountKey((k) => k + 1);
          setScrollJumpKey((k) => k + 1);
          pendingSwitchSeedRef.current = true;
        }
      }
      setPrefs(next);
      applyPrefsToRenderer(next);
      scheduleSave(next);
    },
    [applyPrefsToRenderer, scheduleSave, readCurrentScrollStart],
  );

  const refreshFonts = useCallback(async () => {
    try {
      setCustomFonts(await listCustomFonts());
    } catch (err) {
      console.warn("[FoliateView] list fonts failed", err);
    }
  }, []);

  const handleImportFont = useCallback(async () => {
    setFontStatus(null);
    try {
      const font = await importCustomFont();
      await refreshFonts();
      setFontStatus(`已导入「${font.familyName}」`);
    } catch (err) {
      const msg = String(err);
      if (msg.includes("已取消")) return;
      // Surface server-side limit / validation messages when present.
      const clean = msg
        .replace(/^Error:\s*/i, "")
        .replace(/^.*error:\s*/i, "")
        .trim();
      setFontStatus(
        clean && clean.length < 80
          ? clean
          : "导入失败，请确认格式为 TTF / OTF / WOFF 且未超限。",
      );
    }
  }, [refreshFonts]);

  const handleRemoveFont = useCallback(
    async (fontId: string, familyName: string) => {
      const ok = window.confirm(
        `确认移除「${familyName}」？此操作不会删除设备上的原文件。`,
      );
      if (!ok) return;
      try {
        await removeCustomFont(fontId);
        await refreshFonts();
        setFontStatus(null);
        // If removed font was active → fall back to system (D-29).
        if (prefsRef.current.activeFontId === fontId) {
          handlePrefsChange({
            fontFamilyKey: "system",
            activeFontId: null,
          });
        }
      } catch (err) {
        console.warn("[FoliateView] remove font failed", err);
        setFontStatus("移除字体失败，请重试。");
      }
    },
    [handlePrefsChange, refreshFonts],
  );

  const handleTapAction = useCallback((action: TapZoneAction) => {
    const view = viewRef.current;
    if (action === "toggle-chrome") {
      setChromeVisible((v) => !v);
      return;
    }
    if (!view) return;
    if (action === "prev") {
      void view.goLeft?.().catch(() => {
        void view.renderer?.prev?.();
      });
    } else if (action === "next") {
      void view.goRight?.().catch(() => {
        void view.renderer?.next?.();
      });
    }
  }, []);

  /** Resolve TOC/search/CFI target to spine index for continuous scroll. */
  const resolveSpineIndex = useCallback((target: string): number | null => {
    const view = viewRef.current;
    if (!view || !target) return null;
    try {
      const candidates: Array<{ index?: number } | null | undefined> = [
        view.resolveNavigation?.(target) as { index?: number } | null | undefined,
        view.book?.resolveHref?.(target) as { index?: number } | null | undefined,
        view.book?.resolveCFI?.(target) as { index?: number } | null | undefined,
      ];
      for (const resolved of candidates) {
        if (resolved && typeof resolved.index === "number" && resolved.index >= 0) {
          return resolved.index;
        }
      }
      // Path match against section.id (absolute book href).
      const hrefPath = decodeURI(target.split("#")[0] ?? "");
      if (hrefPath) {
        const hit = continuousSections.find((s) => {
          if (!s.id) return false;
          return (
            s.id === hrefPath ||
            s.id.endsWith(hrefPath) ||
            hrefPath.endsWith(s.id)
          );
        });
        if (hit) return hit.index;
      }
    } catch (err) {
      console.warn("[FoliateView] resolve spine failed", target, err);
    }
    return null;
  }, [continuousSections]);

  const jumpContinuousToSpine = useCallback(
    (
      spineIndex: number,
      offsetFraction = 0,
      cfi: string | null = null,
      anchor: ScrollAnchorResolver | null = null,
    ) => {
      // Single jump bus (READER-POS): plan then apply imperatively.
      const plan = planJump(
        {
          spineIndex,
          offsetFraction,
          cfi,
        },
        "scroll",
      );
      const li = spineToLinearIndex(plan.spineIndex, continuousSections);
      if (li < 0) {
        console.warn(
          "[FoliateView] jumpContinuousToSpine: spine not linear",
          plan.spineIndex,
        );
        return;
      }
      continuousStartRef.current = li;
      continuousOffsetRef.current = plan.offsetFraction;
      // Only a REAL fine cfi is a usable anchor. The section BASE cfi has no local
      // path, so resolveCfiScrollTop can't anchor it — and worse, it resolved to a
      // non-rendered node whose rect was NaN, overwriting the good offset target →
      // scrollTop=NaN → the jump silently no-op'd. For TOC/scrub (cfi=null) use the
      // offset math (base + offset*height) instead.
      const resolvedCfi = isRealCfi(cfi) ? cfi : null;

      // Prefer imperative API (no remount/jumpKey race).
      if (streamApiRef.current) {
        streamApiRef.current.jumpTo(
          plan.spineIndex,
          plan.offsetFraction,
          resolvedCfi,
          anchor,
        );
        return;
      }

      // Stream not mounted yet: seed props so mount/pendingJump picks them up.
      setScrollJumpOffset(plan.offsetFraction);
      setScrollJumpCfi(resolvedCfi);
      setScrollJumpSpine(plan.spineIndex);
      setInitialCfi(resolvedCfi);
      setStreamMountKey((k) => k + 1);
      setScrollJumpKey((k) => k + 1);
    },
    [continuousSections],
  );

  /** Snapshot the current position before a jump so "返回原位" can restore it. */
  const captureUndo = useCallback(() => {
    const loc = locationRef.current;
    if (!loc) return;
    const cfi = typeof loc.cfi === "string" ? loc.cfi : null;
    const spine =
      typeof loc.section?.current === "number"
        ? loc.section.current
        : isRealCfi(cfi)
          ? spineFromCfi(cfi)
          : null;
    undoPosRef.current = {
      spineIndex: spine ?? 0,
      offsetFraction: continuousOffsetRef.current || 0,
      cfi: isRealCfi(cfi) ? cfi : null,
      fraction: typeof loc.fraction === "number" ? loc.fraction : null,
    };
    setUndoVisible(true);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => setUndoVisible(false), 6000);
  }, []);

  const handleTocNavigate = useCallback(
    async (href: string) => {
      const view = viewRef.current;
      setTocOpen(false);
      if (!view || !href) return;
      captureUndo();

      if (useContinuousScroll) {
        let spine = resolveSpineIndex(href);
        if (spine == null) {
          // Engine resolveNavigation is the authoritative href→index path.
          try {
            const r = view.resolveNavigation?.(href) as
              | { index?: number }
              | null
              | undefined;
            spine = spineFromResolvedNav(r);
          } catch (err) {
            console.warn("[FoliateView] TOC resolveNavigation threw", href, err);
          }
        }
        if (spine == null) {
          // Last resort: ask engine to navigate (even if hidden), then read index.
          try {
            const r = (await view.goTo(href)) as { index?: number } | undefined;
            spine = spineFromResolvedNav(r);
            if (spine == null && typeof locationRef.current?.section?.current === "number") {
              spine = locationRef.current.section.current;
            }
          } catch (err) {
            console.warn("[FoliateView] TOC goTo fallback failed", href, err);
          }
        }
        if (spine != null) {
          const tocPos = positionForTocSpine(spine);
          jumpContinuousToSpine(tocPos.spineIndex, tocPos.offsetFraction, null);
          return;
        }
        console.warn("[FoliateView] TOC resolve failed in scroll mode", href);
        return;
      }

      try {
        await view.goTo(href);
      } catch (err) {
        console.warn("[FoliateView] TOC goTo failed", err);
        try {
          await view.goToTextStart();
        } catch {
          /* soft-fail */
        }
      }
    },
    [useContinuousScroll, resolveSpineIndex, jumpContinuousToSpine, captureUndo],
  );

  // In-book link clicked in a scroll-mode section iframe (paginate is handled by
  // foliate's own renderer). Resolve internal targets (filepos:/kindle:/#frag)
  // to a section + anchor and jump; open external URLs in the system browser.
  const handleInternalLink = useCallback(
    async (rawHref: string, fromLinearIdx: number) => {
      const view = viewRef.current;
      if (!view || !rawHref) return;
      const book = view.book as
        | {
            sections?: Array<{ resolveHref?: (h: string) => string | undefined }>;
            isExternal?: (uri: string) => boolean;
          }
        | undefined;

      // Section-relative resolution for EPUB relative hrefs; mobi/kf8 sections
      // have no resolveHref so filepos:/kindle: pass through untouched.
      const linearSecs = continuousSections.filter((s) => s.linear !== "no");
      const fromSpine = linearSecs[fromLinearIdx]?.index;
      const section =
        typeof fromSpine === "number" ? book?.sections?.[fromSpine] : undefined;
      const href = section?.resolveHref?.(rawHref) ?? rawHref;

      if (book?.isExternal?.(href) || /^(https?|mailto|tel):/i.test(href)) {
        try {
          await openUrl(href);
        } catch (err) {
          console.warn("[FoliateView] open external link failed", href, err);
        }
        return;
      }

      // Resolve href → { index, anchor } (kf8 resolveHref is async).
      let nav:
        | { index?: number; anchor?: ScrollAnchorResolver }
        | null
        | undefined;
      try {
        nav = (await view.resolveNavigation?.(href)) as typeof nav;
      } catch (err) {
        console.warn("[FoliateView] link resolveNavigation threw", href, err);
      }
      let spine = typeof nav?.index === "number" ? nav.index : null;
      if (spine == null) spine = resolveSpineIndex(href);

      if (!useContinuousScroll) {
        try {
          await view.goTo(href);
        } catch (err) {
          console.warn("[FoliateView] link goTo failed", href, err);
        }
        return;
      }
      if (spine == null) {
        console.warn("[FoliateView] internal link resolve failed", href);
        return;
      }
      captureUndo();
      const anchor = typeof nav?.anchor === "function" ? nav.anchor : null;
      jumpContinuousToSpine(spine, 0, null, anchor);
    },
    [
      continuousSections,
      useContinuousScroll,
      resolveSpineIndex,
      jumpContinuousToSpine,
      captureUndo,
    ],
  );

  const openSearch = useCallback(() => {
    setChromeVisible(true);
    setSearchOpen(true);
  }, []);

  const handleSearchJump = useCallback(
    async (cfi: string) => {
      const view = viewRef.current;
      setSearchOpen(false);
      if (!view || !cfi) return;
      captureUndo();

      if (useContinuousScroll) {
        const spine = resolveSpineIndex(cfi);
        if (spine != null) {
          jumpContinuousToSpine(spine);
          return;
        }
      }

      try {
        await view.goTo(cfi);
      } catch (err) {
        console.warn("[FoliateView] search goTo(cfi) failed", err);
      }
    },
    [useContinuousScroll, resolveSpineIndex, jumpContinuousToSpine, captureUndo],
  );

  const jumpToWholeFraction = useCallback(
    (frac: number) => {
      const view = viewRef.current;
      if (!view) return;
      const clamped = Math.max(0, Math.min(1, frac));
      if (useContinuousScroll) {
        const linear = continuousSections.filter((s) => s.linear !== "no");
        const n = linear.length || 1;
        const pos = Math.max(0, Math.min(n - 1e-6, clamped * n));
        const li = Math.floor(pos);
        const spine = linear[li]?.index;
        if (spine != null) jumpContinuousToSpine(spine, pos - li, null);
      } else {
        void view.goToFraction(clamped).catch(() => {
          /* soft-fail */
        });
      }
    },
    [useContinuousScroll, continuousSections, jumpContinuousToSpine],
  );

  const handleScrub = useCallback(
    (frac: number) => {
      captureUndo();
      jumpToWholeFraction(frac);
    },
    [captureUndo, jumpToWholeFraction],
  );

  const handleUndo = useCallback(() => {
    const pos = undoPosRef.current;
    setUndoVisible(false);
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    const view = viewRef.current;
    if (!pos || !view) return;
    if (useContinuousScroll) {
      jumpContinuousToSpine(
        pos.spineIndex,
        pos.offsetFraction,
        isRealCfi(pos.cfi ?? null) ? (pos.cfi ?? null) : null,
      );
    } else if (isRealCfi(pos.cfi ?? null)) {
      void view.goTo(pos.cfi as string).catch(() => {
        /* soft-fail */
      });
    } else if (pos.fraction != null) {
      void view.goToFraction(pos.fraction).catch(() => {
        /* soft-fail */
      });
    }
  }, [useContinuousScroll, jumpContinuousToSpine]);

  // Keep max-block-size in sync with host height so short pages don't float on tall screens.
  useEffect(() => {
    if (status !== "reading" || fxlRef.current) return;
    const host = hostRef.current;
    const renderer = viewRef.current?.renderer;
    if (!host || !renderer) return;

    const sync = () => {
      applyFoliateLayoutAttrs(renderer, host.clientHeight);
    };
    sync();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", sync);
      return () => window.removeEventListener("resize", sync);
    }
    const ro = new ResizeObserver(() => sync());
    ro.observe(host);
    return () => ro.disconnect();
  }, [status, prefs.mode]);

  // Mode switch: continuous stream is a SECOND surface. Snapshot SSOT position,
  // remount stream (paginate->scroll) or re-anchor engine (scroll->paginate).
  const prevContinuousRef = useRef(false);
  useEffect(() => {
    if (status !== "reading" || fxlRef.current) {
      prevContinuousRef.current = useContinuousScroll;
      return;
    }
    const view = viewRef.current;
    const host = hostRef.current;
    if (!view || !host) return;
    if (continuousSections.length === 0) return;

    const switchedToScroll = useContinuousScroll && !prevContinuousRef.current;
    const switchedFromScroll = !useContinuousScroll && prevContinuousRef.current;

    const readSsot = (): ReadingPosition | null => {
      const loc = locationRef.current;
      const last = (view as unknown as { lastLocation?: RelocateDetail }).lastLocation;
      const cfi =
        (typeof loc?.cfi === "string" ? loc.cfi : null) ??
        (typeof last?.cfi === "string" ? last.cfi : null);
      let spine: number | null =
        typeof loc?.section?.current === "number"
          ? loc.section.current
          : typeof last?.section?.current === "number"
            ? last.section.current
            : null;
      let offset = continuousOffsetRef.current || 0;

      // Prefer capturePosition (single bus) over ad-hoc field picking.
      const captured = capturePosition({
        cfi,
        spineIndex: spine,
        offsetFraction: offset,
        fraction: loc?.fraction ?? null,
      });
      if (captured) {
        if (captured.spineIndex === 0 && spine == null && isRealCfi(cfi)) {
          try {
            const resolved = view.resolveCFI?.(cfi!);
            if (typeof resolved?.index === "number") {
              return {
                ...captured,
                spineIndex: resolved.index,
                cfi,
              };
            }
          } catch {
            /* soft-fail */
          }
          const fromCfi = spineFromCfi(cfi);
          if (fromCfi != null) {
            return { ...captured, spineIndex: fromCfi, cfi };
          }
        }
        return captured;
      }
      if (spine == null) {
        const linear = continuousSections.filter((s) => s.linear !== "no");
        const sec = linear[continuousStartRef.current];
        if (sec) spine = sec.index;
      }
      if (spine == null) return null;
      return {
        spineIndex: spine,
        offsetFraction: offset,
        cfi: isRealCfi(cfi) ? cfi : null,
        fraction: loc?.fraction ?? null,
      };
    };

    if (useContinuousScroll) {
      if (switchedToScroll && !pendingSwitchSeedRef.current) {
        const pos = readSsot();
        if (pos) {
          const li = spineToLinearIndex(pos.spineIndex, continuousSections);
          if (li < 0) {
            console.warn(
              "[FoliateView] paginate->scroll: spine not in linear list",
              pos.spineIndex,
            );
          }
          continuousStartRef.current = li >= 0 ? li : 0;
          continuousOffsetRef.current = pos.offsetFraction;
          setInitialCfi(pos.cfi ?? null);
          setScrollJumpCfi(pos.cfi ?? null);
          setScrollJumpOffset(pos.offsetFraction);
          setScrollJumpSpine(pos.spineIndex);
          // Remount with correct initialLinearIndex/offset.
          setStreamMountKey((k) => k + 1);
          setScrollJumpKey((k) => k + 1);
          // If stream is already mounted (unlikely on first switch), jump imperatively next frame.
          requestAnimationFrame(() => {
            streamApiRef.current?.jumpTo(
              pos.spineIndex,
              pos.offsetFraction,
              pos.cfi ?? null,
            );
          });
        } else {
          console.warn("[FoliateView] paginate->scroll: no SSOT spine; stream starts at 0");
        }
      }
      pendingSwitchSeedRef.current = false;
      view.style.visibility = "hidden";
      view.style.pointerEvents = "none";
      setContinuousCss(buildCss(prefsRef.current));
      prevContinuousRef.current = true;
      return;
    }

    view.style.visibility = "";
    view.style.pointerEvents = "";
    const renderer = view.renderer;
    if (!renderer) return;
    renderer.setAttribute?.("flow", "paginated");
    applyFoliateLayoutAttrs(renderer, host.clientHeight);
    renderer.setStyles?.(buildCss(prefsRef.current));

    if (switchedFromScroll) {
      const pos = readSsot();
      void (async () => {
        let ok = false;
        if (pos?.cfi && isRealCfi(pos.cfi)) {
          try {
            ok = Boolean(await view.goTo(pos.cfi));
          } catch {
            /* soft-fail */
          }
        }
        if (!ok && pos) {
          try {
            await renderer.goTo?.({
              index: pos.spineIndex,
              anchor: pos.offsetFraction,
            });
            ok = true;
          } catch {
            /* soft-fail */
          }
        }
        if (!ok && pos) {
          try {
            await renderer.goTo?.({ index: pos.spineIndex });
          } catch {
            /* soft-fail */
          }
        }
      })();
    }
    prevContinuousRef.current = false;
  }, [status, useContinuousScroll, buildCss, continuousSections]);

  // Desktop keyboard: arrows/PageUp/Down page; Esc closes sheet; / Ctrl+F search (D-33).
  useEffect(() => {
    if (status !== "reading") return;

    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable);

      // Esc always closes topmost sheet first (even from search input).
      if (e.key === "Escape") {
        e.preventDefault();
        if (searchOpen) {
          setSearchOpen(false);
          return;
        }
        if (settingsOpen) {
          setSettingsOpen(false);
          return;
        }
        if (tocOpen) {
          setTocOpen(false);
          return;
        }
        if (!chromeVisible) setChromeVisible(true);
        return;
      }

      // Ctrl+F / Cmd+F opens search even from inputs (standard browser chord).
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        openSearch();
        return;
      }

      if (typing) return;

      // `/` opens search when not typing (D-33).
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        openSearch();
        return;
      }

      // Page keys only when no sheet is open
      if (settingsOpen || tocOpen || searchOpen) return;

      const view = viewRef.current;
      if (!view) return;

      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        void view.goLeft?.().catch(() => {
          void view.renderer?.prev?.();
        });
      } else if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        void view.goRight?.().catch(() => {
          void view.renderer?.next?.();
        });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [status, settingsOpen, tocOpen, searchOpen, chromeVisible, openSearch]);

  // Chapter tick marks for the bottom scrubber (section-start whole-book fractions).
  useEffect(() => {
    if (status !== "reading") return;
    const view = viewRef.current;
    const raw = view?.getSectionFractions?.() ?? [];
    let ticks = raw.filter((f) => f > 0.002 && f < 0.998);
    if (ticks.length > 50) {
      const step = Math.ceil(ticks.length / 40);
      ticks = ticks.filter((_, i) => i % step === 0);
    }
    setChapterTicks(ticks);
  }, [status, tocItems]);

  useEffect(
    () => () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    let created: FoliateViewElement | null = null;

    async function load() {
      try {
        // Prefs + fonts load in parallel with DRM/open (D-20). Fail-soft → defaults.
        // On a 简繁/词不拆行 re-open, use the in-memory prefs — the debounced save
        // may not have flushed yet, so re-reading the DB would revert the toggle
        // (the "繁体 needs two taps" bug) and cost an extra DB round-trip.
        const reusePrefs = skipPrefsReloadRef.current;
        skipPrefsReloadRef.current = false;
        const prefsPromise = reusePrefs
          ? Promise.resolve({ ...prefsRef.current })
          : loadReadingPrefs();
        const fontsPromise = listCustomFonts();

        // DRM/damage gate — classify before any book bytes (D-10).
        const decision = await invoke<ProtectionDecision>("check_protection", {
          id,
        });
        if (cancelled) return;
        if (!decision.canRender) {
          setMessage(decision.message ?? "无法打开这本书。");
          setStatus("error");
          return; // hard: do not call view.open
        }

        // Identity + saved locator BEFORE open so early relocate events can save,
        // and so we can restore after open (D-23..D-26).
        try {
          const ensured = await invoke<EnsureWorkResult>("ensure_work", { id });
          if (!cancelled && ensured?.workId) {
            workIdRef.current = ensured.workId;
            await ensureWorkRow(ensured.workId, ensured.contentHash, "epub");
          }
        } catch (err) {
          console.warn("[FoliateView] ensure_work failed; progress disabled", err);
          // Last-resort stable id so progress still works for sample/import.
          workIdRef.current = `work-${id}`;
          try {
            await ensureWorkRow(workIdRef.current, workIdRef.current, "epub");
          } catch {
            /* ignore */
          }
        }

        // Load this work's annotations once identity is known (drawn lazily
        // per section as sections load — never bulk here, Pitfall 9).
        void reloadAnnos();

        let savedLoc: Awaited<ReturnType<typeof loadLocator>> = null;
        if (workIdRef.current) {
          try {
            savedLoc = await loadLocator(workIdRef.current);
          } catch (err) {
            console.warn("[FoliateView] loadLocator failed", err);
          }
        }

        const host = hostRef.current;
        if (!host) return;

        // Book bytes stream only via custom protocol — never IPC (D-06). Reuse
        // the cached blob across re-opens (简繁/词不拆行 toggle) — same bytes.
        let blob = bookBlobRef.current?.id === id ? bookBlobRef.current.blob : null;
        if (!blob) {
          const res = await fetch(pillowUrl(id));
          if (!res.ok) throw new Error(`pillow fetch failed: ${res.status}`);
          blob = await res.blob();
          bookBlobRef.current = { id, blob };
        }
        if (cancelled) return;

        const view = document.createElement("foliate-view") as FoliateViewElement;
        created = view;
        viewRef.current = view;
        host.append(view);

        // relocate → progress UI + debounced locator upsert (D-23/D-24).
        // workIdRef is already set so the first relocate is not dropped.
        view.addEventListener("relocate", (event) => {
          const detail = (event as CustomEvent<RelocateDetail>).detail ?? {};
          const next: RelocateDetail = {
            fraction: detail.fraction ?? 0,
            cfi: detail.cfi,
            range: detail.range,
            tocItem: detail.tocItem,
            section: detail.section,
            location: detail.location,
          };
          setLocation(next);
          scheduleLocatorUpsert(next);
        });

        // Annotation seam (paginate) — ALL through foliate events because the
        // paginate iframe is in a CLOSED shadow root (no DOM shim / querySelector).
        // `load` is the only reachable doc seam; `draw-annotation` is the only draw
        // path; `create-overlay` fires once a section's overlayer exists; and
        // `show-annotation` reports a tap on an existing highlight (D-73).
        view.addEventListener("load", (event) => {
          const detail = (event as CustomEvent<{ doc?: Document; index?: number }>)
            .detail;
          const doc = detail?.doc;
          const index = detail?.index;
          if (!doc || typeof index !== "number") return;
          sectionDocsRef.current.set(index, doc);
          attachPaginateSelection(doc, index);
          replayPaginateSection(index);
        });
        view.addEventListener("draw-annotation", (event) => {
          const { draw, annotation, doc } = (
            event as CustomEvent<{
              draw: (fn: unknown, opts: { color: string }) => void;
              annotation: { type?: string; color?: string | null };
              doc?: Document;
            }>
          ).detail;
          const fn =
            annotation.type === "underline" ? Overlayer.underline : Overlayer.highlight;
          const color = doc ? paletteColor(doc, annotation.color ?? "cinnabar") : "#D24A32";
          draw(fn, { color });
        });
        view.addEventListener("create-overlay", (event) => {
          const index = (event as CustomEvent<{ index?: number }>).detail?.index;
          if (typeof index === "number") replayPaginateSection(index);
        });
        view.addEventListener("show-annotation", (event) => {
          const value = (event as CustomEvent<{ value?: string }>).detail?.value;
          if (value) onSelectExistingRef.current?.(value);
        });

        // Resolve prefs BEFORE opening so the transformTarget handler + first
        // section render see the correct 简繁/词不拆行 state (no first-section race).
        const loaded = await prefsPromise;
        const fonts = await fontsPromise;
        if (cancelled) return;
        setPrefs(loaded);
        prefsRef.current = loaded;
        setCustomFonts(fonts);

        // Parse the book ourselves so we can hook `transformTarget` BEFORE the
        // view renders the first section — this is how 简繁转换 / 词不拆行 reach
        // BOTH paginate + scroll (foliate's paginate iframe is in a closed shadow
        // a DOM shim can't touch), transforming content pre-render so CFI stays
        // stable. The pref is read live; toggling it re-opens the book (reopenTick).
        // foliate-js sniffs by content (EPUB/MOBI/AZW3/FB2/CBZ/PDF); plain text
        // has no handler and throws, so fall back to our txt→book adapter. The
        // adapter self-validates it is decodable text and returns null otherwise,
        // in which case we re-surface foliate's original error.
        let book: FoliateBook;
        try {
          book = await makeBook(new File([blob], `${id}.epub`));
        } catch (openErr) {
          // txt has no foliate transformTarget, so bake 简繁/词不拆行 into each
          // chapter's HTML here (reopenTick rebuilds with fresh prefs on toggle).
          const txtOpts = {
            convert: loaded.cnConvert,
            wordKeep: loaded.wordKeep,
            lang: "zh",
          };
          const txtBook = await makeTxtBook(blob, {
            transformHtml: needsTransform(txtOpts)
              ? (html) => transformSectionHtml(html, txtOpts)
              : undefined,
          });
          if (!txtBook) throw openErr;
          book = txtBook;
        }
        if (cancelled) return;
        book.transformTarget?.addEventListener("data", (ev: Event) => {
          const detail = (ev as CustomEvent<{ data: unknown; type?: string }>)
            .detail;
          if (!detail || !isHtmlType(detail.type)) return;
          const prefs = prefsRef.current;
          const opts = {
            convert: prefs.cnConvert,
            wordKeep: prefs.wordKeep,
            lang: book.metadata?.language,
          };
          if (!needsTransform(opts)) return;
          const original = detail.data;
          detail.data = coerceToString(original).then((str) =>
            str == null ? original : transformSectionHtml(str, opts),
          );
          detail.type = "text/html";
        });

        await view.open(book);
        if (cancelled) return;

        const isFxl = view.book?.rendition?.layout === "pre-paginated";
        fxlRef.current = Boolean(isFxl);
        setFxlLocked(Boolean(isFxl));

        // Live flow + layout + typography + theme + custom face + CJK (READ-01/02/03/06).
        if (!isFxl) {
          // Prefer paginated for engine path; continuous scroll uses stream UI.
          const engineMode =
            loaded.mode === "scroll" ? "paginate" : loaded.mode;
          view.renderer?.setAttribute?.("flow", flowAttr(engineMode));
          applyFoliateLayoutAttrs(view.renderer, host.clientHeight);
          const caps = ensureCjkCaps();
          const openCss = buildCss(loaded);
          view.renderer?.setStyles?.(openCss);
          setContinuousCss(openCss);
          const wantShim = shouldInstallAutospaceShim(loaded, caps);
          setAutospaceShimEnabled(wantShim);
        }

        // TOC for sheet (READ-05)
        setTocItems(normalizeToc(view.book?.toc));

        // Continuous scroll stream sections (linear spine only).
        const rawSections = view.book?.sections ?? [];
        const continuous: ContinuousSection[] = rawSections.map(
          (s: FoliateBookSection, index: number) => ({
            index,
            load: () => s.load(),
            unload: s.unload ? () => s.unload?.() : undefined,
            linear: s.linear,
            cfi: s.cfi,
            id: s.id,
          }),
        );
        setContinuousSections(continuous);
        setContinuousCss(buildCss(loaded));

        // Restore locator (D-25) via ReadingPosition SSOT helpers.
        // Fixed-layout (PDF/FXL comics) always renders through the paginated
        // engine even when the persisted mode is "scroll" — otherwise the FXL
        // renderer opens but is never navigated to a page and stays blank.
        const resumeScroll = loaded.mode === "scroll" && !isFxl;
        let restored = false;
        if (savedLoc?.cfi) {
          // Try resolve spine for real CFI up front.
          let spineHint: number | null = null;
          if (isRealCfi(savedLoc.cfi)) {
            try {
              const resolved = view.resolveCFI?.(savedLoc.cfi);
              if (typeof resolved?.index === "number") spineHint = resolved.index;
            } catch {
              /* soft-fail */
            }
            if (spineHint == null) spineHint = spineFromCfi(savedLoc.cfi);
          }
          const pos = positionFromLocatorCfi(
            savedLoc.cfi,
            savedLoc.progress_fraction,
            spineHint,
          );

          if (resumeScroll && pos) {
            const li = spineToLinearIndex(pos.spineIndex, continuous);
            continuousStartRef.current = li >= 0 ? li : 0;
            continuousOffsetRef.current = pos.offsetFraction;
            setInitialCfi(pos.cfi ?? null);
            setScrollJumpCfi(pos.cfi ?? null);
            setScrollJumpOffset(pos.offsetFraction);
            setScrollJumpSpine(pos.spineIndex);
            setStreamMountKey((k) => k + 1);
            setScrollJumpKey((k) => k + 1);
            pendingSwitchSeedRef.current = true;
            restored = true;
          } else if (!resumeScroll && pos) {
            if (isRealCfi(savedLoc.cfi)) {
              try {
                restored = Boolean(await view.goTo(savedLoc.cfi));
              } catch (err) {
                console.warn("[FoliateView] goTo(cfi) failed", err);
              }
            }
            if (!restored) {
              try {
                await view.renderer?.goTo?.({
                  index: pos.spineIndex,
                  anchor: pos.offsetFraction,
                });
                restored = true;
              } catch (err) {
                console.warn("[FoliateView] resume spine goTo failed", err);
              }
            }
          }
          setLocation({
            fraction: savedLoc.progress_fraction ?? undefined,
            cfi: savedLoc.cfi ?? undefined,
            section: pos ? { current: pos.spineIndex } : undefined,
          });
        }
        if (!restored && !resumeScroll) {
          try {
            await view.goToTextStart();
          } catch (err) {
            console.warn("[FoliateView] goToTextStart failed", err);
          }
        }

        // Best-effort title from engine metadata when present.
        const metaTitle = (
          view.book as { metadata?: { title?: string } } | undefined
        )?.metadata?.title;
        if (typeof metaTitle === "string" && metaTitle.trim()) {
          setBookTitle(metaTitle.trim());
        }

        // Phase B: backfill real title/author/cover for engine-parsed formats
        // (MOBI/AZW3/PDF import with only a filename title; the Rust core can't
        // parse them). EPUB already has meta from import, so skip it (detected by
        // byte sniff — MOBI/AZW3 also expose transformTarget). Once per work.
        void isEpubBlob(blob).then((isEpub) =>
          backfillMetadata(book, workIdRef.current, isEpub),
        );

        // Immersive default when status becomes reading (READ-04).
        setChromeVisible(false);
        setStatus("reading");
      } catch (err) {
        if (cancelled) return;
        // pdf.js and other engines throw non-Error objects that log as
        // "[object Object]"; surface name/message so failures are diagnosable.
        const e = err as { name?: string; message?: string };
        console.error("[FoliateView] 打开书籍失败", e?.name, e?.message, err);
        setMessage("文件已损坏或无法读取。");
        setStatus("error");
      }
    }

    void load();
    return () => {
      cancelled = true;
      clearAutospaceShims();
      cjkCapsRef.current = null;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        // Force flush pending prefs on unmount (D-22 companion to D-24).
        void saveReadingPrefs(prefsRef.current).catch(() => {
          /* ignore on teardown */
        });
        saveTimerRef.current = null;
      }
      // Force flush pending locator write (D-24).
      if (locatorTimerRef.current) {
        clearTimeout(locatorTimerRef.current);
        locatorTimerRef.current = null;
      }
      const pending = pendingLocatorRef.current;
      if (pending) {
        pendingLocatorRef.current = null;
        void upsertLocator(pending).catch(() => {
          /* ignore on teardown */
        });
      }
      created?.remove();
      viewRef.current = null;
      // Drop refs to the torn-down view's section docs (reopenTick re-populates).
      sectionDocsRef.current.clear();
      drawnKeysRef.current.clear();
    };
    // reopenTick: re-run (re-open the book) when 简繁/词不拆行 toggles so the
    // transformTarget content transform re-applies; position restores from the
    // saved locator.
  }, [id, reopenTick, scheduleLocatorUpsert, buildCss, clearAutospaceShims, ensureCjkCaps]);

  // Also flush locator when parent closes via onClose path — onClose may unmount us;
  // wrap onBack to flush first.
  const handleBack = useCallback(() => {
    // Always try to persist current engine location before leaving.
    const view = viewRef.current;
    const workId = workIdRef.current;
    if (workId && view && !useContinuousScroll) {
      const loc = locationRef.current;
      if (loc?.cfi || loc?.fraction != null) {
        pendingLocatorRef.current = relocateToLocatorRow(workId, loc);
      }
    }
    void flushLocator()
      .catch(() => {
        /* still leave */
      })
      .finally(() => {
        onClose?.();
      });
  }, [flushLocator, onClose, useContinuousScroll]);

  /**
   * Android system back stack inside reader:
   * sheet → hide chrome → leave book (return true = consumed).
   */
  const handleSystemBack = useCallback((): boolean => {
    if (searchOpen) {
      setSearchOpen(false);
      return true;
    }
    if (settingsOpen) {
      setSettingsOpen(false);
      return true;
    }
    if (tocOpen) {
      setTocOpen(false);
      return true;
    }
    if (chromeVisible) {
      setChromeVisible(false);
      return true;
    }
    // Leave reader → library
    handleBack();
    return true;
  }, [
    searchOpen,
    settingsOpen,
    tocOpen,
    chromeVisible,
    handleBack,
  ]);

  useEffect(() => {
    if (!registerBackHandler) return;
    registerBackHandler(handleSystemBack);
    return () => registerBackHandler(null);
  }, [registerBackHandler, handleSystemBack]);

  // Paginate: re-draw annotations for already-rendered sections when the list
  // changes (new highlight / edit / delete). Scroll mode redraws inside the stream.
  useEffect(() => {
    if (status !== "reading" || useContinuousScroll) return;
    for (const index of sectionDocsRef.current.keys()) replayPaginateSection(index);
  }, [annos, status, useContinuousScroll, replayPaginateSection]);

  /** Continuous-scroll progress → locator upsert via real CFI (same path as paginate). */
  /** Continuous-scroll progress -> locator upsert via real CFI (same path as paginate). */
  /**
   * Continuous-scroll progress.
   * Primary resume token: pillow-scroll:{spine}:{offset} (reliable).
   * Optional real CFI stored in the same cfi column when available; on restore
   * we detect epubcfi(...) vs pillow-scroll: and choose the right path.
   * Also keep a coarse progress_fraction for the UI bar.
   */
  /**
   * Continuous-scroll progress observation.
   * Writes SSOT location only — never mutates scrollJump* command state.
   */
  const handleContinuousProgress = useCallback(
    (spineIndex: number, offsetFraction: number, cfi: string | null) => {
      const workId = workIdRef.current;
      if (!workId) return;

      const li = spineToLinearIndex(spineIndex, continuousSections);
      continuousStartRef.current = li >= 0 ? li : continuousStartRef.current;
      continuousOffsetRef.current = offsetFraction;

      const token =
        isRealCfi(cfi) ? (cfi as string) : encodeScrollPosition(spineIndex, offsetFraction);
      const frac = wholeBookFraction(
        spineIndex,
        offsetFraction,
        continuousSections,
      );
      const row = relocateToLocatorRow(workId, { cfi: token, fraction: frac });
      pendingLocatorRef.current = row;
      setLocation({
        fraction: frac,
        cfi: token,
        section: { current: spineIndex },
      });
      if (locatorTimerRef.current) clearTimeout(locatorTimerRef.current);
      locatorTimerRef.current = setTimeout(() => {
        locatorTimerRef.current = null;
        void flushLocator().catch((err) => {
          console.warn("[FoliateView] continuous locator flush failed", err);
        });
      }, LOCATOR_DEBOUNCE_MS);
    },
    [continuousSections, flushLocator],
  );

  // Cached per-theme MUI theme (no createTheme on switch → no theme-switch lag).
  const muiTheme = getMuiTheme(prefs.theme);

  if (status === "error") {
    return (
      <ThemeProvider theme={muiTheme}>
        <ErrorCard message={message} onDismiss={onClose} />
      </ThemeProvider>
    );
  }

  const activeTocLabel =
    typeof location?.tocItem?.label === "string"
      ? location.tocItem.label
      : null;

  return (
    <ThemeProvider theme={muiTheme}>
      <div className="reader" data-theme={prefs.theme}>
        {/* Chrome only once reading — during load it would flash the default
            (day) theme bar + a placeholder title before saved prefs apply. */}
        {status === "reading" ? (
          <ReaderChrome
            title={bookTitle}
            fraction={location?.fraction ?? null}
            chromeVisible={chromeVisible}
            onBack={handleBack}
            onOpenToc={() => {
              setChromeVisible(true);
              setTocOpen(true);
            }}
            onOpenSearch={openSearch}
            onOpenSettings={() => {
              setChromeVisible(true);
              setSettingsOpen(true);
            }}
          />
        ) : null}

      {status === "loading" ? (
        <div className="reader__loading" aria-live="polite">
          加载中…
        </div>
      ) : null}

      <div ref={hostRef} className="reader__view">
        {status === "reading" && useContinuousScroll ? (
          <ContinuousScrollStream
            key={`stream-${id}-${streamMountKey}`}
            sections={continuousSections}
            initialLinearIndex={continuousStartRef.current}
            initialOffsetFraction={continuousOffsetRef.current}
            initialCfi={initialCfi}
            jumpKey={scrollJumpKey}
            targetSpineIndex={scrollJumpSpine}
            targetOffsetFraction={scrollJumpOffset}
            targetCfi={scrollJumpCfi}
            readingCss={continuousCss}
            autospaceShimEnabled={autospaceShimEnabled}
            onTap={handleStreamTap}
            onLinkClick={handleInternalLink}
            onProgress={handleContinuousProgress}
            annotations={annos}
            onSelection={handleScrollSelection}
            onReady={handleStreamReady}
          />
        ) : null}
        {status === "reading" && !useContinuousScroll ? (
          <ReaderTapZones
            enabled={!anySheetOpen}
            // FXL always paginates; without this a persisted "scroll" pref would
            // null out the overlay and taps/swipes couldn't turn the page.
            mode={fxlLocked ? "paginate" : prefs.mode}
            onAction={handleTapAction}
          />
        ) : null}
        {/* Selection action bubble — the ONLY pointer-events:auto overlay (D-74). */}
        <SelectionBubble
          selection={bubble}
          onCreate={handleBubbleCreate}
          onOpenNote={handleBubbleNote}
          onCopy={handleBubbleCopy}
          onDelete={handleBubbleDelete}
        />
      </div>

      {status === "reading" ? (
        <ReaderBottomBar
          visible={chromeVisible}
          fraction={location?.fraction ?? null}
          chapterLabel={activeTocLabel}
          ticks={chapterTicks}
          onScrub={handleScrub}
          undoVisible={undoVisible}
          onUndo={handleUndo}
        />
      ) : null}

      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        prefs={prefs}
        onPrefsChange={handlePrefsChange}
        modeLocked={fxlLocked}
        fonts={customFonts.map((f) => ({
          id: f.id,
          familyName: f.familyName,
        }))}
        onImportFont={() => {
          void handleImportFont();
        }}
        onRemoveFont={(fontId, familyName) => {
          void handleRemoveFont(fontId, familyName);
        }}
        fontStatus={fontStatus}
      />

      <TocSheet
        open={tocOpen}
        onOpenChange={setTocOpen}
        items={tocItems}
        activeLabel={activeTocLabel}
        onNavigate={handleTocNavigate}
      />

      <SearchSheet
        open={searchOpen}
        onOpenChange={setSearchOpen}
        view={viewRef.current}
        onJump={handleSearchJump}
      />
      </div>
    </ThemeProvider>
  );
}

export default FoliateView;
