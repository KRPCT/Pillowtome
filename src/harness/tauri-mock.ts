/**
 * Playwright 审计 harness 的 Tauri mock。
 *
 * 在导入任何应用模块前安装 window.__TAURI_INTERNALS__：
 * - invoke：按命令名返回夹具数据（书库行 / sync_status / is_android / 字体）；
 * - convertFileSrc：与 Windows WebView 相同的 pillow 形式（404 也无所谓——
 *   布局审计不依赖字体/封面字节）；
 * - transformCallback：事件 listen 走 invoke 兜底，返回固定 id。
 *
 * 绝不修改应用代码路径——mock 只存在于 harness 入口。
 */

interface TauriInternals {
  invoke: (cmd: string, args?: unknown) => Promise<unknown>;
  transformCallback: (cb?: unknown, once?: boolean) => number;
  unregisterCallback: (id: number) => void;
  convertFileSrc: (filePath: string, protocol?: string) => string;
  plugins?: unknown;
}

const LIBRARY_ROWS = [
  {
    item_id: "item-1",
    work_id: "work-1",
    source_id: "src-1",
    title: "红楼梦",
    author: "曹雪芹",
    cover_file: null,
    imported_at: 1752000000000,
    last_opened_at: 1752700000000,
    last_read_at: 1752700000000,
    file_sync_enabled: 0,
    progress_fraction: 0.374,
  },
  {
    item_id: "item-2",
    work_id: "work-2",
    source_id: "src-2",
    title: "乡土中国 一部研究中国基层传统社会的长篇社会学著作",
    author: "费孝通",
    cover_file: null,
    imported_at: 1752100000000,
    last_opened_at: null,
    last_read_at: null,
    file_sync_enabled: 0,
    progress_fraction: 0.02,
  },
  {
    item_id: "item-3",
    work_id: "work-3",
    source_id: "src-3",
    title: "活着",
    author: "余华",
    cover_file: null,
    imported_at: 1752200000000,
    last_opened_at: null,
    last_read_at: null,
    file_sync_enabled: 1,
    progress_fraction: 1,
  },
  {
    item_id: "item-4",
    work_id: "work-4",
    source_id: "src-4",
    title: "万历十五年",
    author: "黄仁宇",
    cover_file: null,
    imported_at: 1752300000000,
    last_opened_at: null,
    last_read_at: null,
    file_sync_enabled: 0,
    progress_fraction: null,
  },
  {
    item_id: "item-5",
    work_id: "work-5",
    source_id: "sync-remote",
    title: "围城",
    author: "钱钟书",
    cover_file: null,
    imported_at: 1752400000000,
    last_opened_at: null,
    last_read_at: null,
    file_sync_enabled: 1,
    progress_fraction: 0.61,
  },
];

const SYNC_SNAPSHOT = {
  configured: false,
  serverUrl: null,
  username: null,
  syncing: false,
  lastSyncAt: null,
  lastError: null,
};

async function mockInvoke(cmd: string, args?: unknown): Promise<unknown> {
  switch (cmd) {
    case "is_android":
      return false;
    case "sync_status":
    case "sync_now":
      return { ...SYNC_SNAPSHOT };
    case "sync_get_config":
      return {
        configured: false,
        serverUrl: null,
        username: null,
        deviceName: "harness",
        keyringAvailable: false,
      };
    case "plugin:sql|load":
      return "sqlite:pillow.db";
    case "plugin:sql|select": {
      const query = String(
        (args as { query?: unknown } | null)?.query ?? "",
      );
      if (query.includes("FROM library_item")) return LIBRARY_ROWS;
      return [];
    }
    case "plugin:sql|execute":
      return { rowsAffected: 1, lastInsertId: 1 };
    case "check_protection":
      return { canRender: true };
    default:
      if (cmd.startsWith("plugin:event|")) return 0;
      if (cmd.startsWith("plugin:app|")) throw new Error("harness: unsupported");
      return null;
  }
}

export function installTauriMock(): void {
  const w = window as unknown as { __TAURI_INTERNALS__?: TauriInternals };
  if (w.__TAURI_INTERNALS__) return;
  w.__TAURI_INTERNALS__ = {
    invoke: mockInvoke,
    transformCallback: () => 1,
    unregisterCallback: () => undefined,
    convertFileSrc: (filePath, protocol = "asset") =>
      `http://${protocol}.localhost/${encodeURIComponent(filePath)}`,
  };
}
