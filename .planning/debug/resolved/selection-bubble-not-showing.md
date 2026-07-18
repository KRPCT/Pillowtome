---
slug: selection-bubble-not-showing
status: resolved
trigger: "Phase 5：Android AVD 上长按选中文字后自定义 SelectionBubble 不显示（05-07 原生 ActionMode 抑制之后）"
created: 2026-07-18
updated: 2026-07-18
branch: fix/05-selection-bubble
---

# Debug: selection-bubble-not-showing

## Symptoms

- **Expected**: Android AVD 长按选字后，05-04 的自定义 `SelectionBubble`（4 色高亮/下划线/笔记/复制）浮在选区上方；分页与滚动两模式均可见；无原生 复制/全选/分享 工具条。
- **Actual（滚动模式）**: 选区正常建立并保持（蓝色选中 + 拖拽手柄可见），原生工具条已被抑制（不再出现），但自定义气泡不出现。
- **Actual（分页模式）**: 长按**根本无法选中文字**（连选区都建立不了）→ 无法测试气泡。疑似 05-07 reparent 引入的回归（05-05 验收时分页可选中，当时症状是原生工具条盖住气泡）。
- **Desktop**: 未测。
- **Error messages**: logcat 无 JS 侧报错；无 `[FoliateView]` / selection 相关日志（JS 链路无任何日志输出，静默失败）。
- **Timeline**: 05-07 三个提交之后（ac26518 抑制 ActionMode → 7c6909b defer reparent → 26cc341 清空菜单保选区）。05-05 时（05-07 之前）分页可选中、原生工具条盖住气泡。
- **Reproduction**: AVD `Medium_Phone_API_36.1`，独立 debug APK（`pnpm tauri android build --debug --target x86_64 --apk` + `adb install -r` + force-stop 冷启动），打开任意 EPUB，切滚动模式长按选字（气泡不出）；切分页模式长按（选区建立不了）。

## Evidence

- timestamp: 2026-07-18 logcat 抓取（PID 6219 = com.pillowtome.app）
  - `I Pillowtome: startActionModeForChild: emptying TYPE_FLOATING toolbar (keeping selection)` 出现两次 → `SuppressSelectionActionModeFrameLayout` 拦截**确实生效**。
  - 选中保持 + 手柄可见（用户确认）→ Chromium 侧 selection 存活，"清空菜单保选区"策略生效。
  - 无任何 JS console 日志（`Tauri/Console` 只有无关的 sandbox 警告）→ JS 链路**静默**：要么 selection 事件没发射，要么发射后某处 early-return（如 `anchorRectInHost` 返回 null → `setBubble(null)`）。
  - 注意：`E Tauri/Console: Blocked script execution in 'blob:...' because the document's frame is sandboxed and the 'allow-scripts' permission is not set` 反复出现 —— foliate paginate 的 blob iframe 相关，待确认是否与分页选中/事件链有关。

- timestamp: 2026-07-18 桌面 Chromium 沙箱 iframe 实验（headless Chrome, srcdoc, sandbox="allow-same-origin allow-popups" 无 allow-scripts —— 与滚动 iframe 完全同配置）
  checked: `.planning/debug/resolved/sandbox-iframe-test-srcdoc.html` —— 父域在沙箱 iframe doc 上挂事件监听、调 win.setTimeout、读 win.getSelection()
  found: |
    ① 事件派发正常：父域挂的 pointerup/selectionchange 监听都触发
    ② win.getSelection()/getClientRects 父域读取正常（sel="hello", rects=1）
    ③ **win.setTimeout(cb,0) 调用不抛错，但回调永远静默不触发**（winTimer=false；doc.defaultView.setTimeout 同样死亡）
  implication: |
    滚动链路 `settle = () => win.setTimeout(emitSelection, 0)` 的回调被 Chromium 静默丢弃 → emitSelection 永不执行 → onSelection 永不调用 → 气泡永不出现。每次丢弃对应 logcat 一条 `Blocked script execution in 'blob:...'`（blob: 正是滚动 iframe 的 section URL 源），与"反复出现"完全吻合。行为平台无关（Chromium 同源）→ 桌面滚动气泡同样坏，只是 05-05 桌面只有单测、气泡从未人工验收。修复方向：改用顶层 window 的 setTimeout（emitSelection 内 win.getSelection() 已被实验证实可读），而非给 sandbox 加 allow-scripts（不让 EPUB 内容脚本获得执行面）

