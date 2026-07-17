# Phase 5: Annotations & Composite Locator - Context

**Gathered:** 2026-07-17
**Status:** Ready for planning

<domain>
## Phase Boundary

让读者**高亮、加笔记、加书签**，并把**复合自愈 locator**（CFI → text_context → progress fraction）正式落地 + 为每条记录写入**追加式 change-log**（暂不同步）——这是让 Phase 7 同步成为「对账」而非「重写」的直接前置。

**In scope（ANNO-01..04 + roadmap success criteria）：**
- 高亮（4 色）、下划线（独立类型）、笔记（高亮 + 文本）、书签（point-CFI 位置标记）
- 选区浮层气泡（颜色/下划线/笔记/复制）+ 笔记编辑 sheet + 批注管理 sheet（按章分组·点跳·swipe 删）
- 持久化 + 恢复：开书加载某 work 的批注并绘制；抗 reopen / resize / 字号版式变更 / paginate↔scroll 切换
- 复合自愈 locator：给「阅读位置」和「批注」都写 text_context，实现 CFI→文本→fraction 回退，**两者共用同一 resolver**
- Sync-ready：软删 tombstone + 每次变更追加 change_log op + annotation 行带 revision/updated_at/content_hash

**Explicitly NOT in this phase：**
- 查词/字典（v2 CJKX-01；气泡预留位置不展示）
- 跨设备冲突解决 UI / 实际 WebDAV 同步（P7——本阶段只到 sync-ready schema）
- 批注导出、多选批量删除（未纳入 ANNO-01..04）
- 波浪线/删除线标注样式（Overlayer 已支持，按需再加）
- 竖排 / 拼音 ruby（v2+）

</domain>

<decisions>
## Implementation Decisions

### 承接锁定（不重新决定）
- **CFI 是唯一位置货币**（P4 READER-POS）：批注 = CFI range + 呈现；offset/%、屏幕矩形均派生、reflow 时重钉。`position-bus.ts` 是单一 SSOT。
- **复合 locator 列已存在**：`locator-store.ts` 已有 `text_pre / text_exact / text_post / progress_fraction`（P2/P4 起预留、未填充）。P5 是**填充 + 实现自愈**，不是加这些列。
- **两模式绘制/选区分裂**：分页 iframe 藏在**闭合 shadow root**（`view.js` / `paginator.js` 均 `attachShadow({mode:'closed'})`）→ 用 foliate 原生 overlayer（`draw-annotation` 事件）；滚动流自管 iframe → 需自注入（与书内链接 / CJK transform **同一 section-doc seam**）。见 [[pillowtome-paginate-closed-shadow-transform]]。
- **change_log 脊柱**（UUID + blake3 content hash + 逐设备单调逻辑时钟）自 schema v1 就在，present-but-unsynced——批注直接复用（D-09）。
- **产品语言 简体中文**（D-30）；**朱砂 / 纸感** UI（P2 UI-SPEC）；书字节永不过 IPC，批注是小结构走 SQL 无碍（D-06）。

### 批注视觉与类型
- **D-70：4 色高亮小板** —— 朱砂红为主 + 赭 / 黛绿 / 靛蓝 三色低饱和；日/夜/Sepia 三主题下都要读得清。具体色值留 UI 环节定。
- **D-71：下划线作为独立标注类型** —— `type = highlight | underline`，各自带颜色，共用同一 Overlayer 接口 + 同一 store。
- **D-72：选区气泡动作集** —— 颜色 · 下划线 · 笔记 · 复制。查词位置**预留但不展示**（留给 v2 CJKX-01）。
- **D-73：点已有标注 → 重开同一气泡** —— 多一个「删除」；可改色 / 加或编辑笔记 / 删。一套气泡承载新建 vs 编辑两种语境。

### 选区与触控交互
- **D-74：原生选择手柄 → 选区稳定后自动弹气泡** —— Android 长按进系统原生选择、桌面鼠标划选；监听 section doc 内 `selectionchange`/`pointerup` settle。**禁止**在可滚动内容上盖全屏 `pointer-events:auto` 层（CLAUDE.md 触控 gate）；注入点与链接/autospace shim 同一 seam。
- **D-75：气泡贴选区上方、空间不够翻下（带箭头）** —— iframe→页面坐标需映射；点空白 / 滚动 / 翻页 / 切模式即消失。
- **D-76：桌面与 Android 同一套气泡** —— 鼠标 `mouseup` 与触控 `pointerup` 同一路径，只维护一套交互。右键上下文菜单作为桌面**可选**加强（非必须）。

