# Phase 5: Annotations & Composite Locator - Research

**Researched:** 2026-07-17
**Domain:** WebView 阅读器批注（高亮/下划线/笔记/书签）+ 复合自愈 locator（CFI → text_context → progress fraction）+ 追加式 change-log（sync-ready，未同步）
**Confidence:** HIGH（foliate API / 现有代码路径均已就地核对；仅 Android 旧机 WebView 版本方差与设备端气泡坐标为 MEDIUM，需模拟器验收）

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions（承接锁定 + 本阶段决策，逐条照抄）

**承接锁定（不重新决定）**
- **CFI 是唯一位置货币**（P4 READER-POS）：批注 = CFI range + 呈现；offset/%、屏幕矩形均派生、reflow 时重钉。`position-bus.ts` 是单一 SSOT。
- **复合 locator 列已存在**：`locator-store.ts` 已有 `text_pre / text_exact / text_post / progress_fraction`。P5 是**填充 + 实现自愈**，不是加这些列。
- **两模式绘制/选区分裂**：分页 iframe 藏在**闭合 shadow root** → 用 foliate 原生 overlayer（`draw-annotation`）；滚动流自管 iframe → 需自注入（与书内链接 / CJK transform **同一 section-doc seam**）。
- **change_log 脊柱**（UUID + blake3 content hash + 逐设备单调逻辑时钟）自 schema v1 就在，present-but-unsynced——批注直接复用（D-09）。
- **产品语言 简体中文**（D-30）；**朱砂 / 纸感** UI；书字节永不过 IPC，批注是小结构走 SQL 无碍（D-06）。

**批注视觉与类型**
- **D-70**：4 色高亮小板（朱砂红为主 + 赭 / 黛绿 / 靛蓝）；日/夜/Sepia 三主题下都要读得清。具体色值留 UI 环节定。
- **D-71**：下划线作为独立标注类型（`type = highlight | underline`），各自带颜色，共用同一 Overlayer 接口 + 同一 store。
- **D-72**：选区气泡动作集 = 颜色 · 下划线 · 笔记 · 复制。查词位置预留但不展示（v2 CJKX-01）。
- **D-73**：点已有标注 → 重开同一气泡，多一个「删除」；一套气泡承载新建 vs 编辑。

**选区与触控交互**
- **D-74**：原生选择手柄 → 选区稳定后自动弹气泡；监听 section doc 内 `selectionchange`/`pointerup` settle。**禁止**在可滚动内容上盖全屏 `pointer-events:auto` 层；注入点与链接/autospace shim 同一 seam。
- **D-75**：气泡贴选区上方、空间不够翻下（带箭头）；iframe→页面坐标需映射；点空白/滚动/翻页/切模式即消失。
- **D-76**：桌面与 Android 同一套气泡；`mouseup` 与 `pointerup` 同一路径。右键菜单为桌面可选加强。

**复合定位自愈**
- **D-77**：阅读位置 + 批注都自愈，共用同一 resolver（一处实现、两处调用）。
- **D-78**：回退链 CFI → text_context 搜索 → progress_fraction，逐级静默降级；fraction 只作最后兜底，**绝不裸跳无锚**。
- **D-79**：transform 下 range-CFI 主锚 + text_context 兜底。简繁长度守恒 CFI 应稳；词不拆行包 nowrap span 改结构 → 靠 text_context 回退。「CFI 在词不拆行下是否存活」= research 验证项（挑战 E）。

**删除与同步就绪**
- **D-80**：删批注用软删 tombstone（现在就落）= 标 deleted + 记一条 delete change_log（带 device+clock）。保留时长/清理策略留 planner。
- **D-81**：change_log 每次 create/update/delete 追一行 op（op / entity=annotation / uuid / device / clock / content_hash）；annotation 行同时带 revision / updated_at / content_hash。
- **D-82**：书签 = `type=bookmark`（point-CFI，无 range/color）同一 annotation 表 + 同一 change_log/sync 路径 + 同一回退自愈。

### Claude's Discretion（research/planner 定）
- **scroll 模式高亮绘制技术选型（挑战 A）** —— CSS Custom Highlight API vs 每 section 一个 foliate `Overlayer` + `redraw()`。**本研究已定，见下。**
- **text_context 窗口长度** —— `text_pre`/`text_post` 各存多少字符。**本研究已定，见下。**
- **annotation 表列/索引** —— schema **V7**（当前 max = V6）；append-only migration；`annotation-store.ts` 形状。
- **tombstone 保留与清理策略**。
- **笔记编辑 sheet / 批注管理 sheet 交互细节** —— 沿用 `docs/READER-PHASE5-ANNOTATIONS-PLAN.md`，不重议。
- **具体朱砂色值**（4 色）。

### Deferred Ideas（OUT OF SCOPE，忽略）
- **查词 / 字典**（v2 CJKX-01）—— 气泡预留位置，不展示。
- **波浪线 / 删除线标注样式** —— Overlayer 已支持，需求出现再加。
- **桌面右键上下文菜单** —— 可选加强，非必须。
- **批注导出 / 多选批量删除** —— 未纳入 ANNO-01..04。
- **实际 WebDAV 同步 / 冲突解决 UI**（P7）—— 本阶段只到 sync-ready schema。
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **ANNO-01** | 用户可对选中文本添加高亮 | 选区→range-CFI（分页 `view.getCFI`；滚动 `scroll-cfi.cfiToRange`/`visibleRangeCfi`）；绘制（分页 `draw-annotation`+`Overlayer.highlight`；滚动 CSS Custom Highlight API）；`annotation` 表 V7 |
| **ANNO-02** | 用户可为高亮附加笔记 | `type=note` = highlight + `note` 列；气泡「笔记」动作 → note editor sheet；同一 annotation 行 |
| **ANNO-03** | 用户可添加书签 | `type=bookmark`（point-CFI，无 range/color，D-82）；顶栏 toggle 当前位置；并入批注 sheet |
| **ANNO-04** | 重开精确恢复（复合稳定 locator，抗重排/跨设备） | 共享自愈 resolver（D-77/D-78）：CFI → text_context 搜索 → progress_fraction；`locator` 与 `annotation` 同列同 resolver；跨状态（简繁/词不拆行 toggle）由 text_context 救回（挑战 E） |
</phase_requirements>