- timestamp: 2026-07-18 源码链读：ReaderTapZones 覆盖层（分页）
  checked: src/reader/ReaderTapZones.tsx + src/App.css:804 + FoliateView JSX 层叠顺序 + git log
  found: |
    分页模式渲染全屏 `<div style="position:absolute; inset:0; zIndex:4; pointerEvents:auto">` 覆盖层，在 JSX 中位于 foliate-view 之后 → 完全盖住阅读面。滚动模式该组件返回 null（注释自述"Scroll: no overlay"）。该文件自 Phase 2（4d2afba/9cda2b3/69425e1/573cf46）后未变
  implication: |
    分页模式下所有触摸命中覆盖层空 div，长按到不了 iframe 文本 → 选区无法建立。这是 CLAUDE.md 触控 gate #1 禁止的全屏捕获层。修复方向：删除覆盖层，把 L/R tap-zone 逻辑经 paginate `load` 事件缝挂到 section doc 上（FXL 同样派发 load —— fixed-layout.js:94 已确认），swipe 翻页由 foliate paginator 原生 touch 处理承担

- timestamp: 2026-07-18 设备鉴别实验（旧 APK，emulator-5554，红楼梦）
  checked: 分页长按正文（adb input swipe 480 1200 480 1200 2200）→ logcat + 截图；滚动长按同法对照
  found: |
    分页：logcat **零** ActionMode 活动；截图显示 chrome 被 toggle 弹出（覆盖层把长按当中区 tap），选区零建立
    滚动：选区建立（「纪」字蓝底+双手柄）+ `startActionModeForChild: emptying TYPE_FLOATING toolbar` ×1 + 无气泡；且 chrome **未**被 toggle
  implication: |
    ① 分页覆盖层拦截实锤 —— Chromium 从未收到长按（零 ActionMode），不是 05-07 回归
    ② 滚动除 win.setTimeout 死回调外还有第二断点：doc 的 pointerup tap 检测未触发（否则 chrome 会被 toggle）→ Android 触摸选择手势接管时 pointer 流被取消（pointercancel）→ pointerup→settle→emit 整条不走。修复必须以 selectionchange（防抖）为主信号，不能只修 timer

- timestamp: 2026-07-18 修复版设备验证第一轮（selectionchange 防抖+顶层 timer 后，滚动仍无气泡）
  checked: 加临时面包屑日志（[sel-scroll] change/emit/baseCfi/cfi + handleReaderSelection + bubble render）重建 APK 设备复现
  found: |
    `[sel-scroll] change collapsed=false ranges=1` → `emit fired` → **`baseCfi MISSING linearIdx 9`** → 静默 return。`handleReaderSelection` 零调用
  implication: |
    第三根因（滚动链路最后一环）：测试书红楼梦是 **TXT** —— `makeTxtBook` 的 sections **无 `cfi` 字段** → `if (!baseCfi) return` 静默 bail。foliate `view.getCFI` 对此场景自带 `?? CFI.fake.fromIndex(index)` 回退（view.js:432），scroll-cfi.ts 注释也写明该契约，但滚动流的 emitSelection 漏了实现。EPUB 书滚动气泡其实一直是好的——此前所有"滚动不出气泡"的观察都用了这本 TXT 书。修复：`sectionBaseCfi(sec) = sec.cfi ?? CFI.fake.fromIndex(sec.index)`（与 foliate getCFI 语义对齐；spineFromCfi 经 fake.toIndex 可逆）

- timestamp: 2026-07-18 桌面 Chromium 沙箱 iframe 实验补充结论
  checked: sandbox-iframe-test-srcdoc.html（headless Chrome）
  found: 事件派发正常、win.getSelection 可读、win.setTimeout 回调永不触发（winTimer=false）
  implication: win.setTimeout 死亡是真实断点之一，但不是唯一 —— 三个根因各自独立成立，需全部修复

