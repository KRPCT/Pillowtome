---
phase: 05-annotations-composite-locator
plan: 03
subsystem: reader
tags: [annotations, css-custom-highlight, foliate-overlayer, selection-cfi, closed-shadow, self-heal, cjk]

# Dependency graph
requires:
  - phase: 05-01
    provides: annotation-store (listAnnotations / upsertAnnotation) + AnnotationRow
  - phase: 05-02
    provides: resolveAnchor(doc, anchor) 自愈链 + scroll-cfi selectionCfi/cfiToRange/spineFromCfi
provides:
  - css-highlight.ts — 每 iframe CSS Custom Highlight 注册表（allowlisted 名字）+ 特性探测 + Overlayer 色值解析
  - ContinuousScrollStream 新缝：annotations/onSelection props + redrawAnnotations API + 懒式每 section 绘制
  - FoliateView 新缝：onSelection/onSelectExisting/annotations props + 分页 load/draw-annotation/create-overlay/show-annotation 接线 + 自愈回写重放
affects: [05-04-annotations-ui, 05-05-device-gate, 07-sync]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "滚动高亮 = 每 iframe CSS.highlights 注册（live Range，零手动重绘）；旧机（WebView<105）退 per-iframe foliate Overlayer"
    - "分页高亮全走 foliate 事件（闭合 shadow root 唯一路径）；draw-annotation → Overlayer.highlight/underline"
    - "::highlight() registry 名只从 cinnabar|ochre|green|indigo allowlist 构造（T-05-07 防样式注入）"
    - "懒式每 section 绘制（Pitfall 9）：按 spineFromCfi 过滤到本 section，绝不开书全量绘制"
    - "分页重放自愈：CFI 解析失败 → resolveAnchor → view.getCFI 重算 → upsertAnnotation 回写新 CFI"

key-files:
  created:
    - src/reader/css-highlight.ts
    - src/reader/css-highlight.test.ts
  modified:
    - src/reader/ContinuousScrollStream.tsx
    - src/reader/FoliateView.tsx
    - src/reader/foliate-types.ts
    - src/vendor-foliate-js.d.ts

key-decisions:
  - "Overlayer 传纯色种子（--anno-<color>）而非 -fill 半透明色：Overlayer.highlight 自带 --overlayer-highlight-opacity，传 -fill 会双重变淡。paletteColor 集中在 css-highlight.ts 供两处复用"
  - "重放走声明式 annotations prop + effect（分页与滚动都在 store 变化时重绘），滚动另暴露 redrawAnnotations() API；FoliateView 不对上层开 ref，由 05-04 更新 annotations prop 驱动"
  - "分页重绘按 drawnKeysRef 先移除本 section 旧 overlay 再重加，使删除/编辑不残留（addAnnotation 以 CFI value 为 key，丢弃的批注否则会滞留）"

patterns-established:
  - "两模式选区都在各自 section-doc seam 上 settle（pointerup/mouseup）后发 range-CFI，selectionchange 仅在坍缩时清气泡；不加任何全屏 pointer-events 层（D-74）"

requirements-completed: [ANNO-01, ANNO-02, ANNO-03, ANNO-04]

# Metrics
duration: 13min
completed: 2026-07-17
---

# Phase 5 Plan 03: 两模式选区 + 批注绘制/重放 Summary

**把「选中文本 → range-CFI」和「在两块阅读面各自画高亮/下划线」接线打通：滚动模式用 CSS Custom Highlight API（live Range、零手动重绘，旧机退 foliate Overlayer），分页模式全走 foliate 闭合-shadow 事件（load/draw-annotation/create-overlay/show-annotation）；开书与简繁/词不拆行 toggle 后从 annotation-store 懒式逐 section 重放，CFI 断裂时经共享 resolver 自愈并回写新 CFI。批注气泡/编辑面板留给 05-04，本计划只暴露它消费的 onSelection/onSelectExisting/annotations 缝。**

## Performance
- **Duration:** ~13 min
- **Tasks:** 3
- **Files:** 6（2 created, 4 modified）
- **Tests:** css-highlight 10 断言新增；全套 156 green；`tsc --noEmit` clean；`pnpm build` 成功

## Accomplishments
- `css-highlight.ts`：`supportsCssHighlight`（`Highlight` 函数 + `CSS.highlights` 双探测）、`highlightCssName`（type+color → `pillow-hl-*`/`pillow-ul-*`，只认 4 色 allowlist，否则拒绝 —— T-05-07）、`registerHighlight`（get-or-create 具名 Highlight，加 live Range）、`clearHighlights`（只清 pillow-hl-/pillow-ul-，不碰 autospace）、`paletteColor`（Overlayer 用纯色种子）、`HIGHLIGHT_CSS`（四色的 `::highlight()` 规则，引用 05-04 声明的 `--anno-*` 变量）。
- `ContinuousScrollStream.tsx`：在既有 `onLoad` section-doc seam（与链接拦截/autospace 同缝，D-74）挂 selection settle → `selectionCfi(sec.cfi, range)` → 发 `onSelection`；`drawSectionAnnotations` 懒式按 `spineFromCfi` 过滤到本 section，逐条 `resolveAnchor` → `registerHighlight`，不支持则实例化 per-iframe foliate `Overlayer` 兜底（reflow 时 `redraw`）；把 `::highlight()` 规则并入 `pillow-reading-css`；annotations 变化或 section 重载时重绘；`redrawAnnotations()` 上到命令式 API；滚动手势清气泡。
- `FoliateView.tsx`：分页四个 foliate 事件接线 —— `load` 交出闭合-shadow 内唯一可达 doc（挂选区 + 存 section doc + 重放该 section），`draw-annotation` 调 `Overlayer.highlight/underline`，`create-overlay` 触发该 section 懒式重放，`show-annotation` 上发 `onSelectExisting`（D-73）；重放自愈：CFI 解析失败 → `resolveAnchor` → `view.getCFI` 重算 → `upsertAnnotation` 回写；滚动子组件接上 `annotations` + `onSelection`（归一成共享 `ReaderSelection`）。

