---
phase: 05-annotations-composite-locator
plan: 05-07
subsystem: reader
tags: [android, actionmode, selection-bubble, device-gate, defect-fix, gap-closure]
requires:
  - src/reader/SelectionBubble.tsx (05-04 bubble)
  - src-tauri/gen/android/app/src/main/java/com/pillowtome/app/MainActivity.kt (onWebViewCreate hook)
provides:
  - SuppressSelectionActionModeFrameLayout (TYPE_FLOATING ActionMode 菜单清空,选区保留)
  - 滚动/分页两模式 Android 设备上可达的 SelectionBubble
  - 生产 APK 强制设备门(docs/ANDROID-BUILD.md + CLAUDE.md)
affects:
  - src/reader/ContinuousScrollStream.tsx (selectionchange 防抖 + sectionBaseCfi 回退)
  - src/reader/FoliateView.tsx (frameElement origin + tap-zone 缝挂)
  - src/reader/ReaderTapZones.tsx (已删除)
tech-stack:
  added: []
  patterns:
    - "sandbox 无 allow-scripts 的 iframe 上 win.setTimeout 回调被 Chromium 静默丢弃 → 用顶层 window timer"
    - "Android 触摸选择取消 pointer 流(pointercancel)→ selectionchange 防抖作选区主信号,不依赖 pointerup"
    - "分页 iframe 水平长条布局:坐标映射以 frameElement.getBoundingClientRect() 为 origin"
    - "tap-zone 经 paginate load 事件缝挂进 section doc,不盖全屏覆盖层(触控 gate #1)"
key-files:
  created:
    - src-tauri/gen/android/app/src/main/java/com/pillowtome/app/SuppressSelectionActionModeFrameLayout.kt
  modified:
    - src-tauri/gen/android/app/src/main/java/com/pillowtome/app/MainActivity.kt
    - src/reader/ContinuousScrollStream.tsx
    - src/reader/FoliateView.tsx
    - src/reader/tap-zones.ts
    - src/reader/scroll-cfi.ts
    - src/reader/scroll-cfi.test.ts
    - src/App.css
    - .gitignore
    - docs/ANDROID-BUILD.md
    - CLAUDE.md
  deleted:
    - src/reader/ReaderTapZones.tsx
decisions:
  - "[05-07] EmptyMenuCallback 清空 TYPE_FLOATING 菜单而非返回 null(返回 null 会被 Chromium 当 ActionMode 失败并清掉选区)"
  - "[05-07] 两个原生 .kt 用 git add -f force-track(git 无法 re-include 被忽略目录);tauri android init 后 git checkout 还原"
  - "[05-07] 设备门升级为强制独立/生产 APK(build --debug --apk + adb install -r),dev-only 门曾掩盖 blob: CSP bug"
  - "[debug] 修复不给 sandbox 加 allow-scripts(不扩大 EPUB 内容脚本执行面),改把 timer 提到顶层 window"
metrics:
  duration: ~1 day(含 debug session 五根因排查 + 三轮设备实证)
  completed: 2026-07-18
  tasks: 3
  files: 12
---

# Phase 05 Plan 05-07: 原生 ActionMode 抑制 + SelectionBubble 设备可达 Summary

修复 DEFECT 1(BLOCKING):Android 原生文本选择 ActionMode 顶掉 05-04 自定义 SelectionBubble。Task 1/2 落了原生抑制层与文档门;Task 3 设备验收暴露更深层缺陷(选中后气泡仍不出、分页选都选不中),经 debug session `selection-bubble-not-showing` 查出**五个独立根因**并全部修复,用户人工验收通过。

## What Was Built

