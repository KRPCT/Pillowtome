/**
 * Pure sync-config form logic (SYNC-01, D-95/D-96/D-97/D-104).
 *
 * Client-side validation only. Backend test failures need NO mapping here:
 * `sync_test_and_save` rejects with an `Err(String)` that already IS the
 * classified D-97 copy — SyncSettingsSheet renders it verbatim.
 */

/** Trim + require an http(s) scheme and a host. */
export function validateServerUrl(input: string): "invalid" | null {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return "invalid";
  try {
    const url = new URL(trimmed);
    if (!url.host) return "invalid";
    return null;
  } catch {
    return "invalid";
  }
}

/**
 * D-104 remote-path normalization: trim, strip leading slashes, strip trailing
 * slashes, re-attach exactly one; empty → `pillowtome/`. 多台设备必须填写相同路径.
 */
export function normalizeRemotePath(input: string): string {
  const trimmed = input.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) return "pillowtome/";
  return `${trimmed}/`;
}

/** Client-side validation-failure copy (verbatim UI-SPEC D-97 unreachable class). */
export function copyForTestClass(cls: "invalid"): string {
  switch (cls) {
    case "invalid":
      return "无法连接到服务器，请检查地址";
  }
}
