import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "../vendor/foliate-js/view.js";
import { pillowUrl } from "../lib/pillow";
import { ErrorCard } from "./error-card";

/**
 * foliate-js 阅读视图（简体中文外壳）。
 *
 * 这是跨端阅读的最小切片：打开一本已捆绑的示例 EPUB、由 foliate-js 分页渲染
 * 一页可读内容、并支持翻一页。约束：
 * - 书籍字节只经 `fetch(pillow://...)` 送达 WebView，绝不通过 IPC（D-06）。
 * - 渲染前先调用 `check_protection` DRM 门；判定不可渲染时渲染错误卡片，
 *   不调用 `view.open`（D-10）。
 * - React 只负责外壳/控件，渲染交给 foliate-js（D-02）。
 *
 * 完整阅读体验（主题/目录/搜索/模式）属于 Phase 2，此处不实现。
 */

/** `check_protection` 命令返回的门控裁决（只有小结构体跨 IPC，D-06）。 */
interface ProtectionDecision {
  canRender: boolean;
  message?: string;
}

/** foliate-js `<foliate-view>` 暴露的最小接口（引擎为 JS，无类型声明）。 */
interface FoliateRenderer {
  next(distance?: number): Promise<void>;
  prev(distance?: number): Promise<void>;
}
interface FoliateViewElement extends HTMLElement {
  open(book: File | Blob | string): Promise<void>;
  renderer?: FoliateRenderer;
}
interface RelocateDetail {
  fraction?: number;
  cfi?: string;
}

export interface FoliateViewProps {
  /** 已在 SourceRegistry 注册的书籍 id（本阶段固定为 "sample"）。 */
  id?: string;
  /** 关闭阅读视图、返回外壳。 */
  onClose?: () => void;
}

type Status = "loading" | "reading" | "error";

export function FoliateView({ id = "sample", onClose }: FoliateViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<FoliateViewElement | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState<string>("");
  const [location, setLocation] = useState<RelocateDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: FoliateViewElement | null = null;

    async function load() {
      try {
        // DRM/损坏门 —— 取任何字节之前先分类（D-10）。只有裁决跨 IPC。
        const decision = await invoke<ProtectionDecision>("check_protection", { id });
        if (cancelled) return;
        if (!decision.canRender) {
          setMessage(decision.message ?? "无法打开这本书。");
          setStatus("error");
          return; // 关键：不调用 view.open。
        }

        const host = hostRef.current;
        if (!host) return;

        // 书籍字节只经自定义协议流式送达，绝不通过 IPC（D-06）。
        const res = await fetch(pillowUrl(id));
        if (!res.ok) throw new Error(`pillow fetch failed: ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;

        const view = document.createElement("foliate-view") as FoliateViewElement;
        created = view;
        viewRef.current = view;
        host.append(view);

        // relocate 事件携带阅读进度，形状对齐 core::Locator（持久化属 Phase 5）。
        view.addEventListener("relocate", (event) => {
          const detail = (event as CustomEvent<RelocateDetail>).detail ?? {};
          setLocation({ fraction: detail.fraction ?? 0, cfi: detail.cfi });
        });

        await view.open(new File([blob], `${id}.epub`));
        if (cancelled) return;
        // foliate 在首个 next() 时铺排首页——渲染第一页可读内容。
        await view.renderer?.next();
        setStatus("reading");
      } catch (err) {
        if (cancelled) return;
        console.error("[FoliateView] 打开示例书籍失败", err);
        setMessage("文件已损坏或无法读取。");
        setStatus("error");
      }
    }

    void load();
    return () => {
      cancelled = true;
      created?.remove();
      viewRef.current = null;
    };
  }, [id]);

  async function turnPage() {
    try {
      await viewRef.current?.renderer?.next();
    } catch (err) {
      console.error("[FoliateView] 翻页失败", err);
    }
  }

  if (status === "error") {
    return <ErrorCard message={message} onDismiss={onClose} />;
  }

  return (
    <div className="reader">
      <div className="reader__toolbar">
        <button type="button" onClick={onClose}>
          关闭
        </button>
        <span className="reader__progress">
          {location
            ? `进度 ${Math.round((location.fraction ?? 0) * 100)}%`
            : status === "loading"
              ? "加载中…"
              : ""}
        </span>
        <button type="button" onClick={turnPage} disabled={status !== "reading"}>
          下一页
        </button>
      </div>
      <div ref={hostRef} className="reader__view" />
    </div>
  );
}

export default FoliateView;