## Summary

本阶段无新增第三方依赖：foliate-js 已 vendored，blake3 已在 Rust core（`work.content_hash`），`opencc-js@1.4.1`、`Intl.Segmenter`、`crypto.randomUUID`、CSS Custom Highlight API 均为现成/内建。P5 的全部工作是**在既有阅读壳层上接线**，不是引入新技术栈。

三个 research 分叉点已定论：**(A)** 滚动模式高亮用 **CSS Custom Highlight API**（`CSS.highlights` + `::highlight()`），因为它用 live `Range` 自动随 reflow 重绘、零 DOM 覆盖层、不碰触控 gate；分页保持 foliate 原生 overlayer 不变。**(E)** range-CFI 在**同一 transform 状态内稳定**（transformTarget 先于解析、CFI 基于转换后 DOM），仅在用户**跨状态 toggle 简繁/词不拆行触发 `reopenTick` 全量重开**时结构 CFI 可能失效 → 由 text_context 回退救回；因此存 range-CFI 主锚 + text_context 兜底（= D-79 正确）。**(text_context)** 建议 `text_pre` / `text_post` **各 16 个字符**（CJK 高熵，32 字窗在全书内碰撞概率可忽略），搜索前把简繁归一到简体规范形再比对。

**Primary recommendation:** 抽一个共享 `anchor-resolver.ts`（CFI→文本→fraction 三级静默降级），阅读位置与批注**共用**；滚动高亮走 CSS Custom Highlight API + 现有 `injectStyles`/onLoad section-doc seam；分页高亮走 foliate `load`/`draw-annotation`/`show-annotation` 事件（闭合 shadow 唯一可达路径）；schema V7 的 `annotation` 表镜像 `locator` 的复合列 + 加 sync/tombstone 字段；复用 schema v1 的 `change_log`（P5 是其**首个写入者**）。

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| 选区→CFI（分页） | WebView / foliate `view.getCFI` | — | CFI 由 foliate 对转换后 DOM 计算，唯一权威 |
| 选区→CFI（滚动） | WebView / `scroll-cfi.ts` | — | 滚动流自管 iframe，foliate paginator 不参与 |
| 高亮绘制（分页） | WebView / foliate `Overlayer`（SVG，闭合 shadow 内） | — | DOM shim 够不到闭合 shadow，只能走 foliate 事件 |
| 高亮绘制（滚动） | WebView / CSS Custom Highlight API（每 iframe registry） | foliate `Overlayer` per-iframe（旧机 fallback） | live Range 自动随 reflow 重绘，无覆盖层 |
| 自愈锚定（CFI→文本→fraction） | WebView / 共享 `anchor-resolver.ts` | — | 纯前端 DOM/文本搜索；阅读位置与批注共用 |
| 批注/书签持久化 | tauri-plugin-sql（`annotation` 表 V7） | — | 小结构走 SQL，书字节永不过 IPC（D-06） |
| change_log 追加 + clock/device_id | Rust core（device_id/clock 生成）+ SQL（append） | JS 触发 | 单调 clock 必须原子；P7 对账账本 |
| content_hash（blake3） | Rust core（`invoke`，复用现有 blake3） | — | 与 `work.content_hash` 一致，免新增 JS 依赖 |
| 选区气泡 UI | React（绝对定位小元素） | — | 禁止全屏 pointer-events 层（触控 gate） |

## Standard Stack

本阶段**不安装任何新包**。全部使用已在仓库内的能力：

### Core（均已就位）
| Capability | Source | Purpose | Why |
|---------|--------|---------|-----|
| foliate `view.addAnnotation` / `getCFI` / `draw-annotation` / `create-overlayer` / `show-annotation` / `Overlayer` | `src/vendor/foliate-js/view.js` + `overlayer.js`（vendored, MIT）[VERIFIED: 源码就地核对] | 分页选区→CFI + 高亮/下划线绘制 + 点击已有标注 | 闭合 shadow root 内唯一可达路径 |
| `CSS.highlights` + `Highlight` + `::highlight()` | WebView 内建（Chromium ≥105 / Android System WebView ≥105）[CITED: developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API] | 滚动模式高亮/下划线，live Range 自动随 reflow 重绘 | 无 DOM 覆盖层、不碰触控 gate、免 per-reflow redraw |
| `scroll-cfi.ts`（`cfiToRange` / `visibleRangeCfi` / `resolveCfiScrollTop`） | `src/reader/scroll-cfi.ts`（已存在）[VERIFIED] | 滚动模式 range↔CFI + CFI→scrollTop | 已实现，选区与自愈复用 |
| `epubcfi.js`（`CFI.fromRange` / `toRange` / `parse` / `joinIndir`） | vendored（MIT）[VERIFIED] | CFI 生成/解析/比较 | 绝不手写 locator |
| `Intl.Segmenter`（word granularity） | WebView 内建（已用于 `cjk-content-transform.ts`）[VERIFIED] | 文本搜索窗口的词边界 | 免字典依赖 |
| blake3 | Rust core（已用于 `work.content_hash`）[VERIFIED: migrations.rs] | annotation `content_hash` | 与现有身份哈希一致，免新增 JS crypto 依赖 |
| `crypto.randomUUID()` | WebView 内建 | annotation_id / change_log id | 免 uuid 依赖 |
| `opencc-js@1.4.1`（`cjk-convert-shim.ts` 的 `convertText`） | 已安装 [VERIFIED: package.json] | 文本搜索前简繁归一 | 复用，勿新增 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| CSS Custom Highlight API（滚动） | 每 section 一个 foliate `Overlayer` + `redraw()` | Overlayer 是 SVG 覆盖层，需在每个 reflow 钩子（`injectStyles`/ResizeObserver/`remeasure`/`fonts.ready`）手动 `redraw()`，与滚动流已有的 reflow churn 叠加；仅作**旧机 fallback**（WebView < 105） |
| Rust blake3（`invoke`） | WebCrypto SHA-256 | SHA-256 无需 IPC，但与 `work.content_hash`（blake3）不一致；若 planner 想省一次 invoke 可选，但需在 payload 注明算法 |

