# Requirements: 枕籍（Pillowtome）

**Defined:** 2026-07-09
**Core Value:** 在任意一端打开书，都能以干净、舒适的中文排版稳定阅读，并与自托管（WebDAV）书库/进度状态可靠互通。

> 范围依据领域研究（`.planning/research/SUMMARY.md`、`FEATURES.md`）：v1 = 全部 P1（table-stakes + 中文差异化 moat），v2 = P2，其余 P3 / anti-features 明确排除。技术栈锁定：Tauri v2（共享 Rust 核心）+ React/Vite/TS WebView + foliate-js（MIT）渲染 + SQLite（SQLx / tauri-plugin-sql）+ `reqwest_dav` 同步。

## v1 Requirements

初始发布范围。每条映射到某个 roadmap phase（见 Traceability）。

### Platform Foundation（平台与跨端基座）

- [ ] **FND-01**: 应用可在桌面（Windows / macOS / Linux）启动，并端到端打开一本 EPUB 完成阅读
- [ ] **FND-02**: 应用可在 Android 真机启动，并端到端打开一本 EPUB 完成阅读
- [ ] **FND-03**: 用户可从设备存储导入书籍；Android 经 SAF 授权后书籍持久可访问（基于 storage-handle 抽象，不依赖裸文件路径）
- [x] **FND-04**: 遇到 DRM 加密或损坏书籍时，应用明确提示不支持并安全拒绝（不崩溃、不尝试破解）

### Reading Experience（阅读体验）

- [ ] **READ-01**: 用户可在分页与滚动两种阅读模式间实时切换
- [ ] **READ-02**: 用户可调整字体、字号、行距、页边距
- [ ] **READ-03**: 用户可在日间 / 夜间 / Sepia 主题间切换
- [ ] **READ-04**: 用户可进入沉浸式全屏阅读（隐藏界面 chrome、点触翻页区）
- [ ] **READ-05**: 用户可通过目录（TOC）跳转到任意章节
- [ ] **READ-06**: 用户可导入并在阅读中启用自定义字体
- [ ] **READ-07**: 用户可在书内搜索文本，且搜索对中文分词友好（无空格分隔也能命中）

### Chinese Typography（中文排版差异化 · 核心 moat）

- [ ] **CJK-01**: 中文标点自动挤压（标点占位收窄，`text-spacing-trim`），默认开启且可关闭
- [ ] **CJK-02**: 中英 / 中数混排自动加间距（`text-autospace`，"盘古之白"），含旧 WebView 降级 shim
- [ ] **CJK-03**: 中文禁则处理（行首不出现 。，）」，行尾不出现 （「）
- [ ] **CJK-04**: 中文排版默认值优化（首行缩进 2 字符、CJK 适配默认行高、全角引号等）
- [ ] **CJK-05**: 内置 CJK 字体并按字形覆盖智能回退（消除豆腐块与字体拼凑）

### Library（本地书库）

- [ ] **LIB-01**: 用户可导入文件或扫描文件夹，书籍自动出现在书库
- [ ] **LIB-02**: 书库以封面网格展示书籍
- [ ] **LIB-03**: 书籍显示标题 / 作者等基础元数据
- [ ] **LIB-04**: 用户可按标题 / 作者 / 最近阅读 / 阅读进度排序与筛选

### Annotations & Progress（批注与进度）

- [ ] **ANNO-01**: 用户可对选中文本添加高亮
- [ ] **ANNO-02**: 用户可为高亮附加笔记
- [ ] **ANNO-03**: 用户可添加书签
- [ ] **ANNO-04**: 重新打开书籍时精确恢复到上次阅读位置（复合稳定 locator：CFI + 进度百分比 + 文本上下文，抗重排/跨设备）

### Formats（格式 · v1 硬核 + TXT）

- [ ] **FMT-01**: 用户可打开 TXT 阅读，自动识别 GBK / GB18030 / UTF-8 编码并正确分章

### WebDAV Self-Hosted Sync（自托管同步）

- [ ] **SYNC-01**: 用户可配置并连接自托管 WebDAV 服务器（凭据安全存储于系统 keychain）
- [ ] **SYNC-02**: 阅读进度可通过 WebDAV 在多设备间同步
- [ ] **SYNC-03**: 批注（高亮 / 笔记 / 书签）可通过 WebDAV 在多设备间同步
- [ ] **SYNC-04**: 用户可选择性地同步书籍文件本身（非强制全量，避免大文件拖垮）
- [ ] **SYNC-05**: 同步冲突有明确策略且不丢数据（进度取最远、批注按 UUID 合并 + tombstone 去重）

## v2 Requirements

已认可但推迟，不在当前 roadmap 内。移入 v1 需更新 roadmap。

### Chinese Depth（中文深度）

- **CJKX-01**: 划词词典（CJK 分词 jieba-class + CC-CEDICT / StarDict / MDict 导入 + 选词 UI）
- **CJKX-02**: 简繁转换（OpenCC 短语级，渲染时变换）

### Formats

- **FMT-02**: MOBI / KF8（AZW3）阅读支持

### Ecosystem & Engagement

