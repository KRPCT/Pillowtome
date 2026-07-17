---
phase: 05-annotations-composite-locator
plan: 02
subsystem: reader
tags: [locator, anchor-resolver, cfi, text-context, self-healing, cjk, annotations]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: composite self-healing Locator seam + epubcfi.js vendored (cfiToRange)
  - phase: 02
    provides: locator-store.ts (text_exact window, relocate→row) + reading-position isRealCfi
  - phase: 05-01
    provides: annotation composite columns (text_pre/exact/post) that share the resolver
provides:
  - anchor-resolver.ts — resolveAnchor(doc, anchor) shared CFI→text→fraction chain (D-77)
  - locator-store.ts textContextFromRange(range) — 16-char pre/post self-healing window
  - scroll-cfi.ts selectionCfi(baseCfi, range) — scroll-mode selection→range-CFI
affects: [05-03-annotations-ui, 07-sync]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-char DOM offset map + length-checked t2s so a Simplified-normalized search still maps back to real DOM offsets"
    - "Silent stepwise resolver: CFI → text_context (pre/post disambiguated) → fraction → null; never a bare percentage (D-78)"
    - "Live-DOM CFI round-trip tested in node via a minimal html>body>#text substrate (no jsdom dependency)"

key-files:
  created:
    - src/reader/anchor-resolver.ts
    - src/reader/anchor-resolver.test.ts
  modified:
    - src/reader/locator-store.ts
    - src/reader/locator-store.test.ts
    - src/reader/scroll-cfi.ts
    - src/reader/scroll-cfi.test.ts

key-decisions:
  - "text search normalizes needle+haystack to Simplified (convertText t2s) and only trusts the char→offset map when t2s is length-preserving; falls back to raw match otherwise"
  - "No jsdom/happy-dom added — the resolver's DOM surface is faked minimally in-test; the selection→CFI round-trip runs through the REAL foliate fromRange/toRange over a tiny substrate"
  - "resolver never scrolls: fraction tier returns { fractionTarget }, the caller lands it on the nearest paragraph boundary"

patterns-established:
  - "resolveAnchor is the single restore path for both reading-position and annotation anchors (D-77)"
  - "textContextFromRange is the shared pre/exact/post window helper (locator + annotation-store)"

requirements-completed: [ANNO-04]

# Metrics
duration: 8min
completed: 2026-07-17
---

# Phase 5 Plan 02: 复合自愈定位器 Summary

**一个共享的 `resolveAnchor(doc, anchor)` 驱动 CFI → text_context → progress_fraction 的静默逐级降级链（D-77：一份实现、两处调用），补齐阅读位置定位器的 `text_pre/text_post`（P2 曾留空），并新增滚动模式 selection→range-CFI —— 让批注与阅读进度以同一方式锚定，在重排版、跨设备、简繁切换后都能自愈，绝不退化为裸百分比跳转。**

## Performance
- **Duration:** ~8 min
- **Tasks:** 3
- **Files:** 6 (2 created, 4 modified)
- **Tests:** 28 new/extended assertions in-plan; full suite 146 green; `tsc --noEmit` clean.

## Accomplishments
- `anchor-resolver.ts`：`resolveAnchor` 三层链 —— CFI 层（`cfiToRange` + 非空 client rects 校验）→ text_context 层（简繁归一后按 `text_exact` 精确匹配、`text_pre/post` 消歧、降级窗口兜底，命中回 `{range, healed:true}` 供调用方回写新 CFI）→ fraction 层（`{fractionTarget}`，由调用方落到最近段落边界）→ 全部失败回 `null`。
- 复用而非重写：CFI 解析用 `cfiToRange`（scroll-cfi），简繁归一用 `convertText`（cjk-convert-shim），`isRealCfi`（reading-position）守卫。零新依赖（威胁登记 T-05-SC）。
- `locator-store.ts`：新增导出 `textContextFromRange(range)` 返回 `{text_pre, text_exact, text_post}`（每侧 16 字，边界处为空串，无 range 时三字段为 null）；`relocateToLocatorRow` 改为填充真实 pre/post，删除 `// P2: pre/post empty` 空桩。
- `scroll-cfi.ts`：新增 `selectionCfi(baseCfi, range)`，用 `CFI.fromRange` + `CFI.joinIndir` 复用 `visibleRangeCfi` 同款惯用法，与分页模式 `getCFI` 产出可比的 range-CFI。