**Installation:** 无。

## Package Legitimacy Audit

> 本阶段**不安装任何外部包**——全部为 vendored（foliate-js）、已安装（opencc-js@1.4.1、vitest@3.2.4、playwright@1.52.0）或 WebView/Rust 内建能力。

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Priority Research Item A — 滚动模式高亮绘制技术选型

**结论：滚动模式用 CSS Custom Highlight API；分页保持 foliate 原生 overlayer 不变（不改）。旧机 fallback 用 per-iframe foliate `Overlayer`。**

### 依据
- **可用性：** CSS Custom Highlight API（`Highlight`、`HighlightRegistry`/`CSS.highlights`、`::highlight()` 伪元素）自 **Chromium 105（2022-08）** 起发布；项目目标 **Android System WebView 134**（见 CLAUDE.md）远高于该基线 [CITED: MDN CSS Custom Highlight API]。
- **抗 reflow：** `Highlight` 持有 live `Range` 对象，浏览器在**布局时**重绘高亮，DOM 结构不变、内容不「抖动」[CITED: MDN ::highlight()]。这是关键优势——滚动流本就有剧烈的 reflow churn（`JUMP_SETTLE_MS` 重钉、图片/字体迟到加载 `remeasure`、window capping `capWindow` 驱逐 section）。用 SVG `Overlayer` 需在这些点全部 `redraw()`；CSS Highlight **零手动重绘**。
- **不碰触控 gate：** 不新增任何元素、无 `pointer-events` 层 → 与 D-74「禁止盖全屏 pointer-events:auto」天然相容。
- **可样式化属性（受限但够用）：** `::highlight()` 支持 `color`、`background-color`、`text-decoration`、`outline`、`text-shadow`、`font-weight`；**不支持** `border` / `margin` / `display` 等布局属性 [CITED: MDN]。因此：
  - **高亮** = `::highlight(name){ background-color: <半透明色> }`（用 rgba，日/夜/Sepia 三主题下文字仍可读，等价 `--overlayer-highlight-opacity:.3`）。
  - **下划线（独立类型 D-71）** = `::highlight(name){ text-decoration: underline; text-decoration-color: <色> }`（**用 text-decoration，不是 border**）。
- **多色（4 色 D-70）+ 类型（highlight/underline D-71）：** 每个 (type,color) 组合一个具名 registry 条目 + 一条 `::highlight()` 规则。例：`pillow-hl-cinnabar` / `pillow-ul-cinnabar` …。日/夜/Sepia 换色靠注入 CSS 里的变量，不动 registry。

### 关键约束：per-document registry
`CSS.highlights` 是**每个 window 独立**的注册表。滚动模式一 section 一 iframe（各自 document）→ 必须在**每个 iframe 的 `contentWindow.CSS.highlights`** 注册 `Highlight`，并把 `::highlight()` 规则注入**每个 iframe** 的 `pillow-reading-css`（复用现有 `injectStyles` seam）。Range 必须用**该 iframe 的 document** 构造（`doc.createRange()` 或 `cfiToRange(doc, cfi)`）。

### section (re)load 重绘（关键坑）
`capWindow` 会驱逐视口外 section（`MAX_LOADED`），其 iframe/document 被销毁 → 该 iframe 的 highlight registry 一并消失。重新进入该 section 时 `onLoad` 会重建 iframe → **必须在 onLoad section-doc seam 里为该 section 重新注册该章的批注 Range + Highlight**（与 `injectStyles` 同点，懒加载、只画本 section 命中的批注，不要在开书时对全书批注一次性绘制——见 Perf 坑）。

### Fallback（WebView < 105 / 旧 AOSP / de-Googled 机）
特性探测：`typeof iframe.contentWindow.Highlight === 'function' && iframe.contentWindow.CSS?.highlights`。否则 fallback 到 per-iframe foliate `Overlayer`（`new Overlayer()`，`overlayer.add(key, range, Overlayer.highlight, {color})`）+ 在现有 reflow 钩子 `redraw()`。这与 `cjk-autospace-shim` 面对的旧机群体相同（CLAUDE.md text-autospace 风险 1）。

## Priority Research Item E — range-CFI 在 词不拆行 下是否存活

**结论：D-79 正确。同一 transform 状态内 range-CFI 稳定；跨状态 toggle 时结构 CFI 可能失效 → text_context 回退救回。计算 CFI 无需特殊时序。**

### 时序核对（已就地验证）
`cjk-content-transform.transformSectionHtml` 在 `book.transformTarget` 的 `'data'` 事件里执行——**先于 foliate 解析/渲染**（`FoliateView.tsx` L1327-1343 就地核对）。因此 foliate 解析的是**已转换的 DOM**，`view.getCFI(index, range)`（view.js L431-435）与滚动的 `cfiToRange` 都对**转换后 DOM** 计算/解析。**选区在渲染后才存在，此时 DOM 已是转换态** → 建立 CFI 时天然与所见一致，**无需在 transform 前/后择时**。

### 两类稳定性
- **简繁（OpenCC）：** 逐字转换，绝大多数 1:1（`里→裡/裏`、`面→麵` 等偶有 1:多，非严格长度守恒）。同状态内 CFI 稳；**跨状态**（用户切简繁 → `reopenTick` 全量重开，`FoliateView.tsx` L502-511）字符偏移可能移位 → 字符级 CFI 可能落到相邻字。→ text_context 救回。
- **词不拆行：** 把 CJK 词包进 `<span style="white-space:nowrap">`（`cjk-content-transform.ts` L99-111）——**插入元素、改变元素路径**。`parent>#text` 变 `parent>span>#text`（多 span + 交错文本节点）。CFI 编码元素子索引 + 文本偏移 → wordKeep=on 与 off 的**同一位置 CFI 元素路径不同**。**跨状态 → 结构 CFI 必失效**；同状态内有效（foliate 解析的就是包好的 DOM）。

