/**
 * In-book search sheet (READ-07, D-31..D-34).
 * Uses foliate `view.search()` whole-book generator — never matchWholeWords.
 * Clean-room from UI-SPEC (T-02-agpl).
 */

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { buildSearchOpts, SEARCH_DEBOUNCE_MS } from "./search-opts";
import type { FoliateViewElement } from "./foliate-types";
import type { ReadingTheme } from "./apply-reading-styles";

export interface SearchHit {
  cfi: string;
  label: string;
  pre: string;
  match: string;
  post: string;
}

export interface SearchSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Live foliate view; null when not ready. */
  view: FoliateViewElement | null;
  /** Jump to CFI then close sheet. */
  onJump: (cfi: string) => void | Promise<void>;
  /** Reader theme — flips the sheet to 墨壳 at night. */
  theme?: ReadingTheme;
}

interface ExcerptShape {
  pre?: string;
  match?: string;
  post?: string;
}

interface SubitemShape {
  cfi?: string;
  excerpt?: ExcerptShape;
}

interface SectionResult {
  label?: string;
  subitems?: SubitemShape[];
  progress?: number;
  cfi?: string;
  excerpt?: ExcerptShape;
}

function excerptParts(ex: ExcerptShape | undefined): {
  pre: string;
  match: string;
  post: string;
} {
  return {
    pre: typeof ex?.pre === "string" ? ex.pre : "",
    match: typeof ex?.match === "string" ? ex.match : "",
    post: typeof ex?.post === "string" ? ex.post : "",
  };
}

export function SearchSheet({
  open,
  onOpenChange,
  view,
  onJump,
  theme = "day",
}: SearchSheetProps) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const genTokenRef = useRef(0);

  // Reset state when sheet closes.
  useEffect(() => {
    if (!open) {
      genTokenRef.current += 1;
      setQuery("");
      setHits([]);
      setSearching(false);
      setSearched(false);
      try {
        view?.clearSearch?.();
      } catch {
        /* soft-fail */
      }
    }
  }, [open, view]);

  // Autofocus when opened.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(t);
  }, [open]);

  // Debounced whole-book search (D-31, D-32, D-34).
  useEffect(() => {
    if (!open) return;

    const trimmed = query.trim();
    if (!trimmed) {
      genTokenRef.current += 1;
      setHits([]);
      setSearching(false);
      setSearched(false);
      try {
        view?.clearSearch?.();
      } catch {
        /* soft-fail */
      }
      return;
    }

    if (!view?.search) {
      setHits([]);
      setSearching(false);
      setSearched(true);
      return;
    }

    setSearching(true);
    const token = ++genTokenRef.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        const collected: SearchHit[] = [];
        try {
          // Whole book: omit index. Never set matchWholeWords (D-31).
          const opts = buildSearchOpts(trimmed);
          for await (const result of view.search(opts)) {
            if (token !== genTokenRef.current) return;
            if (result === "done") break;
            const r = result as SectionResult;
            if (r && typeof r.progress === "number" && !r.subitems) {
              continue;
            }
            if (r?.subitems && Array.isArray(r.subitems)) {
              const label =
                typeof r.label === "string" && r.label.trim()
                  ? r.label.trim()
                  : "正文";
              for (const sub of r.subitems) {
                if (!sub?.cfi) continue;
                const parts = excerptParts(sub.excerpt);
                collected.push({
                  cfi: sub.cfi,
                  label,
                  ...parts,
                });
              }
              // Stream partial results for responsiveness.
              if (token === genTokenRef.current) {
                setHits([...collected]);
              }
            } else if (r?.cfi) {
              // Single-section form (when index is used — keep defensive).
              const parts = excerptParts(r.excerpt);
              collected.push({
                cfi: r.cfi,
                label: "正文",
                ...parts,
              });
              if (token === genTokenRef.current) {
                setHits([...collected]);
              }
            }
          }
        } catch (err) {
          console.warn("[SearchSheet] search failed", err);
        }
        if (token !== genTokenRef.current) return;
        setHits(collected);
        setSearching(false);
        setSearched(true);
      })();
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      genTokenRef.current += 1;
    };
  }, [query, open, view]);

  const empty =
    searched && !searching && hits.length === 0 && query.trim().length > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        data-theme={theme}
        className="reader-search-sheet reader-sheet flex max-h-[min(85vh,720px)] flex-col gap-0 p-0"
        showCloseButton
      >
        <SheetHeader className="reader-sheet__header shrink-0 px-4 pt-4 pb-2">
          <SheetTitle className="reader-toc-sheet__title">搜索</SheetTitle>
          <SheetDescription className="sr-only">
            在书中搜索关键词并跳转到匹配位置
          </SheetDescription>
        </SheetHeader>

        <div className="reader-search-sheet__sticky reader-sheet__header shrink-0 px-4 pb-3">
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索书中内容"
            aria-label="搜索书中内容"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        <div className="reader-sheet__body min-h-0 flex-1 overflow-y-auto overscroll-contain px-0 [-webkit-overflow-scrolling:touch] [touch-action:pan-y]">
          {searching && hits.length === 0 ? (
            <p className="reader-search-sheet__status" role="status">
              搜索中…
            </p>
          ) : null}

          {empty ? (
            <div className="reader-search-sheet__empty" role="status">
              <p className="reader-search-sheet__empty-title">未找到匹配内容</p>
              <p className="reader-search-sheet__empty-hint">
                试试更短的关键词
              </p>
            </div>
          ) : null}

          {hits.length > 0 ? (
            <ul className="reader-search-results" role="listbox" aria-label="搜索结果">
              {hits.map((hit, i) => (
                <li key={`${hit.cfi}-${i}`}>
                  <button
                    type="button"
                    role="option"
                    className="reader-search-result"
                    onClick={() => {
                      void onJump(hit.cfi);
                    }}
                  >
                    <span className="reader-search-result__snippet">
                      {hit.pre}
                      <mark className="reader-search-result__match">
                        {hit.match}
                      </mark>
                      {hit.post}
                    </span>
                    <span className="reader-search-result__caption">
                      {hit.label}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default SearchSheet;