### 复合定位自愈
- **D-77：阅读位置 + 批注都自愈，共用同一 resolver** —— 一处实现、两处调用。因 ANNO-04 明确要求高亮/书签在字号/页边距变化及跨设备后仍锚定（CFI → text_context → progress fraction）。
- **D-78：回退链 CFI → text_context 搜索 → progress_fraction，逐级静默降级** —— CFI 解析成功即用；失败→用 `text_exact`(+pre/post) 在本章/全书搜回；再不行→fraction 近似定位到最近段落。正常情况无感，不弹「找不到」。fraction 只作最后兜底，**绝不裸跳无锚**（沿用 P1「never a bare percentage」）。
- **D-79：transform 下 range-CFI 主锚 + text_context 兜底** —— 存 range-CFI；简繁是长度守恒（OpenCC `Locale.to.tw`）CFI 应稳；词不拆行包 nowrap span 改结构 → 靠 text_context 回退，与自愈链同一机制。**「CFI 在词不拆行下是否存活」= research 验证项（计划挑战 E）。**

### 删除与同步就绪
- **D-80：删批注用软删 tombstone（现在就落）** —— 删除 = 标 deleted + 记一条 delete change_log（带 device+clock），不物理抹除。让 Phase 7 能把「删除」当可合并操作、防已删批注跨端复活（tombstone 去重）。保留时长/清理策略留 planner。
- **D-81：change_log 每次 create/update/delete 追一行 op（追加式账本）** —— 携带 op / entity=annotation / uuid / device / clock / content_hash；annotation 行同时带 `revision` / `updated_at` / `content_hash`。这就是 P7 对账的账本，是本阶段交付物（roadmap「landing the per-record change-log schema, unsynced」）。
- **D-82：书签 = `type=bookmark`（point-CFI，无 range/color）同一 annotation 表 + 同一 change_log/sync 路径** —— 一套 store、一条 sync 路径、同一回退自愈。顶栏 toggle 当前位置为书签；书签列表并入批注 sheet。

### Claude's Discretion
- **scroll 模式高亮绘制技术选型（计划挑战 A）** —— CSS Custom Highlight API（`CSS.highlights` + `::highlight()`，WebView 134 有）vs 每 section 一个 foliate `Overlayer` + reflow 时 `redraw()`。**research 先定**，分页保持 foliate 原生 overlayer。
- **text_context 窗口长度** —— `text_pre`/`text_post` 各存多少字符（唯一定位所需）由 planner/research 定。
- **annotation 表列/索引** —— schema **V7**（当前 max = V6）；append-only migration；`annotation-store.ts` 形状。
- **tombstone 保留与清理策略**。
- **笔记编辑 sheet / 批注管理 sheet 交互细节** —— 沿用 `docs/READER-PHASE5-ANNOTATIONS-PLAN.md`，不重议。
- **具体朱砂色值**（4 色）。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 本阶段主计划（最重要，先读）
- `docs/READER-PHASE5-ANNOTATIONS-PLAN.md` —— 用户手写的 ad-hoc Phase 5 计划：数据模型（annotation schema v7）、foliate API 落点（`view.addAnnotation` / `draw-annotation` / `Overlayer` / `view.getCFI`）、挑战 A–E、UI、7 步序列、3 个 research 项。**决策以本 CONTEXT 为准，实现细节沿用此计划。**

### 阶段范围与需求
- `.planning/ROADMAP.md` —— Phase 5 目标 / 成功标准 / 05-01..03 计划草图
- `.planning/REQUIREMENTS.md` —— ANNO-01..04（v1）
- `.planning/PROJECT.md` —— 产品 charter，local-first，简体中文 UX
- `.planning/STATE.md` —— 项目位置（含 ad-hoc 交付说明）
- `.planning/v1.0-MILESTONE-AUDIT.md` —— ANNO-04 note：P2 locator 只用于进度，`text_pre/text_post` 故意留空、reserved for P5

### 前序阶段锁定
- `.planning/phases/01-foundation-cross-platform-skeleton/01-CONTEXT.md` —— D-01..D-13（Publication、composite Locator、change-log 脊柱、DRM、pillow://）
- `.planning/phases/02-epub-reading-core/02-CONTEXT.md` —— D-20..D-26（locator 进度、work_id、软失败）
- `.planning/phases/02-epub-reading-core/02-UI-SPEC.md` —— 纸感 / 朱砂视觉语言，气泡/sheet 沿用
- `.planning/phases/03-cjk-typography-differentiation/03-CONTEXT.md` —— D-30 语言；简繁/词不拆行 transform 背景
- `.planning/phases/04-local-library/04-CONTEXT.md` —— READER-POS SSOT、work_id/content_hash 身份