### 建议
1. **存 range-CFI 主锚**（同状态 = 常态，直接命中）。
2. **text_context 兜底**（跨状态 toggle 时救回）——这正是自愈链，与阅读位置共用（D-77）。
3. **text_context 必须取自转换后文本**（`range.toString()` 读的就是转换后文本节点；词不拆行不增删字符，简繁改字形）。
4. **搜索前把简繁归一到简体规范形**再比对（用 `convertText(x, 't2s')`），使文本搜索**跨简繁状态不变**；空白已由 `.replace(/\s+/g,' ')` 折叠。词不拆行不改字符，故对文本搜索透明。
5. 恢复流程：`reopenTick` 重开后位置从 saved locator 恢复（现有路径），批注从 store 逐条经**共享 resolver** 重新锚定；命中 text_context 时**回写刷新 CFI**（self-heal write-back）。

## Priority Research Item text_context — 窗口长度与搜索算法

**结论：`text_pre` / `text_post` 各 16 字符（CJK）；`text_exact` 沿用现有 `TEXT_EXACT_MAX = 120` 上限。搜索前归一到简体。**

### 长度依据
- CJK 字符信息熵高（常用汉字有效数千，考虑相邻相关性经验值约 5–6 bit/字）。一个 **32 字窗**（pre16 + post16）≈ 160–190 bit ≫ 全书定位所需（~10^6 字书 ≈ 20 bit）→ 章内乃至全书碰撞概率可忽略。
- **阅读位置锚**是零长点，`text_exact` 常为空 → 靠 pre+post 32 字窗唯一定位，16/16 有充足余量。
- **批注锚**的 `text_exact` 即选区文本（常 > 32 字，本身高度唯一）；pre/post 各 16 只用于**消歧重复短语**（章标题、反复出现的人名），16 足够断连。
- **存储/哈希成本：** 32 字 ≈ 96 bytes UTF-8，blake3 成本可忽略。不建议再放大（>24 字/侧收益递减、只增体积）。

### 搜索算法（fallback，供共享 resolver 用）
1. 归一：把 `text_exact`/`text_pre`/`text_post` 与待搜 haystack（本 section 或全书 `textContent`）都 `convertText(_, 't2s')` 归到简体 + 折叠空白。
2. 在**目标 section** 先精确匹配 `text_exact`；命中唯一 → 取其 Range。
3. 多命中 → 用 `text_pre` 前缀 + `text_post` 后缀对每个候选消歧。
4. section 内无命中 → 扩到**全书**（按 spine 顺序，命中最近的）。
5. 仍无 → 退化窗口：`text_pre.slice(-8) + text_exact.slice(0,8)` 做部分匹配。
6. 命中文本偏移 → 用 `TreeWalker`（SHOW_TEXT）累加偏移映射回 DOM Range → 该 Range 成为新锚 → 重算 CFI 并**回写**（self-heal）。
7. 仍无 → `progress_fraction` → **最近段落边界**（section + offset），**绝不 `scrollTo(%)` 裸跳**（D-78）。

## foliate-js 批注 API（就地核对，非假设）

来源 `src/vendor/foliate-js/view.js` + `overlayer.js`（vendored, MIT）[VERIFIED]：

- **`view.getCFI(index, range)`**（view.js:431）：`baseCFI = book.sections[index].cfi ?? CFI.fake.fromIndex(index)`；无 range 返回 baseCFI，有则 `CFI.joinIndir(baseCFI, CFI.fromRange(range))`。→ **分页选区→range-CFI 的权威入口。**
- **`view.addAnnotation(annotation, remove?)`**（view.js:368）：`annotation.value` 是 CFI 字符串；内部 `resolveNavigation(value)` → `{index, anchor}`，取该 index 的 overlayer，`overlayer.remove(value)` 后（非删除时）`emit('draw-annotation', {draw, annotation, doc, range})`。返回 `{index, label}`。→ **开书重放/mode-switch 重放逐条调用。**
- **`view.deleteAnnotation(a)`**（view.js:399）= `addAnnotation(a, true)`。
- **`draw-annotation` 事件**：detail `{draw, annotation, doc, range}`；我们的监听器调 `draw(Overlayer.highlight, {color})` 或 `draw(Overlayer.underline, {color})`。`draw` 内部 = `overlayer.add(value, range, func, opts)`。
- **`create-overlayer` 事件**（view.js:264, 406）：**仅分页/FXL renderer** 触发；`e.detail.attach(overlayer)`；每 section 创建一个 `Overlayer`，并给该 doc 挂 `click` → `hitTest` → `emit('show-annotation', {value,index,range})`。→ **点击已有标注重开气泡（D-73）的信号。**
- **`show-annotation` 事件**：detail `{value, index, range}`。→ 编辑/删除气泡入口。
- **`load` 事件**（view.js:348, `#onLoad` emit `{doc, index}`）：**即使分页 iframe 在闭合 shadow root，此事件仍交出该 section 的 `doc` 引用** → 分页模式**选区监听（`selectionchange`/`pointerup`）挂这里**，是闭合 shadow 下唯一可达 doc 的官方 seam。
- **`Overlayer` 静态方法**（overlayer.js）：`highlight`（半透明 SVG rect，`--overlayer-highlight-opacity/-blend-mode` 变量）、`underline`（SVG rect 底边）、`strikethrough`、`squiggly`、`outline`、`copyImage`；实例 `add(key,range,draw,opts)` / `remove(key)` / `redraw()`（reflow 时重取 `getClientRects`）/ `hitTest({x,y})`。

**闭合 shadow root 约束**（memory `pillowtome-paginate-closed-shadow-transform`）：DOM shim/`querySelector` 够不到分页 iframe。分页的**选区、绘制、点击命中全部走 foliate 事件**（`load`/`draw-annotation`/`create-overlayer`/`show-annotation`）+ `view.addAnnotation`/`getCFI`。滚动模式走自己的 section-doc seam（`ContinuousScrollStream` onLoad）。

## Data Model — schema V7（append-only migration）

`migrations.rs` 现为 V1..V6（就地核对）。V7 追加 `annotation` 表 + `sync_meta`（device_id/clock）。**复用 v1 的 `change_log`，不加列。**

