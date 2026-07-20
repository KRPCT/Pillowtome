import { invoke } from "@tauri-apps/api/core";

/**
 * 应用更新检查（UPD-01）。
 *
 * 网络与 GitHub Releases API 全在 Rust 侧（WebView CSP 不放行外网）；
 * 这里只做 IPC 包装与「忽略此版本」的本地记忆。
 *
 * 「推送」语义：每次冷启动自动检查一次（调用方负责），检出更新即弹窗；
 * 「忽略此版本」只压住该版本的自动弹窗，手动「检查更新」不受其影响。
 */

/** Rust `UpdateInfo`（camelCase 跨 IPC）。 */
export interface UpdateInfo {
  /** 新版本号（已去前导 v），如 `1.1.0`。 */
  version: string;
  /** 更新内容（Release 正文，markdown 原文按行排版）。 */
  notes: string;
  /** Release 页面 URL，「立即更新」在系统浏览器打开。 */
  url: string;
  /** 发布时间 ISO 8601（可为空串）。 */
  publishedAt: string;
  /** 当前运行版本。 */
  current: string;
}

const DISMISS_KEY = "pillowtome.update.dismissed.v1";

/** 检查更新。`null` = 已是最新；抛错 = 网络/接口失败（调用方决定静默或提示）。 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  return invoke<UpdateInfo | null>("check_update");
}

/** 该版本是否已被用户「忽略」（仅影响自动弹窗）。 */
export function isUpdateDismissed(version: string): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === version;
  } catch {
    return false;
  }
}

/** 记住「忽略此版本」——之后该版本不再自动弹窗。 */
export function dismissUpdate(version: string): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, version);
  } catch {
    /* 隐私模式等场景下静默 */
  }
}
