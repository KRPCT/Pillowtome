# Phase 4: Local Library - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-16
**Phase:** 4-Local Library
**Areas discussed:** 入库与去重, 封面网格与信息, 排序筛选与默认视图, 打开/续读与进度展示

---

## 入库与去重

| Question | Selected |
|----------|----------|
| 入口 | 双入口：导入书籍 + 扫描文件夹 ✓ |
| content_hash 再导入 | 跳过并提示 ✓ |
| 存储关系 | 注册引用 BookSource（不强制拷全书） ✓ |
| 扫描策略 | 递归扫 EPUB；DRM/损坏 soft-fail 汇总 ✓ |

**User's choice:** 全部推荐项  
**Notes:** 与 FND-03/DEC-004 一致；字体 copy 策略不套用到整本 EPUB

---

## 封面网格与信息

| Question | Selected |
|----------|----------|
| 布局 | 封面网格 ✓ |
| 标题作者位置 | 封面下方 ✓ |
| 无封面 | 纸感占位 ✓ |
| 元数据粒度 | 网格简、详情全 ✓ |

**User's choice:** 全部推荐项  

---

## 排序筛选与默认视图

| Question | Selected |
|----------|----------|
| 默认排序 | 最近阅读优先 ✓ |
| 控件 | 顶栏 chips + 排序按钮 ✓ |
| 筛选 | 全部/在读/未读/已读完 + 独立排序 ✓ |
| 空态 | 引导双入口 CTA ✓ |

**User's choice:** 全部推荐项  

---

## 打开/续读与进度展示

| Question | Selected |
|----------|----------|
| 打开 | 静默续读 ✓ |
| 进度 UI | 细进度条+可选% ✓ |
| READER-POS | 用户无感 SSOT ✓ |
| 最近阅读时间 | open + 阅读中 debounced 刷新 ✓ |

**User's choice:** 全部推荐项  

---

## Claude's Discretion

- Schema 表结构细节、封面缓存、在读/已读阈值、详情交互、jump bus 内部设计、大目录扫描进度 UI

## Deferred Ideas

- OPDS/Calibre/系列合集；跨书搜索；强制拷贝全书；物理机门禁仍按 D-13
