# Phase 2: EPUB Reading Core - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-15
**Phase:** 2-EPUB Reading Core
**Areas discussed:** 阅读偏好持久化, 阅读位置恢复, 自定义字体落地, 搜索与桌面键鼠

---

## 阅读偏好持久化

### Q1 存储层

| Option | Description | Selected |
|--------|-------------|----------|
| localStorage | 前端 JSON；最快 | |
| SQLite 新表 | tauri-plugin-sql；与 schema 统一 | ✓ |
| You decide | 实现侧选择 | |

**User's choice:** SQLite 新表

### Q2 范围

| Option | Description | Selected |
|--------|-------------|----------|
| 全局 | 换书继承同一套排版 | ✓ |
| 每本书覆盖 | 全局 + per-book | |
| 仅全局，P5 再加 per-book | 延迟 per-book | |

**User's choice:** 全局

### Q3 生效方式

| Option | Description | Selected |
|--------|-------------|----------|
| 立即生效并自动保存 | 无应用按钮；防抖写入 | ✓ |
| 预览后点完成才保存 | 关闭 sheet 持久化 | |
| You decide | | |

**User's choice:** 立即生效并自动保存

---

## 阅读位置恢复

### Q1 是否持久化

| Option | Description | Selected |
|--------|-------------|----------|
| 写 locator 表并恢复 | 复用 schema v1；P5 不重做进度 | ✓ |
| 仅会话内记住 | 关书即丢 | |
| 只存 fraction | 与 D-08 冲突 | |

**User's choice:** 写 locator 表并恢复

### Q2 写入时机

| Option | Description | Selected |
|--------|-------------|----------|
| relocate 防抖 + 关书 flush | ~500ms + unmount flush | ✓ |
| 仅关书时写 | 杀进程可能丢 | |
| 每次翻页立即写 | I/O 重 | |

**User's choice:** relocate 防抖 + 关书 flush

### Q3 无进度/失效

| Option | Description | Selected |
|--------|-------------|----------|
| 从正文开头开始 | goToTextStart；无弹窗 | ✓ |
| 总是目录第一章 | | |
| You decide | | |

**User's choice:** 从正文开头开始

---

## 自定义字体落地

### Q1 落地策略

| Option | Description | Selected |
|--------|-------------|----------|
| 复制到应用数据目录 | app data/fonts/ + SQLite 元数据 | ✓ |
| 只记外部路径/URI | 依赖 SAF/路径 | |
| You decide | | |

**User's choice:** 复制到应用数据目录

### Q2 上限

| Option | Description | Selected |
|--------|-------------|----------|
| 最多 20 个，单文件 ≤ 20MB | | ✓ |
| 不限制数量，单文件 ≤ 50MB | | |
| You decide | | |

**User's choice:** 最多 20 个，单文件 ≤ 20MB

### Q3 移除行为

| Option | Description | Selected |
|--------|-------------|----------|
| 删应用副本 + 清元数据 | 当前字体则回退系统 | ✓ |
| 仅从表移除 | 可能留孤儿文件 | |
| You decide | | |

**User's choice:** 删应用副本 + 清元数据

---

## 搜索与桌面键鼠

### Q1 搜索路径

| Option | Description | Selected |
|--------|-------------|----------|
| foliate-js search API | view.search()；缺口再薄适配 | ✓ |
| 自研前端子串扫描 | | |
| You decide | | |

**User's choice:** foliate-js search API

### Q2 桌面键盘

| Option | Description | Selected |
|--------|-------------|----------|
| 基础键位 | ←/→ PageUp/Down；Esc；/ 或 Ctrl+F | ✓ |
| 仅翻页键 | | |
| 不要快捷键 | | |

**User's choice:** 基础键位

### Q3 搜索范围

| Option | Description | Selected |
|--------|-------------|----------|
| 全书 | 结果带章节 | ✓ |
| 仅当前章节 | | |
| You decide | | |

**User's choice:** 全书

---

## Claude's Discretion

- Migration SQL 细节、防抖常量、font-face 服务方式、torture corpus 夹具、可选 3s chrome 自动隐藏

## Deferred Ideas

- Per-book prefs；P5 批注 UI；P3 CJK moat；P4 书库 UI；P7 同步 prefs/progress；高级搜索/vim 键
