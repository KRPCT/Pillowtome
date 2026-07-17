---
phase: 05-annotations-composite-locator
plan: 05-06
subsystem: reader
tags: [spine-resolution, pdf, defect-fix, pure-helper, tdd]
requires:
  - src/reader/ContinuousScrollStream.tsx (ContinuousSection.id type)
provides:
  - matchSectionByHref (typed-guard pure helper for spine href matching)
affects:
  - src/reader/FoliateView.tsx (resolveSpineIndex path-match branch)
tech-stack:
  added: []
  patterns:
    - "非字符串 section id 用 typeof 守卫集中一处拦截,覆盖所有调用方(纯函数)"
key-files:
  created: []
  modified:
    - src/reader/reading-position.ts
    - src/reader/reading-position.test.ts
    - src/reader/FoliateView.tsx
decisions:
  - "[05-06] matchSectionByHref 取 unknown 参数 + typeof 守卫,不耦合 ContinuousSection 组件类型;PDF 数字 ref {num,gen} 静默返回 false 不抛错"
metrics:
  duration: 3 min
  completed: 2026-07-18
  tasks: 2
  files: 3
---

# Phase 05 Plan 05-06: PDF spine-resolution numeric-ref guard Summary

修复 DEFECT 2:把 `resolveSpineIndex` 内联的无守卫 `s.id.endsWith(...)` 抽成带 `typeof` 守卫的纯函数 `matchSectionByHref`,PDF 数字 ref id(`{num,gen}`)静默跳过而非抛 `Te.id.endsWith is not a function` 刷屏 logcat。

## What Was Built

- **`matchSectionByHref(sectionId: unknown, hrefPath: string): boolean`**(`reading-position.ts`):首行 `typeof sectionId !== "string"` 守卫拦掉 PDF 数字 ref,否则做全等 / 前缀 / 后缀三向匹配。参数取 `unknown` 而非 `ContinuousSection`,保持纯 helper 与组件类型解耦。
- **单测**(`reading-position.test.ts`):按 `<behavior>` 六条覆盖——数字-ref 不抛错且返回 false、undefined、前缀、后缀、全等、非匹配。
- **`FoliateView.resolveSpineIndex`**:path-match 分支从内联判定改调 `matchSectionByHref(s.id, hrefPath)`;`resolveNavigation/resolveHref/resolveCFI` 候选循环与 catch `console.warn` 兜底未动。

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 (RED) | 失败单测 | b5bce74 | reading-position.test.ts |
| 1 (GREEN) | matchSectionByHref 落地 | 7f17af2 | reading-position.ts |
| 2 | resolveSpineIndex 改用守卫 | dbe8d17 | FoliateView.tsx |

## Verification

- `pnpm test -- reading-position`:160/160 绿(新增 4 条 matchSectionByHref 用例)。
- `pnpm exec tsc --noEmit`:干净。
- `grep -n "s.id.endsWith" src/reader/FoliateView.tsx`:无输出。
- `pnpm build`:成功(built in 10.80s)。

## Deviations from Plan

None - plan executed exactly as written.

## Threat Model

T-05-15(DoS,非字符串 id 调 `.endsWith` 抛错刷屏)已 mitigate:`typeof` 守卫 + 数字-ref 单测,纯函数集中一处修覆盖所有调用方。

## TDD Gate Compliance

RED(test b5bce74:4 用例先失败)→ GREEN(feat 7f17af2:160 全绿)→ 无需 REFACTOR。门序完整。

## Notes

- Android 设备门(logcat 干净复验)属 05-08 范畴,本计划桌面 + 单测可验证,不触发设备门。
- EPUB TOC/搜索/CFI→spine 行为不变(前缀/后缀/全等三种匹配由单测锁定)。

## Self-Check: PASSED
