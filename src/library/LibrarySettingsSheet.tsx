/**
 * Library shell settings — reuses reading prefs (theme + typography) for global feel.
 */

import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { SettingsSheet } from "../reader/SettingsSheet";
import {
  formatRelativeSyncTime,
  type SyncViewState,
} from "../sync/sync-status";
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
  /** Live sync engine view for the 同步 section (UI-SPEC §6). */
  syncState: SyncViewState;
  /** Open the SyncSettingsSheet (from the section CTA / 同步设置 row). */
  onOpenSyncSettings: () => void;
}

export function LibrarySettingsSheet({
  open,
  onOpenChange,
  prefs,
  onPrefsChange,
  syncState,
  onOpenSyncSettings,
}: LibrarySettingsSheetProps) {
  const [fonts, setFonts] = useState<CustomFont[]>([]);
  const [fontStatus, setFontStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void listCustomFonts()
      .then(setFonts)
      .catch(() => setFonts([]));
  }, [open]);

  // UI-SPEC §6: 未配置 → guidance + CTA; 已配置 → read-only summary + 同步设置.
  const syncSection = (
    <Box sx={{ mb: 3 }}>
      <Typography
        variant="subtitle2"
        sx={{ color: "text.secondary", mb: 1.25, letterSpacing: "0.02em" }}
      >
        同步
      </Typography>
      {syncState.configured ? (
        <Box>
          {syncState.serverUrl ? (
            <Typography variant="body2" noWrap>
              {syncState.serverUrl}
            </Typography>
          ) : null}
          {syncState.lastSyncAt != null ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              上次同步 {formatRelativeSyncTime(syncState.lastSyncAt, Date.now())}
            </Typography>
          ) : null}
          {syncState.lastError ? (
            <Typography variant="caption" color="error" sx={{ display: "block" }}>
              同步失败：{syncState.lastError}
            </Typography>
          ) : null}
          <Button size="small" onClick={onOpenSyncSettings} sx={{ mt: 1 }}>
            同步设置
          </Button>
        </Box>
      ) : (
        <Box>
          <Typography variant="body2">未开启同步</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
            配置 WebDAV 服务器后，阅读进度与批注可在多设备间同步
          </Typography>
          <Button size="small" variant="outlined" onClick={onOpenSyncSettings} sx={{ mt: 1.5 }}>
            设置 WebDAV 同步
          </Button>
        </Box>
      )}
    </Box>
  );

  return (
    <SettingsSheet
      open={open}
      onOpenChange={onOpenChange}
      prefs={prefs}
      onPrefsChange={onPrefsChange}
      showLibraryPrefs
      syncSection={syncSection}
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
