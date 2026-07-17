---
phase: 05-annotations-composite-locator
plan: 05-05
type: device-gate-findings
status: blocked
gate: 05-05 Task 2 (checkpoint:human-verify, blocking)
avd: Medium_Phone_API_36.1 (API 36)
created: 2026-07-18
route: /gsd-plan-phase 05 --gaps
---

# Phase 05 Android 设备门发现

05-05 Task 1（桌面预检）全绿：`pnpm test` 156/156、`tsc --noEmit` 干净、`pnpm build` 成功、`cargo test --test migration` 12 passed（含 V7）。

05-05 Task 2（AVD 人工验收）**BLOCKED** —— 部署方式与两个 CSP 相关阻塞、一个原生阻塞。以下供 `/gsd-plan-phase 05 --gaps` 消费。

## 部署方式（偏离计划配方，需 gap 决策）

计划配方是 `pnpm tauri android dev`。实测其自动把 devUrl 烤成 LAN IP（`26.107.220.195:1420`），而 AVD 数据状态"未连接"、路由不到 → **白屏**。改用**独立 debug APK**（`pnpm tauri android build --debug --target x86_64 --apk`）绕开，前端打包进包、不依赖 dev server。这是**头一回在设备上跑生产构建**，因此暴露了下面的 CSP bug（dev 模式一直掩盖）。

## 已修复并验证（本会话内）

### CSP 阻塞 `blob:`（已提交 25e9a23）— EPUB/PDF/MOBI/TXT 全格式阻塞
- **现象**：EPUB `blob:...ERR_BLOCKED_BY_CSP`；PDF 白屏卡死。
- **根因**：`src-tauri/tauri.conf.json` 的 CSP（Phase 1 起未变）`default-src` 不含 `blob:`，且无 `frame-src`/`worker-src` → foliate 的 EPUB blob-iframe 与 pdf.js blob-worker 全被拦。**非 Phase 5 引入**，是潜伏的生产构建 bug，被"只跑 dev 模式门"掩盖至今。
- **修复**：给 `default-src` 加 `blob:`，加显式 `frame-src`/`child-src`/`worker-src`，给 `style/font/connect/media` 补 `blob:`/`data:`，对齐 foliate `reader.html` 自带 CSP。
- **验证**：AVD 上 EPUB 正文渲染、PDF 页面渲染。
- **gap 待办**：这是全局 reader 基建修复，建议在 gap plan 里补一条"生产构建（非 dev）也纳入设备门"的流程约束，否则同类 bug 会再次潜伏。

## 未修复缺陷 → gap plan

### DEFECT 1（BLOCKING，真·Phase 5 批注缺陷）：原生 WebView 选中 ActionMode 顶掉自定义气泡
- **现象**：长按选字，Android 系统的文本选择工具条（复制/全选/分享）浮在我们的 `SelectionBubble`（05-04）之上，用户看不到自定义气泡。
- **根因**：`SelectionBubble` 是 JS 层 `getSelection()` 驱动的 DOM 浮层；Android 原生 ActionMode 是 WebView 之外的原生浮层，盖住 DOM 气泡。
- **修复点**：抑制原生 text-selection ActionMode，同时保留选区 + 拖拽手柄。
- **工具层约束（关键，gap 必须处理）**：
  1. 自然落点 `gen/android/.../generated/RustWebView.kt` 的 `startActionMode` override **`tauri android build` 每次重生成会冲掉**，且整个 `gen/android` **gitignored**、不入库 → 生成文件改动零持久化。（已实测确认。）
  2. 可持久到"本次 build"的落点是 `MainActivity.kt`（不在 `generated/`，重建不覆盖）的 `onWebViewCreate(webView)` hook —— 但拿到的是 WebView **实例**，实例无法覆写 `startActionMode` 方法。
  3. 可行的持久做法：`onWebViewCreate` 里把 WebView **reparent 进一个覆写了 `startActionModeForChild` 的 FrameLayout**（父容器拦截 TYPE_FLOATING）。**有风险**：可能破坏 Tauri 的 edge-to-edge / window insets / 触摸，需真机迭代。
  4. `gen/android` gitignored → 即便改 `MainActivity.kt` 也不入库；gap 需决定版本控制/patch 策略（改 .gitignore 纳入必要文件，或加 post-generate patch 步骤）。
- **影响**：气泡不出来 → 验收 8 步的第 1-5 步（气泡定位、4 色高亮、下划线、编辑态、笔记、书签行为）全部无法在设备上验证。

### DEFECT 2（MINOR，非致命）：PDF outline 解析报 `Te.id.endsWith is not a function`
- **现象**：打开 PDF 时 logcat 刷屏 `[FoliateView] resolve spine failed [{num:1439,gen:0},...] TypeError: Te.id.endsWith is not a function`。**PDF 正文照常渲染**，非致命，但 PDF 大纲/TOC 跳转可能受影响。
- **疑似根因**：`FoliateView.tsx` 的 spine 解析把 PDF 的数字 ref id（`{num,gen}`）当字符串调 `.endsWith`。可能是 05-03/05-04 对 FoliateView 的改动，也可能是既有 PDF 处理。gap 需先定位是否 Phase 5 回归。
- **修复方向**：spine 解析前对 `id` 做类型守卫（非字符串走 PDF-ref 分支）。

## 尚未验证（被 DEFECT 1 阻塞）

以下 05-05 验收项因气泡被顶掉、无法在设备上走完，gap 修复 DEFECT 1 后需补验：
- 分页闭合-shadow 气泡坐标映射（Task 2 step 1 硬门）
- 4 色高亮 / 下划线 / 复制 / 笔记持久（step 2-4）
- 书签开关 + 批注 sheet 按章分组 + 跳转 + 滑删（step 5）
- 关书重开 / paginate↔scroll 切换后重绘（step 6）
- 简繁 / 词不拆行 切换后高亮自愈（step 7）
- 手指竖滑 sheet 滚动（touch-gate）
- 200+ 批注性能压测（step 8，reader-perf memory 要求）