- **原生抑制层**:`SuppressSelectionActionModeFrameLayout`(force-tracked)覆写 `startActionModeForChild`,TYPE_FLOATING 时以 `EmptyMenuCallback`(Callback2)创建真实 ActionMode 但清空菜单——工具条不渲染、选区保留(返回 null 会被 Chromium 判失败并清选区,26cc341 修正)。`MainActivity.onWebViewCreate` 里 `webView.post{}` 延迟 reparent(onWebViewCreate 触发时 WebView 尚未 attach,7c6909b 修正),不消费 window insets。
- **滚动气泡链修复**(RC1/RC3):`emitSelection` 改由 selectionchange(防抖 250ms,顶层 window timer)驱动——sandbox 无 allow-scripts 的 iframe 上 `win.setTimeout` 回调被 Chromium 静默丢弃,且 Android 触摸选择取消 pointer 流使 pointerup→settle 不触发;TXT section 无 `cfi` 时回退 `CFI.fake.fromIndex`(对齐 foliate getCFI 语义),不再静默 bail。
- **分页触摸修复**(RC2):删除 `ReaderTapZones` 全屏 `pointer-events:auto` 覆盖层(Phase 2 起拦截全部命中,分页长按从未能建立选区;**非 05-07 回归**,已排除)。L/R tap-zone 经 paginate `load` 事件缝挂进 section doc,swipe 翻页归 foliate paginator 原生。
- **分页坐标修复**(RC4/RC5):分页 iframe 按水平长条布局,`getClientRects` 与 tap 坐标含横带偏移(实测 ~10500px)→ 选区 rect 与 tap-zone 判定统一以 `doc.defaultView.frameElement.getBoundingClientRect()` 为 origin 换算;`handleSelectExisting`(编辑气泡,D-73)同源修复。
- **流程固化**:`.gitignore` 注释点名两个 force-tracked 原生路径;`docs/ANDROID-BUILD.md` + `CLAUDE.md` 设备门升级为强制独立/生产 APK + 原生文件 re-apply 步骤。

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | 原生 TYPE_FLOATING 抑制 + force-track | ac26518, d95d0f7, 7c6909b, 26cc341 | SuppressSelectionActionModeFrameLayout.kt, MainActivity.kt, .gitignore |
| 2 | 生产 APK 设备门 + re-apply 文档 | db2162c | docs/ANDROID-BUILD.md, CLAUDE.md |
| 3 | AVD 验收(初验失败 → debug session 五根因修复 → 复验通过) | (code fix 随本 summary 同批提交) | ContinuousScrollStream.tsx, FoliateView.tsx, tap-zones.ts, scroll-cfi.ts(+test), App.css; ReaderTapZones.tsx 删除 |

## Verification

- **设备(agent 三轮实证,emulator-5556,独立 debug APK,force-stop 冷启动)**:滚动/分页长按→选区+气泡;分页中区点按 chrome 显隐、L/R 翻页、横滑翻页;滚动竖滑;ActionMode 抑制日志每次命中;气泡点朱砂→`CSS.highlights` 注册 `pillow-hl-cinnabar`。
- **用户人工验收(2026-07-18,三项全过)**:①两模式长按→气泡(4 色/下划线/笔记/复制)且无原生工具条;②分页 L/R 点按+横滑翻页、滚动竖滑不回归;③分页点按既有高亮→编辑气泡(D-73)。
- **桌面**:`tsc --noEmit` 干净;`pnpm test` 163/163 绿;`pnpm build` 成功。
- **入库**:`git ls-files` 含两个原生 .kt(force-track 生效)。
- 证据截图:`.planning/debug/resolved/verify-*.png`(4 张)。

## Deviations from Plan

- Task 3 初验失败(气泡仍不出 + 分页无法选中),偏离"抑制原生即露出气泡"的计划假设。经 `/gsd-debug` session 定位五根因(见 `.planning/debug/resolved/selection-bubble-not-showing.md`),修复范围从原生层扩大到滚动选区信号、TXT CFI 回退、分页覆盖层删除与坐标映射。计划威胁模型 T-05-16(reparent 干扰 insets/触摸)经设备矩阵证伪——实际拦截者是 Phase 2 遗留的 ReaderTapZones 覆盖层。
- `adb input swipe` 合成长按约 1/3 概率不触发(零日志零选区),重试即成功——测试方法学噪声,非产品缺陷。

## Threat Model

- T-05-16(reparent 干扰 insets/触摸):**证伪**——reparent 不消费 insets,设备矩阵证实 edge-to-edge 与触摸派发无回归;真正拦截触摸的是 ReaderTapZones(已删除)。
- T-05-17(原生修复丢失):mitigated——force-track + .gitignore 注释 + docs re-apply 步骤。
- T-05-18(误伤主 ActionMode):mitigated——仅 TYPE_FLOATING 走 EmptyMenuCallback,其余 `super`。
- 新增面:修复未给 sandbox 加 allow-scripts,EPUB 内容脚本执行面零扩张。

## Notes

- 分页气泡自 Phase 2 起从未工作过(覆盖层拦截),05-05 DEFECT 1 的"原生工具条盖气泡"观察只能来自滚动模式——本会话是分页选区+气泡首次设备实证。
- 滚动"气泡不出"的观察全部用了 TXT 测试书(红楼梦);EPUB 滚动气泡此前即正常(RC3 只影响无 cfi 的 TXT section)。
- 调试副产物:`.planning/debug/resolved/` 留存 sandbox timer 实验 html 与 CDP 探针脚本,可复用于同类问题。

## Self-Check: PASSED