### 架构与坑
- `.planning/research/ARCHITECTURE.md` —— Publication、身份、复合 locator、IPC/pillow 边界
- `.planning/research/PITFALLS.md` —— locator 稳定性、SAF、EPUB-lock

### 实现触点（code）
- `src/reader/locator-store.ts` —— **已含** `text_pre/text_exact/text_post/progress_fraction` 列（P5 填充 + 自愈解析）
- `src/reader/position-bus.ts` —— 单一 SSOT jump bus（`jumpTo` / `jumpContinuousToSpine`），批注跳转复用
- `src/reader/scroll-cfi.ts` —— 滚动模式 range↔CFI 每 section 解析（选区→CFI、自愈搜索复用）
- `src/reader/reading-position.ts` —— 双面恢复
- `src/reader/FoliateView.tsx` —— 分页 host；`draw-annotation` / `create-overlayer` / `view.getCFI` 落点；`book.transformTarget` 挂载点
- `src/reader/ContinuousScrollStream.tsx` —— 滚动流自管 iframe；选区/绘制自注入 seam（与 link/autospace shim 同点）
- `src/reader/cjk-content-transform.ts` —— 简繁/词不拆行 transformTarget（挑战 E 的 span-wrap 来源）
- `src-tauri/src/migrations.rs` —— SCHEMA_V1..V6；新增 **V7** annotation 表（append-only）

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `locator-store.ts` 复合列已就绪 —— 自愈是「填充 + 写 resolver」，不是加 schema
- `position-bus.ts` 单一 jump bus —— 批注/书签列表点跳直接复用，勿另造第二总线
- `scroll-cfi.ts` —— 选区→range-CFI（滚动）与自愈文本搜索的现成落点
- foliate `view.addAnnotation` / `draw-annotation` / `Overlayer` / `view.getCFI` —— 分页绘制与选区→CFI 的原生路径
- 滚动流 section-doc 注入 seam（link-click / autospace shim / cjk-content-transform）—— 选区监听 + 绘制**同一 seam**，可抽一个共享「per-section-doc hook」
- change_log 表（schema v1，UUID + blake3 + 逐设备逻辑时钟）—— 批注 sync-ready 直接写入

### Established Patterns
- Append-only SQL migrations（V1→V6，P5 加 V7）
- 软失败 简体中文；书字节永不过 IPC；小结构/元数据走 SQL
- transformTarget 内容级转换（两模式通用、CFI 基于转换后内容）—— 批注需在此约束下解析
- 全局 prefs；批注是 per-work 数据不是 per-book 排版覆盖

### Integration Points
- 开书 → 加载该 work 批注 → 分页 `view.addAnnotation` 逐条 / 滚动逐 section 绘制；mode-switch 从同一 store 重放
- 选区 → range-CFI（分页 `view.getCFI`；滚动 `scroll-cfi.ts`）→ annotation 行 + change_log op
- 删除 → tombstone + delete op；恢复/自愈 → 共用 resolver（阅读位置 & 批注）

</code_context>

<specifics>
## Specific Ideas

- 用户全程倒向**推荐/最少代码**选项：4 色板、下划线独立类型、气泡 4 动作、重开气泡编辑、原生选择手柄、贴选区浮层、桌面同一套气泡、两者共用 resolver、CFI→文本→fraction 静默降级、range-CFI 主 + text 兜底、软删 tombstone、追加式 change_log、书签同表同路径。
- 交互对齐 Apple Books / Readest 的高亮甜蜜区（clean-room，不抄 AGPL Readest 代码）。
- 全部批注 chrome / 空态 / 错误态维持 **简体中文**。

</specifics>

<deferred>
## Deferred Ideas

- **查词 / 字典**（v2 CJKX-01）—— 气泡预留位置，不展示
- **波浪线 / 删除线标注样式** —— Overlayer 已支持，需求出现再加
- **桌面右键上下文菜单** —— 可选加强，非必须
- **批注导出 / 多选批量删除** —— 未纳入 ANNO-01..04，未来阶段
- 以上均不扩大 P5 成功标准。

</deferred>

---

*Phase: 5-Annotations & Composite Locator*
*Context gathered: 2026-07-17*