```sql
-- V7
CREATE TABLE annotation (
  annotation_id     TEXT    PRIMARY KEY,      -- crypto.randomUUID()
  work_id           TEXT    NOT NULL REFERENCES work(work_id),
  type              TEXT    NOT NULL,         -- highlight | underline | note | bookmark
  cfi               TEXT    NOT NULL,         -- range-CFI（bookmark 为 point-CFI）
  color             TEXT,                     -- 朱砂 palette key；bookmark 为 NULL
  -- 复合自愈 locator：镜像 `locator` 表，供共享 resolver（D-77）
  text_pre          TEXT,
  text_exact        TEXT,                     -- 选区快照 / 锚点文本（≤120，沿用上限）
  text_post         TEXT,
  progress_fraction REAL,                     -- 0..1，最后兜底（绝不裸跳）
  note              TEXT,                     -- 用户笔记（type=note）
  -- sync-ready（D-81 / D-80）
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  revision          INTEGER NOT NULL DEFAULT 1,
  content_hash      TEXT,                     -- blake3（Rust core，与 work 一致）
  deleted           INTEGER NOT NULL DEFAULT 0  -- tombstone（D-80，不物理抹除）
);
CREATE INDEX idx_annotation_work ON annotation(work_id, deleted);

-- device 身份 + 单调逻辑时钟（change_log 首个写入者需要）
CREATE TABLE sync_meta (
  id            TEXT    PRIMARY KEY,      -- 'device'
  device_id     TEXT    NOT NULL,         -- crypto.randomUUID()，首次启动生成
  logical_clock INTEGER NOT NULL DEFAULT 0
);
```

**`change_log` 复用（不改）**：v1 已有 `id / device_id / logical_clock / entity / op / payload(JSON) / created_at`。批注每次 create/update/delete **追加一行**：`entity='annotation'`、`op='upsert'|'delete'`、`payload=JSON({annotation_id, type, cfi, color, text_*, note, deleted, content_hash})`、`device_id`+**原子自增的** `logical_clock`。

**content_hash：** blake3 over 规范序列化 `{type, cfi, color, text_exact, note, deleted}`（**不含** `updated_at`/`revision` 等元数据），经 Rust core `invoke`（复用现有 blake3，免新增 JS 依赖）。

**P5 是 `change_log` 首个写入者**（grep 确认无 TS 写入者，仅 migrations.rs/tests）：必须建立 device_id（首启生成、存 `sync_meta`）+ 单调 clock（**与 annotation 写入同一 SQL 事务内自增**，否则并发/崩溃会破坏 P7 合并顺序）。

## Selection → Bubble 交互（双平台一套，D-74/75/76）

- **选区检测：**
  - 分页：`view.addEventListener('load', e => attachSelection(e.detail.doc, e.detail.index))` → 在该 doc 上 `selectionchange`/`pointerup`/`mouseup`（闭合 shadow 下唯一可达 doc 的路径）。
  - 滚动：`ContinuousScrollStream` 的 iframe `onLoad` 已挂 `pointerdown`/`pointerup`/`click`（L865-919）——**在同一块**加 `selectionchange`/`pointerup` settle → 抽共享「per-section-doc hook」（与 link-click / autospace shim / cjk-content-transform 同 seam，D-74）。
- **选区→CFI：** 分页 `view.getCFI(index, doc.getSelection().getRangeAt(0))`；滚动用 `scroll-cfi`（`CFI.fromRange` → `CFI.joinIndir(baseCfi, ...)`，见 `visibleRangeCfi` 同源工具）。
- **气泡定位（iframe→页面坐标）：**
  - 滚动：`range.getClientRects()[0]` + `iframe.getBoundingClientRect().top`（与 `tryApplyJump` 里 `el2.getBoundingClientRect().top - doc.documentElement.getBoundingClientRect().top` 同法）。
  - 分页：`range.getClientRects()` 相对渲染 iframe 视口，加 `foliate-view` host 元素的 bounding rect 平移（paginator 让 iframe 铺满 host，故 host-relative ≈ iframe-relative）。**闭合 shadow 下坐标映射是本阶段最需设备端核对的点** → Android 模拟器验收硬门。
- **触控 gate（D-74/CLAUDE.md）：** 气泡是 React **绝对定位小元素**，`pointer-events:auto` 仅在气泡本身；**绝不**盖全屏捕获层。点空白/滚动/翻页/切模式即消失（复用滚动流已有的 `userGestureAtRef`/scroll 监听 dismiss）。

## Self-Healing Resolver 契约（D-77/D-78，阅读位置 + 批注共用）

抽 `src/reader/anchor-resolver.ts`，`locator-store` 恢复与 `annotation-store` 恢复共同调用：

```
resolveAnchor(doc, { cfi, text_pre, text_exact, text_post, progress_fraction }):
  1. isRealCfi(cfi) → range = cfiToRange(doc, cfi)
       range 且有非空 client rects → return { range }              // CFI 命中（常态）
  2. text_exact || (text_pre && text_post):
       range = textSearchAnchor(doc, normalizeS(...))
       命中 → 回写刷新 cfi（self-heal） → return { range, healed:true }
  3. progress_fraction != null → return { fractionTarget }          // 最近段落，绝不裸跳
  4. else → return null                                             // 软失败，落章首
```

- 逐级**静默降级**，正常无感、不弹「找不到」。
- `locator-store` 今日 `text_pre/text_post` 填 `null`（L167-169 就地核对，`// P2: pre/post empty`）→ **P5 填充**（从 relocate range 取 pre/exact/post）；resolver 是**新增共享代码**，两处调用。
- 滚动/分页各自提供 `cfiToRange`（滚动 = `scroll-cfi.cfiToRange`；分页经 foliate `resolveCFI`/`addAnnotation`）。

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CFI 生成/解析/比较 | 自写 locator 编解码 | vendored `epubcfi.js`（`CFI.fromRange`/`toRange`/`joinIndir`） | foliate 已实现字符级 CFI；自写必在 CJK/嵌套/range 上出错 |
| 滚动高亮渲染 | 手写 SVG 覆盖层 + reflow 重绘循环 | CSS Custom Highlight API（live Range 自动重绘） | 免 per-reflow redraw、零 DOM 覆盖、不碰触控 gate |
| 分页高亮渲染 | 试图 querySelector 闭合 shadow iframe | foliate `draw-annotation` + `Overlayer` | 闭合 shadow root 够不到；事件是唯一路径 |
| 选区→Range | 手算文本偏移 | `doc.getSelection().getRangeAt(0)` + `view.getCFI` | 浏览器原生、跨节点安全 |
| 词边界（文本窗口/消歧） | 自建分词 | `Intl.Segmenter`（已用） | 免字典；CJK 词边界内建 |
| 内容哈希 | 新增 JS blake3/crypto 依赖 | Rust core blake3（`invoke`） | 供应链零信任；与 `work.content_hash` 一致 |
| UUID | 新增 `uuid` 依赖 | `crypto.randomUUID()` | WebView 内建 |
| 逻辑时钟 | 向量时钟/CRDT 库 | `sync_meta` 单调整数（事务内自增） | 向量时钟是 P7 对账的事，P5 只需追加账本 |
| 简繁归一（搜索比对） | 自写映射表 | `convertText`（opencc-js，已装） | 复用，勿重造 |