## Task Commits
1. **Task 1 (TDD RED): failing css-highlight tests** - `test(05-03)`
2. **Task 1 (TDD GREEN): CSS Custom Highlight registry** - `feat(05-03)`
3. **Task 2: scroll selection + lazy per-section draw** - `feat(05-03)`
4. **Task 3: paginate selection + foliate draw/replay + self-heal** - `feat(05-03)`

## Decisions Made
- **Overlayer 用纯色种子而非 `-fill`。** 就地核对 `overlayer.js:126` 确认 `Overlayer.highlight` 自带 `opacity: var(--overlayer-highlight-opacity,.3)`；若把已半透明的 `--anno-<c>-fill` 传进去会双重变淡。故 `paletteColor(doc, color)` 统一返回纯色种子 `--anno-<color>`（分页 draw + 滚动 Overlayer 兜底共用）；滚动主路径的半透明由 `::highlight(){background-color:var(--anno-<c>-fill)}` CSS 直接给。集中到 `css-highlight.ts` 一处，两个 host 复用。
- **重放是声明式（annotations prop + effect），不给 FoliateView 开 ref。** 分页与滚动都在 store 列表变化时重绘；滚动另在命令式 API 暴露 `redrawAnnotations()`。05-04 通过更新 `annotations` prop 驱动「新建高亮即时出现」，无需 imperative handle。
- **分页重绘 deletion-safe。** `addAnnotation` 以 CFI `value` 为 overlayer key，丢弃的批注不会自动消失。用 `drawnKeysRef` 在每次 `replayPaginateSection` 先 `addAnnotation(value, true)` 移除本 section 旧 key 再重加，使删除/编辑不残留。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] 为 `overlayer.js` 补 ambient 声明**
- **Found during:** Task 2（`import { Overlayer }` 触发 TS7016 缺声明）
- **Issue:** vendored foliate-js 无 `.d.ts`（刻意不在 submodule 内加，避免弄脏），`overlayer.js` 之前无人导入故无声明。
- **Fix:** 在 `src/vendor-foliate-js.d.ts` 追加 `declare module "*/vendor/foliate-js/overlayer.js"`，声明 `Overlayer` 实例 + 静态 `highlight/underline`，与既有 `view.js`/`epubcfi.js` 声明同模式。非新依赖（威胁登记 T-05-SC 保持 accept）。
- **Files modified:** src/vendor-foliate-js.d.ts

**2. [Rule 2 - Missing critical functionality] 分页重绘的删除/编辑安全**
- **Found during:** Task 3（annotations 变化时重放）
- **Issue:** 计划要求「store 变化时重绘」，但 foliate `addAnnotation` 不会移除已丢弃的 overlay → 删除后旧高亮残留。
- **Fix:** `drawnKeysRef` 追踪每 section 已绘 CFI，重放前先移除旧 key。
- **Files modified:** src/reader/FoliateView.tsx

**3. [expected] `FoliateViewElement` 类型补 `getCFI`/`addAnnotation`**
- 计划所需的 foliate API 之前未在本地 clean-room 类型里声明；按需补齐，非行为偏离。

## Issues Encountered
- `onReady` effect 原本引用后声明的 `redrawAllLoaded`（TDZ）。把该 effect 下移到 `redrawAllLoaded` 声明之后解决，无功能影响。

## Known Stubs
None（功能层面）。以下为**计划内的跨计划交接缝**，非桩：
- `onSelection` / `onSelectExisting` / `annotations` props 已暴露并内部接线，由 **05-04** 渲染气泡/编辑面板并接 store。
- `::highlight()` 引用的 `--anno-*` / `--anno-*-fill` 主题变量由 **05-04** 在 index.css 按日/夜/Sepia 声明（本计划只引用）。
- 闭合-shadow 坐标映射（iframe→page / foliate-view host rect）的真机验收是 **05-05** 硬门。

## Threat Flags
无新增安全面。`::highlight()` 名字仅从固定 4 色 allowlist 构造（T-05-07 mitigate，已测）；分页绘制不查询 shadow DOM，只走 foliate 事件（T-05-08 mitigate，grep 确认 0 处 shadow querySelector 绘制）；懒式每 section 绘制（T-05-09 mitigate，真机压测在 05-05）；无新依赖（T-05-SC accept）。

## TDD Gate Compliance
Task 1 走 RED→GREEN：先提交失败的 `test(05-03)` 再提交 `feat(05-03)` 实现，gate 序列完整。

## Next Phase Readiness
- 05-04 可直接消费 `FoliateView` 的 `onSelection`（`ReaderSelection`：cfi + rects + doc + 可选 iframe + index）与 `onSelectExisting(cfi)`，用 `annotation-store` 建/改/删并把新列表回填 `annotations` prop 触发重绘。
- 05-05 真机门：分页闭合-shadow 坐标映射、滚动手指竖滑不被吞、旧机 Overlayer 兜底、多批注懒绘制压测。

## Self-Check: PASSED
- css-highlight.ts / css-highlight.test.ts FOUND on disk.
- 4 task commits (test 1 + feat 3) present in git log.

---
*Phase: 05-annotations-composite-locator*
*Completed: 2026-07-17*
