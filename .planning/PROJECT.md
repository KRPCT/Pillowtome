# 枕籍（Pillowtome）

## What This Is

枕籍是一款**多平台互通的电子书阅读器**：以优秀的中文阅读体验为差异化，对标 Readest 级能力（多格式、书库、批注、主题、自托管同步），v1 覆盖**桌面（Windows / macOS / Linux）+ Android**。产品路径是按 Readest 级能力分里程碑交付——**架构按完整阅读器一次到位，功能分阶段填满**；早期里程碑可对齐 Lithium 的沉浸式 EPUB 核心体验，再扩展多格式与全量同步。

## Core Value

在任意一端打开书，都能以**干净、舒适的中文排版**稳定阅读，并与自托管（WebDAV）书库/进度状态**可靠互通**。

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] 多格式阅读引擎：至少 EPUB 为硬核；规划 MOBI/KF8、PDF、TXT 等（分阶段上线）
- [ ] 本地书库：导入/扫描、封面、元数据、排序与基础整理
- [ ] 阅读体验：分页/滚动、字体/字号/行距/边距、日间/夜间/Sepia 等主题
- [ ] 批注系统：高亮、笔记、书签；与阅读进度一并可同步
- [ ] 中文阅读差异化：CJK 字体与排版、中英混排、划词词典/翻译路径（可作为差异化优先项）
- [ ] WebDAV / 自托管同步：书库文件 + 进度/批注全同步（隐私与可控优先，不绑死单一公有云）
- [ ] 双端交付：桌面（Win/macOS/Linux）与 Android 共用核心逻辑与同步协议
- [ ] 无广告、本地优先的默认数据模型（账号可选/可无）

### Out of Scope

- 自建中心化账号云（v1）— 优先 WebDAV/自托管，降低运维与隐私负担
- iOS / Web 正式交付（v1）— 架构可预留，发布后置
- 有声书 / 完整 TTS 产品化（早期）— 可作为后续里程碑
- 书店/版权分发平台 — 阅读器本身，不做成内容商店
- 照搬 Readest 全部高级能力（并行阅读、DeepL 全书翻译等）— 按价值与中文体验优先级择优，而非功能堆砌

## Context

### 产品名与意象

- **枕籍**：枕着书籍入睡——强调沉浸、日常、陪伴式阅读
- **Pillowtome**：英文侧名称，便于代码与仓库标识

### 对标与参照

| 参照 | 角色 | 要点 |
|------|------|------|
| **Lithium: EPUB Reader** | 体验基线 / 早期功能参考 | 简洁 Material 风格、自动书库检测、高亮笔记、分页/滚动、主题、无广告；Pro 用 Drive 同步进度/批注（不同步书文件） |
| **Readest** | 能力天花板 / 架构参照 | Next.js + Tauri v2；EPUB/MOBI/PDF 等多格式；跨端同步；OPDS/Calibre；AGPL 开源 |
| **lithiumpatch / Koreader** | 进阶能力与同步生态 | 自定义字体、词典、系列元数据；Koreader 同步协议可作互通备选研究 |

### 战略决策（提问阶段已确认）

1. **平台**：v1 = 桌面 + Android（非仅手机、非全平台一次做完）
2. **互通**：书库 + 进度/批注**全同步**（不仅进度）
3. **格式**：多格式目标；实现可分阶段，但架构不为「仅 EPUB」锁死
4. **定位**：对标 Readest 级产品，而非「个人小工具」
5. **差异化**：**更干净的中文阅读体验**（排版、字体、词典等）
6. **同步**：**WebDAV / 自托管**（推荐路径）
7. **路径**：**直接按 Readest 级切里程碑**（架构预留多格式与同步；功能分波交付）
8. **技术栈**：由领域研究推荐（不预设框架）

### 已知行业痛点（研究前已知）

- Lithium：权限/文件访问、维护节奏、缺词典/TTS 等
- 中文阅读器常见问题：CJK 断行/标点挤压、字体回退难看、竖排与混排支持弱
- 跨端阅读器难点：渲染一致性、大 PDF 性能、同步冲突、DRM 边界

## Constraints

- **Platforms (v1)**：Windows / macOS / Linux 桌面 + Android；iOS/Web 后置但架构宜可扩展
- **Sync**：默认自托管 WebDAV；不强制依赖 Google Drive / 专有云
- **Privacy**：本地优先；同步内容用户可控；无广告、无追踪式变现
- **Chinese UX**：中文阅读质量是差异化硬指标，不可为「先英文跑通」长期牺牲
- **Architecture**：多格式 + 同步从设计日起纳入边界，避免 Lithium 式后期硬拆
- **Tech stack**：待研究锁定；优先可维护的跨端方案，避免无必要的双写 UI
- **License**：待定（若借鉴 AGPL 组件如 foliate-js 周边需审许可证传染面）

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| v1 平台 = 桌面 + Android | 覆盖日常阅读主力场景，控制首发范围 | — Pending |
| 同步 = WebDAV / 自托管 | 隐私、可控、与 Koreader 等生态可对齐 | — Pending |
| 能力对标 Readest 级分里程碑 | 避免「只做 Lithium 再推翻架构」 | — Pending |
| 差异化 = 中文阅读体验 | 公开市场已有 Readest；中文体验是可赢切口 | — Pending |
| 多格式（非仅 EPUB） | 真实书库形态；EPUB 仍是第一硬核 | — Pending |
| 技术栈由研究推荐 | 降低框架偏见，用领域证据选型 | — Pending |
| 早期可对齐 Lithium 功能面 | 保证首个可用里程碑有清晰「能读、能标、能换肤」验收 | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-09 after initialization*
