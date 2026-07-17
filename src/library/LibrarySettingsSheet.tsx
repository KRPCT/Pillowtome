/**
 * Library shell settings — reuses reading prefs (theme + typography) for global feel.
 */

import { useEffect, useState } from "react";
import { SettingsSheet } from "../reader/SettingsSheet";
import {
  DEFAULT_PREFS,
  type ReadingPrefs,
} from "../reader/apply-reading-styles";
import {
  loadReadingPrefs,
  saveReadingPrefs,
  PREFS_SAVE_DEBOUNCE_MS,
} from "../reader/reading-prefs";
import {
  importCustomFont,
  listCustomFonts,
  removeCustomFont,
  type CustomFont,
} from "../reader/fonts";

export interface LibrarySettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefs: ReadingPrefs;
  onPrefsChange: (partial: Partial<ReadingPrefs>) => void;
}

export function LibrarySettingsSheet({
  open,
  onOpenChange,
  prefs,
  onPrefsChange,
}: LibrarySettingsSheetProps) {
  const [fonts, setFonts] = useState<CustomFont[]>([]);
  const [fontStatus, setFontStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void listCustomFonts()
      .then(setFonts)
      .catch(() => setFonts([]));
  }, [open]);

  return (
    <SettingsSheet
      open={open}
      onOpenChange={onOpenChange}
      prefs={prefs}
      onPrefsChange={onPrefsChange}
      showLibraryPrefs
      fonts={fonts.map((f) => ({ id: f.id, familyName: f.familyName }))}
      fontStatus={fontStatus}
      onImportFont={async () => {
        setFontStatus(null);
        try {
          const f = await importCustomFont();
          setFonts(await listCustomFonts());
          setFontStatus(`已导入「${f.familyName}」`);
        } catch (err) {
          const msg = String(err);
          if (!msg.includes("已取消")) {
            setFontStatus(msg.replace(/^Error:\s*/i, "") || "导入字体失败");
          }
        }
      }}
      onRemoveFont={async (id, familyName) => {
        try {
          await removeCustomFont(id);
          setFonts(await listCustomFonts());
          if (prefs.activeFontId === id) {
            onPrefsChange({ fontFamilyKey: "system", activeFontId: null });
          }
          setFontStatus(`已移除「${familyName}」`);
        } catch (err) {
          setFontStatus(String(err));
        }
      }}
    />
  );
}

/** Load prefs once for library shell theming. */
export function useLibraryPrefs() {
  const [prefs, setPrefs] = useState<ReadingPrefs>(DEFAULT_PREFS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    void loadReadingPrefs().then((p) => {
      if (!cancelled) {
        setPrefs(p);
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const onPrefsChange = (partial: Partial<ReadingPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...partial };
      // debounce save
      const t = (onPrefsChange as unknown as { _t?: ReturnType<typeof setTimeout> })._t;
      if (t) clearTimeout(t);
      (onPrefsChange as unknown as { _t?: ReturnType<typeof setTimeout> })._t =
        setTimeout(() => {
          void saveReadingPrefs(next).catch((err) => {
            console.warn("[library] prefs save failed", err);
          });
        }, PREFS_SAVE_DEBOUNCE_MS);
      return next;
    });
  };

  return { prefs, ready, onPrefsChange, setPrefs };
}