- timestamp: 2026-07-18 修复版设备验证第二轮（emulator-5556，最终 APK，滚动 ✅ / 分页半通）
  checked: 滚动长按（480,1200）→ 截图 + logcat；分页长按（540,1020）→ 截图 + logcat；CDP 远程调试探 DOM
  found: |
    滚动：选区建立 + **SelectionBubble 完整出现**（4 色 + 下划线/笔记/复制，悬于选区上方）+ `startActionModeForChild: emptying TYPE_FLOATING` ×1 → RC1+RC3 修复设备实证
    分页：选区**首次建立成功**（「梦」+ 双手柄，Phase 2 以来首次）+ ActionMode 抑制日志 ×1 → RC2 修复实证；但**气泡不可见**
    CDP（webview_devtools_remote_25032 → Runtime.evaluate）：`.reader-anno-bubble` **存在于 DOM**，display:flex/visibility:visible/opacity:1，但 `left: 10531.9px` —— 被定位到视口右侧 ~10000px 的屏外；垂直也偏差 ~57px
  implication: |
    第四根因（分页链路最后一环，checkpoint blind_spots 第一条实锤）：foliate 分页器把 section iframe 按**水平长条**布局，当前页通过 iframe 元素的**水平平移**展示；`range.getClientRects()` 返回的是 iframe 视口坐标（含整条横带偏移 ~10500px），而 `handleReaderSelection` 对无 `iframe` 字段的分页选区取 `viewRef`（foliate-view 宿主）rect 作 origin（left=0）→ 横偏未补偿 → 气泡渲染在屏外。emit/CFI/防抖全链路其实都通了。修复：分页 emit 携带 `iframe: doc.defaultView.frameElement`（load 事件给的 doc 同源，frameElement 不受 closed shadow 限制），origin 改取 iframe 实时 bounding rect（横纵双轴同时修正）；`handleSelectExisting`（编辑气泡）同样的 view-origin 误用一并修

- timestamp: 2026-07-18 修复版设备验证第三轮（Fix D/E 后最终构建，emulator-5556 全矩阵绿）
  checked: 分页气泡复验 + 手势回归矩阵 + 滚动复验 + 气泡动作端到端（CDP CSS.highlights 探针）
  found: |
    分页：长按→选区+气泡悬于选区上方 ✓；中区点按→chrome 显隐（不翻页）✓；右区→下一页 ✓；左区→上一页 ✓；横滑→翻页 ✓；ActionMode 抑制日志每次都在 ✓
    滚动：竖滑平移 ✓（touch gate 无回归）；长按→选区+气泡 ✓；气泡点「朱砂」→ 高亮创建成功（iframe CSS.highlights 注册 `pillow-hl-cinnabar:1`，另见旧 `pillow-hl-indigo:1`）✓
    中间态插曲：修好气泡后发现分页 tap-zone 全错（中区点按翻页）—— pointer 坐标同样在横带空间，`innerWidth` 是整条横带宽 → Fix E 同步把 zone 解析换算到可视页空间（ev.clientX + frameRect.left - viewRect.left, width=viewRect.width）
    adb input swipe 合成的长按有约 1/3 概率不触发（零日志零选区），重试即成功 —— 测试方法学噪声，非产品缺陷
  implication: 五个根因全部修复并设备实证；桌面 tsc+163 单测+build 全绿；达到 awaiting_human_verify

## Mechanism Map (for investigator)

JS 侧气泡链路（src/reader/FoliateView.tsx）：
- 滚动：`ContinuousScrollStream` → `ScrollSelection` → `handleScrollSelection` (≈L367) → `onSelectionRef.current` → `handleReaderSelection` (≈L412)。
- 分页：foliate paginator（closed shadow，src/vendor/foliate-js/paginator.js）selection 事件 → `onSelection` prop → `handleReaderSelection`。
- `handleReaderSelection`: null sel → `setBubble(null)`；`anchorRectInHost(rects, origin)` (≈L394) 返回 null → `setBubble(null)`；否则 `setBubble({rect, context:"create"})` → `SelectionBubble` 渲染（src/reader/SelectionBubble.tsx，`if (!selection) return null`）。

原生侧（05-07）：
- `src-tauri/gen/android/.../MainActivity.kt`: `onWebViewCreate` → `webView.post { wrapInActionModeSuppressor }`（detach → 装入 wrapper → 按原 index/params 装回）。
- `SuppressSelectionActionModeFrameLayout.kt`: TYPE_FLOATING → `EmptyMenuCallback`（Callback2 包装，onCreate/onPrepare 后 `menu.clear()`），ActionMode 非 null 以保选区。