**Key insight:** 本阶段几乎全是**在既有 seam 上接线**——最短、最稳的路径是复用 `scroll-cfi.ts`/`position-bus.ts`/`change_log`/foliate 事件/CSS 原生高亮，任何「另造一套」都会与已存在的 reflow/jump/window-capping 机制打架。

## Common Pitfalls（本代码库特有）

### Pitfall 1: 闭合 shadow root 够不到分页 iframe
**What goes wrong:** 试图 `view.shadowRoot.querySelector('iframe')` 挂选区/绘制监听 → 拿不到（`attachShadow({mode:'closed'})`）。
**How to avoid:** 分页一律走 foliate 事件（`load` 交出 doc、`draw-annotation`/`create-overlayer`/`show-annotation`）+ `view.addAnnotation`/`getCFI`。滚动走 `ContinuousScrollStream` onLoad seam。
**Warning signs:** `shadowRoot` 为 null；选区监听从不触发。

### Pitfall 2: transform 跨状态使结构 CFI 失效
**What goes wrong:** 用户切 简繁/词不拆行（`reopenTick` 全量重开）后，旧批注 CFI 落错字/落空。
**How to avoid:** range-CFI 主锚 + text_context 兜底；text_context 取自转换后文本、搜索前归一到简体；命中回写刷新 CFI。
**Warning signs:** toggle 后高亮偏移一两字或消失。

### Pitfall 3: window capping 驱逐 section → 批注丢失
**What goes wrong:** `capWindow`(MAX_LOADED) 销毁视口外 iframe，其 CSS Highlight registry 随 document 消失；重入不重绘。
**How to avoid:** 在 onLoad section-doc seam 里，为(重)载入的 section **重新注册本章批注**（懒加载、只画命中本 section 的）。
**Warning signs:** 滚回已高亮的章，高亮不见。

### Pitfall 4: reflow 重钉 churn 下的漂移
**What goes wrong:** 用 fallback `Overlayer` 时，图片/字体迟到、`remeasure`、`JUMP_SETTLE_MS` 重钉后高亮位置漂。
**How to avoid:** 主路径 CSS Highlight（live Range 自动重绘，无此问题）；fallback 路径须在 `injectStyles`/ResizeObserver/`remeasure`/`fonts.ready` 全部 `redraw()`。
**Warning signs:** 高亮矩形与文字错位。

### Pitfall 5: change_log clock 非原子/非单调
**What goes wrong:** clock 自增与 annotation 写入不在同一事务 → 崩溃/并发下顺序错乱 → P7 合并错误。
**How to avoid:** device_id 首启生成存 `sync_meta`；每次 op 在**同一 SQL 事务**内 `UPDATE sync_meta SET logical_clock = logical_clock + 1` 并读回。
**Warning signs:** change_log 出现重复或倒序 clock。

### Pitfall 6: Android WebView 版本方差
**What goes wrong:** 旧/AOSP/去 Google 机 WebView < 105 无 CSS Custom Highlight API → 滚动高亮空白。
**How to avoid:** 特性探测 + foliate `Overlayer` fallback（同 text-autospace 旧机群体）。
**Warning signs:** 模拟器高版本正常、低版本真机高亮不显。

### Pitfall 7: fraction 裸跳
**What goes wrong:** CFI+文本都失败时 `scrollTo(fraction*height)` → 落在段落中间/错位，erodes trust。
**How to avoid:** fraction 只定位到**最近段落边界**（section+offset），沿用 P1「never a bare percentage」。

### Pitfall 8: 全屏 pointer-events 层吞滚动/选区
**What goes wrong:** 为放气泡盖一层全屏捕获 → 吞掉 pan/选择手柄（CLAUDE.md 触控 gate 已多次踩坑）。
**How to avoid:** 气泡仅自身 `pointer-events:auto`；dismiss 靠监听 scroller 的 scroll/pointerdown。

### Pitfall 9: 开书时对全书批注一次性绘制
**What goes wrong:** 批注多时开书卡顿；违背 `scroll-window.ts` 有界加载设计（memory `pillowtome-reader-perf-stress-test`）。
**How to avoid:** 只在**可见 section (re)load 时**画本章批注（懒）；分页由 foliate 在翻到该 section 时 `draw-annotation`。**须做多批注压力测试。**

## Code Examples

### 滚动模式：CSS Custom Highlight 注册（per-iframe，注入现有 injectStyles seam）
```typescript
// Source: MDN CSS Custom Highlight API + 本仓 ContinuousScrollStream.injectStyles seam
// win = iframe.contentWindow; doc = iframe.contentDocument
function drawScrollAnnotation(win: Window & typeof globalThis, doc: Document,
                              key: string, range: Range, cssName: string) {
  const HL = (win as any).Highlight;
  if (typeof HL !== "function" || !(win as any).CSS?.highlights) return false; // → Overlayer fallback
  const reg = (win as any).CSS.highlights as Map<string, any>;
  let hl = reg.get(cssName);
  if (!hl) { hl = new HL(); reg.set(cssName, hl); }
  hl.add(range); // live Range → 随 reflow 自动重绘
  return true;
}
// 注入到 pillow-reading-css（每 iframe），色值随 日/夜/Sepia 用变量：
//   ::highlight(pillow-hl-cinnabar){ background-color: var(--hl-cinnabar); }
//   ::highlight(pillow-ul-cinnabar){ text-decoration: underline; text-decoration-color: var(--hl-cinnabar); }
```