## Task Commits
1. **Task 1 (TDD RED): failing anchor-resolver tests** - `9a681a4` (test)
2. **Task 1 (TDD GREEN): shared CFI→text→fraction resolver** - `21aaa94` (feat)
3. **Task 2: locator text_pre/text_post via shared window helper** - `409c776` (feat)
4. **Task 3: scroll-mode selectionCfi selection→range-CFI** - `12c653c` (feat)

## Decisions Made
- **简繁归一的偏移对齐**：整段 haystack 走 `convertText(_, 't2s')`，仅当转换后长度不变（opencc 字形转换 near-length-preserving）才信任 `char→(node,offset)` 映射；长度变化的罕见情形回退到原文匹配（同脚本仍可命中，跨脚本落到 fraction 层）。这让「繁体存、简体显」的针也能命中，且映射回真实（简体）DOM 文本。
- **不引入 jsdom/happy-dom**：resolver 触达的 DOM 面在测试中以最小 fake 覆盖；selection→CFI 往返测试则跑通真实 foliate `fromRange`/`toRange`（filter 不传，`NodeFilter` 从不触及），底座是一个 `html>body>#text` 微型 DOM —— 与用 jsdom 等价，但零依赖，契合 CLAUDE.md 供应链零信任 + 计划「No new dependency」硬约束。
- **resolver 永不滚动**：fraction 层只返回 `{fractionTarget}`，滚动/落位是调用方职责（D-78「绝不裸百分比」）。

## Deviations from Plan
计划要求「jsdom via vitest」构造 Document fixture，但本仓库 vitest 环境为 `node` 且未安装 jsdom；`CLAUDE.md` 供应链零信任 + 本计划 objective/威胁登记 T-05-SC 均明确「No new dependency」。

- **[Rule 3 - Blocking] 以最小 in-test fake DOM 替代 jsdom。** 影响：Task 1 用单文本节点 fake doc 驱动 `resolveAnchor`；Task 3 用 `html>body>#text` 微型底座跑真实 CFI 往返。两者都不新增依赖，断言等价（healed/fraction/null、简繁归一、pre/post 消歧、CFI 往返 toString 相等）。未改动任何被测源码逻辑，仅测试基座选择。

## Issues Encountered
- `grep -c "P2: pre/post empty"` 返回 0（符合预期：空桩已删），但 grep 计数为 0 时退出码为 1，曾短路一次校验命令链；已单独复跑 `tsc` 确认干净。无功能问题。

## Known Stubs
None —— 三个导出均对真实类型/真实 CFI 代码接线并有测试覆盖。resolver 与新 helper 的 UI/host 接线（FoliateView / ContinuousScrollStream 事件缝）属后续 05 计划，非本计划范围。

## Threat Flags
无新增安全面。text search 为纯内存字符串匹配 + DOM Range 构造，无 SQL/HTML sink/eval（T-05-05 accept）；无网络端点、无新依赖（T-05-SC accept）。

## Next Phase Readiness
- 05-03 批注 UI/host 接线可直接 `import { resolveAnchor }` 做分页与滚动两侧的批注恢复，用 `selectionCfi` 生成滚动选区的 range-CFI，用 `textContextFromRange` 为新批注写入 pre/exact/post 窗口。
- Challenge E（简繁 / 词不拆行 toggle 后重锚）已在 resolver 的 text_context 层落地并测试通过。

## Self-Check: PASSED

---
*Phase: 05-annotations-composite-locator*
*Completed: 2026-07-17*