- **SYNC-06**: KOReader 同步协议互通（kosync：MD5 文档哈希 + 最远进度）
- **LIB-05**: OPDS / Calibre 目录接入
- **LIB-06**: 系列与合集（series / collections）
- **STAT-01**: 阅读统计（时长、连续天数、页/日）
- **TRANS-01**: 段落 / 划选翻译（opt-in，用户自带 API key）

## Out of Scope

明确排除，记录以防范围蔓延。

| Feature | Reason |
|---------|--------|
| PDF 阅读 | 高成本、与中文重排版故事冲突、Android 大文件 OOM 风险；架构预留槽位，v2+ 再做 |
| 竖排 / 直排（vertical text） | 受众窄；待横排打磨完成后作为差异化 flex（v2+） |
| 拼音 / 注音 ruby | 需多音字处理，学习者小众（v2+） |
| TTS（含普通话） | PROJECT 明确将完整 TTS 后置；foliate-js SSML 使后续接入干净 |
| CBZ / FB2 | 出现漫画/该格式受众时经 foliate-js 低成本添加 |
| iOS / Web 正式交付 | 架构可移植但 v1 不发；避免翻倍 QA 与商店审核 |
| 自建中心化账号云 | 运维负担 + 隐私责任，违背 local-first；仅 WebDAV 自托管，账号可选/无 |
| DRM（Adobe ADEPT / Kindle）解密 | 法律雷区、脆弱；仅支持无 DRM / 用户自有文件，明确边界 |
| 全书 DeepL 翻译 | 成本/配额/质量责任，非中文阅读 moat；仅段落/划选翻译 |
| AI 章节/整书摘要 | 云依赖、成本、偏离"干净阅读"；如做须 opt-in + BYO-key |
| Split-screen / Parallel Read | 布局复杂、日常使用低、分散中文核心焦点 |
| 有声书（M4B/MP3）播放器 | 整套媒体子系统，PROJECT 早期排除 |
| 书店 / 内容分发平台 | 把阅读器做成分发/版权平台，违背 charter |
| 实时协作批注 | CRDT/presence 基础设施，受众极小，违背 local-first |
| 大 PDF 库 WebDAV 全量自动同步 | 带宽/存储爆炸；改为选择性文件同步 + 始终同步轻量进度/批注增量 |
| 应用内字体商店 / 云端拉字体 | CSP/供应链面 + 授权风险；仅内置 OFL 字体 + 本地导入 |

## Traceability

各 phase 覆盖哪些需求。由 roadmap 创建时填充（`gsd-roadmapper`）。每条 v1 需求恰好映射到一个 phase，无重复、无遗漏。

| Requirement | Phase | Status |
|-------------|-------|--------|
| FND-01 | Phase 1 — Foundation & Cross-Platform Skeleton | Pending |
| FND-02 | Phase 1 — Foundation & Cross-Platform Skeleton | Pending |
| FND-03 | Phase 1 — Foundation & Cross-Platform Skeleton | Pending |
| FND-04 | Phase 1 — Foundation & Cross-Platform Skeleton | Complete |
| READ-01 | Phase 2 — EPUB Reading Core | Pending |
| READ-02 | Phase 2 — EPUB Reading Core | Pending |
| READ-03 | Phase 2 — EPUB Reading Core | Pending |
| READ-04 | Phase 2 — EPUB Reading Core | Pending |
| READ-05 | Phase 2 — EPUB Reading Core | Pending |
| READ-06 | Phase 2 — EPUB Reading Core | Pending |
| READ-07 | Phase 2 — EPUB Reading Core | Pending |
| CJK-01 | Phase 3 — CJK Typography Differentiation | Pending |
| CJK-02 | Phase 3 — CJK Typography Differentiation | Pending |
| CJK-03 | Phase 3 — CJK Typography Differentiation | Pending |
| CJK-04 | Phase 3 — CJK Typography Differentiation | Pending |
| CJK-05 | Phase 3 — CJK Typography Differentiation | Pending |
| LIB-01 | Phase 4 — Local Library | Pending |
| LIB-02 | Phase 4 — Local Library | Pending |
| LIB-03 | Phase 4 — Local Library | Pending |
| LIB-04 | Phase 4 — Local Library | Pending |
| ANNO-01 | Phase 5 — Annotations & Composite Locator | Pending |
| ANNO-02 | Phase 5 — Annotations & Composite Locator | Pending |
| ANNO-03 | Phase 5 — Annotations & Composite Locator | Pending |
| ANNO-04 | Phase 5 — Annotations & Composite Locator | Pending |
| FMT-01 | Phase 6 — TXT Format & Format-Abstraction Validation | Pending |
| SYNC-01 | Phase 7 — WebDAV Self-Hosted Sync | Pending |
| SYNC-02 | Phase 7 — WebDAV Self-Hosted Sync | Pending |
| SYNC-03 | Phase 7 — WebDAV Self-Hosted Sync | Pending |
| SYNC-04 | Phase 7 — WebDAV Self-Hosted Sync | Pending |
| SYNC-05 | Phase 7 — WebDAV Self-Hosted Sync | Pending |

**Coverage:**
- v1 requirements: 30 total（FND 4 · READ 7 · CJK 5 · LIB 4 · ANNO 4 · FMT 1 · SYNC 5）
- Mapped to phases: 30 ✓（每条恰好一个 phase，无重复）
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-09*
*Last updated: 2026-07-09 after roadmap creation (traceability populated, 30/30 mapped)*