### 分页模式：绘制 + 点击已有标注（foliate 事件）
```typescript
// Source: 本仓 src/vendor/foliate-js/view.js:368/406/431（就地核对）
view.addEventListener("draw-annotation", (e) => {
  const { draw, annotation } = (e as CustomEvent).detail;
  const fn = annotation.type === "underline" ? Overlayer.underline : Overlayer.highlight;
  draw(fn, { color: paletteToCss(annotation.color) });
});
view.addEventListener("show-annotation", (e) => {
  const { value } = (e as CustomEvent).detail; // value = CFI
  openBubbleForExisting(value); // D-73 编辑/删除
});
// 建立/重放：
await view.addAnnotation({ value: rangeCfi, type, color }); // value 为 CFI 字符串
// 选区→CFI：
const cfi = view.getCFI(index, doc.getSelection()!.getRangeAt(0));
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SVG/DOM 覆盖层高亮 + 每次 reflow 手动 redraw | CSS Custom Highlight API（live Range，浏览器布局时重绘） | Chromium 105（2022-08） | 滚动模式零手动重绘、零覆盖层 |
| epub.js 词/空格偏移 locator | foliate 字符级 CFI（已 vendored） | 本项目既定 | CJK 进度/锚点正确 |

**Deprecated/outdated:** 无新增。

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Android System WebView 134 为项目实测目标（据 CLAUDE.md），≥ Chromium 105 → CSS Custom Highlight API 可用 | Item A | 若目标机低于 105，滚动主路径需退 Overlayer fallback（已设计，非阻断） |
| A2 | `::highlight()` 支持 `text-decoration`/`background-color`、不支持 `border`（据 MDN，未在本项目 WebView 逐一实测各属性） | Item A | 下划线样式细节可能需在设备端微调；不影响架构 |
| A3 | `text_pre/text_post` 各 16 字对 CJK 全书唯一定位足够（基于信息熵估算，非本书语料实测） | text_context | 极端重复文本（如目录/诗词反复行）可能仍需 pre/post 消歧或回退全书搜索——算法已含该分支 |
| A4 | OpenCC 简繁非严格长度守恒（1:多存在），故跨状态 CFI 可能移位 | Item E | 若某语料恰全 1:1，跨状态 CFI 更稳；不影响「主 CFI + text 兜底」策略 |
| A5 | content_hash 用 Rust blake3（保持与 `work` 一致）；planner 可选 WebCrypto SHA-256 省一次 invoke | Data Model | 算法一旦定需写入 payload；跨端须一致，否则 P7 dedup 失效 |
| A6 | device_id/logical_clock 应在 P5 建立（roadmap「landing the change-log schema, unsynced」+ D-81 要求 P5 写 change_log） | Data Model | 若 planner 判其属 P7，则 P5 change_log 写入缺 device/clock → 与 D-81 冲突，需在 discuss 澄清 |

## Open Questions

1. **分页闭合 shadow 下气泡坐标映射的精确平移量**
   - 已知：`range.getClientRects()` 相对渲染 iframe 视口；host 铺满可近似平移。
   - 不清楚：不同 DPI/竖屏/分栏下 host↔iframe 偏移是否恒定。
   - 建议：设备端（Android 模拟器）实测 + 桌面双栏实测，作为验收硬门；必要时读 `foliate-view` host rect 动态校正。

2. **content_hash 算法归属（blake3 via invoke vs WebCrypto SHA-256）**
   - 建议：默认 Rust blake3（与身份一致、免依赖）；若 planner 权衡 IPC 频次可改 SHA-256，但须在 change_log payload 标注算法版本。

3. **device_id/clock 生成放 P5 还是 P7**
   - 建议：放 P5（本研究据 D-81/roadmap 判定 P5 需写 change_log）。若与 planner 认知不一致，discuss-phase 澄清。

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| CSS Custom Highlight API | 滚动高亮 | ✓（目标 WebView 134 / Chromium ≥105） | Chromium 105+ | foliate `Overlayer` per-iframe（旧机） |
| `Intl.Segmenter` | 文本窗口/消歧 | ✓（已用于 cjk-content-transform） | WebView 内建 | 退化为定长切窗 |
| `crypto.randomUUID` | id 生成 | ✓ | WebView 内建 | — |
| Rust blake3 | content_hash | ✓（已用于 work.content_hash） | 现有 crate | WebCrypto SHA-256 |
| opencc-js | 搜索前简繁归一 | ✓ | 1.4.1 | — |
| vitest | 单元测试 | ✓ | 3.2.4 | — |
| playwright | e2e（可选） | ✓ | 1.52.0 | — |
| Android AVD `Medium_Phone_API_36.1` | 强制设备验收（触控/气泡/高亮） | ✓（CLAUDE.md gate） | — | 物理机 |

**Missing dependencies with no fallback:** 无。
**Missing dependencies with fallback:** CSS Custom Highlight API（旧机退 Overlayer）。

## Validation Architecture

> `workflow.nyquist_validation = true`。测试框架 **vitest@3.2.4**（`pnpm test` = `vitest run`），测试文件 colocated `src/reader/*.test.ts`（已有 `scroll-cfi.test.ts`/`locator-store.test.ts`/`position-bus.test.ts` 等）。

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.4 |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test src/reader/anchor-resolver.test.ts` |
| Full suite command | `pnpm test`（+ `tsc` + `pnpm build` 绿） |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ANNO-01 | 选区→range-CFI（滚动）往返 | unit | `pnpm test src/reader/scroll-cfi.test.ts`（扩选区用例） | ✅ 扩展 |
| ANNO-01/02 | annotation-store upsert/load/tombstone + change_log 追加 | unit | `pnpm test src/reader/annotation-store.test.ts` | ❌ Wave 0 |
| ANNO-04 | resolver 回退链 CFI→文本→fraction 逐级降级 | unit | `pnpm test src/reader/anchor-resolver.test.ts` | ❌ Wave 0 |
| ANNO-04 | text_context 搜索：多命中消歧、简繁归一、词不拆行透明 | unit | `pnpm test src/reader/anchor-resolver.test.ts` | ❌ Wave 0 |
| ANNO-04 | 跨状态（简繁/词不拆行 toggle）text_context 救回 | unit | 同上（构造 transform 前后 DOM 字符串） | ❌ Wave 0 |
| ANNO-01..04 | content_hash 稳定性（同内容同 hash、改内容变 hash） | unit | `pnpm test src/reader/annotation-hash.test.ts`（或 Rust `migration.rs` 同级） | ❌ Wave 0 |
| ANNO-01/03 | 重开/resize/字号/mode-switch 重锚 + 书签 toggle | integration | Playwright（桌面）+ **Android AVD 人工/截图** | 手动 gate |
| ANNO-01/02/03 | 选区气泡出现/定位/dismiss、点已有重开、笔记编辑 | manual | **Android AVD `pnpm tauri android dev`**（分页 + 滚动、reopen + mode-switch） | 手动 gate |
| Perf | 多批注（如 200+）开书/滚动不卡 | manual/stress | 设备端压力测试（memory `pillowtome-reader-perf-stress-test`） | 手动 gate |

### Sampling Rate
- **Per task commit:** `pnpm test <touched>.test.ts` + `tsc`
- **Per wave merge:** `pnpm test`（全套）+ `pnpm build`
- **Phase gate:** 全套绿 + `tsc`/`build` 绿 + **Android AVD 人工验收**（分页 & 滚动、reopen & mode-switch、气泡/高亮/书签）→ 后 `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/reader/anchor-resolver.ts` + `.test.ts` —— 共享自愈 resolver（ANNO-04 核心）
- [ ] `src/reader/annotation-store.ts` + `.test.ts` —— V7 CRUD + tombstone + change_log 追加
- [ ] `src/reader/annotation-hash`（或 Rust 命令）+ 测试 —— content_hash 稳定性
- [ ] 扩 `src/reader/scroll-cfi.test.ts` —— 选区→CFI 往返用例
- [ ] Rust：`migrations.rs` V7 + `sync_meta`；`tests/migration.rs` 断言 V7 apply

## Security Domain

> `security_enforcement = true`，ASVS L1，`security_block_on = high`。本阶段为本地优先、无网络、无新依赖，攻击面小。

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | 本阶段无账户/认证 |
| V3 Session Management | no | 无会话 |
| V4 Access Control | no | 单机单用户本地库 |
| V5 Input Validation | yes | annotation `note`/`text_*` 为用户/书内文本 → 参数化 `$n` SQL 绑定（沿用 locator-store T-02-sql）；渲染入 DOM 须避免注入 |
| V6 Cryptography | yes（弱） | content_hash 用既有 blake3；**非安全用途**（dedup/merge，非机密），不自造密码学 |
| V7 Errors/Logging | yes | 软失败 简体中文、`console.warn`；勿把书内文本/路径打进可外泄日志 |

### Known Threat Patterns for Tauri+WebView 阅读器
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL 注入（note/text 写入 annotation） | Tampering | 只用 `db.execute($1..$n)` 参数化绑定，绝不字符串拼接（现有 locator-store 已是此模式） |
| 存储型 XSS（笔记/摘录渲染回 React） | Tampering/Elevation | 笔记以文本节点渲染（React 默认转义），绝不 `dangerouslySetInnerHTML`；书内 `text_exact` 同理 |
| 书字节经 IPC 泄漏 | Info Disclosure | 维持 D-06：书字节只经 `pillow://`，批注是小结构走 SQL |
| change_log 逻辑时钟被篡改致 P7 合并错误 | Tampering | clock 单调 + 事务内自增；device_id 本机生成不可被书内容影响 |

## Sources

### Primary (HIGH confidence)
- `src/vendor/foliate-js/view.js` / `overlayer.js` / `epubcfi.js`（vendored, MIT）—— `addAnnotation`/`getCFI`/`draw-annotation`/`create-overlayer`/`show-annotation`/`Overlayer`/`load` 就地核对
- `src/reader/scroll-cfi.ts` / `ContinuousScrollStream.tsx` / `FoliateView.tsx` / `cjk-content-transform.ts` / `locator-store.ts` / `position-bus.ts` —— transform 时序、section-doc seam、reflow/jump/window-capping 机制
- `src-tauri/src/migrations.rs` —— V1..V6 + change_log(v1) schema
- `.planning/phases/05-annotations-composite-locator/05-CONTEXT.md` / `docs/READER-PHASE5-ANNOTATIONS-PLAN.md` —— 决策 + ad-hoc 实现计划
- `package.json` —— vitest 3.2.4 / opencc-js 1.4.1 / playwright 1.52.0

### Secondary (MEDIUM confidence)
- [MDN — CSS Custom Highlight API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API) —— 可用性、live Range、per-document registry
- [MDN — ::highlight() 支持属性](https://developer.mozilla.org/en-US/docs/Web/CSS/::highlight) —— color/background/text-decoration/outline 支持、布局属性不支持
- `.planning/research/PITFALLS.md` —— Pitfall 5（reading-position 稳定性）、annotation drift

### Tertiary (LOW confidence)
- text_context 16 字窗口的信息熵估算（未用本书语料实测；算法已含全书回退分支兜底）

## Metadata

**Confidence breakdown:**
- foliate 批注 API / 现有代码路径：HIGH —— 源码就地核对
- Challenge A（CSS Highlight）：HIGH（可用性/属性）/ MEDIUM（旧机方差、需模拟器验收）
- Challenge E（transform 下 CFI）：HIGH —— transform 时序与 CFI 计算点已核对
- text_context 长度：MEDIUM —— 熵估算 + 回退分支，非语料实测
- 气泡坐标映射（分页闭合 shadow）：MEDIUM —— 需设备端实测
- schema V7 / change_log 复用：HIGH —— 就地核对 migrations + 确认无既有 TS 写入者

**Research date:** 2026-07-17
**Valid until:** 2026-08-16（30 天；foliate vendored + WebView 基线稳定）

## RESEARCH COMPLETE