## Hypotheses (unverified)

1. 滚动模式：`anchorRectInHost` 在 Android 上返回 null（rects 为空 / origin 缺失 / iframe rect 为 0）→ `setBubble(null)` 静默吞掉。
2. 滚动模式：`ContinuousScrollStream` 的 selection 监听（selectionchange?）在 Android WebView 触摸选区下不触发或触发时机不对（settle 检测逻辑）。
3. 分页模式无法选中：reparent 干扰了 foliate-view 内的触摸派发/命中测试，或 paginator 自身 tap 处理吞掉长按（需对比 05-07 之前行为确认回归）。
4. EmptyMenuCallback 的 ActionMode 在分页场景被立即 destroy → 分页选区建立即被清（与滚动模式表现不同，待验证）。

## Constraints

- **设备门（强制）**: 验证必须跑独立/生产 APK（`pnpm tauri android build --debug --target x86_64 --apk` + `adb install -r` + `adb shell am force-stop com.pillowtome.app` 冷启动）。**禁止**用 `pnpm tauri android dev` 验证（LAN devUrl AVD 路由不到 → 白屏）。
- 构建前必须 export Android 环境变量（本进程树 stale env）：
  `export ANDROID_HOME="/c/Users/Administrator/AppData/Local/Android/Sdk"; export NDK_HOME="$ANDROID_HOME/ndk/27.2.12479018"; export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"`
- adb 位于 `$ANDROID_HOME/platform-tools/adb`（不在默认 PATH）。
- 原生 .kt 文件已 force-track 入库；改动后直接重建即可。
- 构建用 MSVC 工具链（默认 GNU gcc 会静默失败）——桌面侧若需构建注意；Android 构建不受影响。
- 触控 gate：禁止全屏 `pointer-events:auto` 捕获层；修复不得破坏手指竖滑滚动。

## Current Focus

reasoning_checkpoint:
  hypothesis: |
    (1) 滚动气泡不出现 = 双重断链：(a) sandbox 无 allow-scripts 的 iframe 上 win.setTimeout 回调被 Chromium 静默丢弃；(b) Android 触摸长按选择时 Chromium 取消 pointer 流（pointercancel），doc 的 pointerup→settle 根本不触发 → emitSelection 从不执行。
    (2) 分页无法选中 = ReaderTapZones 全屏 pointer-events:auto 覆盖层拦截全部触摸命中，长按到不了 iframe 文本 → Chromium 从未开始选择（ActionMode 日志为零）。
  confirming_evidence:
    - "桌面 Chromium 实验（同 sandbox 配置 srcdoc）：win.setTimeout 回调永不触发（winTimer=false），事件派发正常、win.getSelection 父域可读"
    - "设备实验（旧 APK 滚动长按）：选区建立+手柄可见+startActionModeForChild 日志，但无气泡；且 chrome 未被 toggle —— 证明 doc 的 pointerup tap 检测未触发（pointer 流被取消）"
    - "设备实验（旧 APK 分页长按）：零 ActionMode 日志，chrome 反被 toggle —— 覆盖层把长按当中区 tap，Chromium 从未见到长按"
    - "源码：ContinuousScrollStream.tsx L999 sandbox 无 allow-scripts、L1063 win.setTimeout；ReaderTapZones.tsx L97-104 全屏 inset:0+zIndex:4+pointerEvents:auto"
  falsification_test: "修复后滚动长按仍无气泡（且 emit 确认执行）→ 假设 1 证伪；分页长按仍零 ActionMode 日志 → 假设 2 证伪"
  fix_rationale: "直接消除断链点：selectionchange（防抖 250ms，顶层 timer）替代 pointerup settle 作为主信号（鼠标划选/触摸长按/手柄拖拽都稳定触发）；删除全屏覆盖层，L/R tap-zone 逻辑经 paginate load 事件缝挂进 section doc（swipe 翻页由 foliate paginator 原生承担）。不加 allow-scripts（不给 EPUB 内容脚本执行面）"
  blind_spots: "分页 anchorRectInHost 以 foliate-view rect 为 origin、忽略 iframe 在 view 内的偏移（header band/margin，margin≈0 时影响≈0，05-08 坐标硬门会暴露）；防抖下拖手柄气泡 250ms 延迟跟手性未验；桌面两模式未人工验（引擎同源、路径相同，风险低）"
- next_action: "等待用户人工验收（checkpoint human-verify）：真实工作流确认两模式长按气泡 + 翻页/滚动手势 + 分页点按既有高亮出编辑气泡"
- test: "用户实测：①滚动/分页长按→气泡；②分页 L/R 点按+横滑翻页；③滚动竖滑；④分页点按既有高亮→编辑气泡（D-73，同 frameElement origin 修复，未单独设备验）"
- expecting: "用户确认全部通过后：提交修复文件（ssh 签名 Verified）→ 归档 session 到 resolved/ → 追加 knowledge-base"
- test: "修复版 APK：滚动长按 → 气泡出现；分页长按 → 选区建立+气泡出现；分页点按 L/R → 翻页；分页 swipe → 翻页；滚动竖滑 → 平移不回归"
- expecting: "两模式选区+气泡全通，翻页/滚动手势不回归"

## Eliminated

- hypothesis: "分页无法选中是 05-07 reparent 引入的回归"
  evidence: "ReaderTapZones 自 Phase 2（4d2afba）起未变；它以 position:absolute+inset:0+zIndex:4+pointerEvents:auto 盖满分页视图，命中测试根本到不了 foliate iframe —— 分页触摸选区自 Phase 2 起就无法建立。05-05 的 DEFECT 1 观察（原生工具条盖气泡）只能来自选区能建立的滚动模式；分页气泡从未被验证过（05-05 验收在 step 1 即被 DEFECT 1 整体阻塞）"
  timestamp: 2026-07-18
- hypothesis: "滚动模式 anchorRectInHost 返回 null 吞掉气泡"
  evidence: "实验证实 emitSelection 本身就不会执行（上游 timer 死亡），根本走不到 rect 映射；且 anchorRectInHost 逻辑简单、桌面 Chromium 同源行为正常"
  timestamp: 2026-07-18

## Resolution

- root_cause: "五个独立缺陷叠加：RC1 滚动 section iframe sandbox 无 allow-scripts → Chromium 静默丢弃 win.setTimeout 回调（emitSelection 从不执行）；且 Android 触摸选择取消 pointer 流，pointerup→settle 链路也不触发。RC2 ReaderTapZones 全屏 pointer-events:auto 覆盖层（Phase 2 起存在，非 05-07 回归）拦截分页全部触摸命中 → 分页长按从未能建立选区。RC3 TXT 书 section 无 cfi 字段 → `if (!baseCfi) return` 静默 bail，缺 foliate getCFI 自带的 CFI.fake.fromIndex 回退。RC4 分页 section iframe 按水平长条布局，getClientRects 含 ~10500px 横带偏移，origin 误用 foliate-view（left=0）→ 气泡渲染到屏外。RC5 分页 tap-zone 坐标同在横带空间 → 中区点按误翻页。"
- fix: "ContinuousScrollStream：selectionchange（防抖 250ms，顶层 window timer）替代 pointerup settle 作为主信号；sectionBaseCfi 加 CFI.fake.fromIndex 回退。FoliateView：分页 emit 携带 doc.defaultView.frameElement，origin 改取 iframe 实时 bounding rect（selection rect 与 tap-zone 坐标同步换算到可视页空间）；handleSelectExisting 同源修复。删除 ReaderTapZones 全屏覆盖层，L/R tap-zone 经 paginate load 事件缝挂进 section doc；swipe 翻页归 foliate paginator 原生处理。不加 allow-scripts（不给内容脚本执行面）。"
- verification: "agent 三轮设备实证（emulator-5556，独立 debug APK，force-stop 冷启动）：滚动/分页长按→选区+气泡；分页中区点按 chrome 显隐、L/R 翻页、横滑翻页；滚动竖滑；ActionMode 抑制；气泡点朱砂→CSS.highlights 注册。桌面 tsc + 163 单测 + build 全绿。2026-07-18 用户人工验收三项全过（两模式长按气泡、翻页/滚动手势、分页点按既有高亮→编辑气泡 D-73）。"
- files_changed: ["src/reader/ContinuousScrollStream.tsx", "src/reader/FoliateView.tsx", "src/reader/ReaderTapZones.tsx (deleted)", "src/reader/tap-zones.ts", "src/App.css", "src/reader/scroll-cfi.ts", "src/reader/scroll-cfi.test.ts"]
