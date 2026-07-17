# Phase 3: CJK Typography Differentiation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-16
**Phase:** 3-CJK Typography Differentiation
**Areas discussed:** 功能开关与设置入口, CSS 管线与 JS 降级 shim, 中文默认值（缩进/行高/引号）, 内置字体与回退链

**Session note:** User required all user-facing discuss/UI interaction in 简体中文; recorded as D-30.

---

## Meta: language

| Option | Description | Selected |
|--------|-------------|----------|
| Continue in English | Default workflow language | |
| 用中文交互并写入约束 | User-facing copy in 简体中文 for this phase | ✓ |

**User's choice:** 用中文和我交互，把这项写入约束，重新提问  
**Notes:** Gray-area selection was re-asked in 简体中文; all four areas selected.

---

## 功能开关与设置入口

### 开关入口

| Option | Description | Selected |
|--------|-------------|----------|
| 显示设置里新增「中文排版」分区 | 在 Aa Sheet 加一节 | ✓ |
| 独立「中文排版」面板 | 单独导航入口 | |
| 你来定 | 实现侧决定 | |

**User's choice:** 显示设置里新增「中文排版」分区

### 默认开闭

| Option | Description | Selected |
|--------|-------------|----------|
| 全部默认开启 | 开箱即干净中文 | ✓ |
| 挤压+盘古开，禁则无独立开关 | 禁则作基线 | |
| 全部默认关 | 更保守 | |

**User's choice:** 全部默认开启

### 开关粒度

| Option | Description | Selected |
|--------|-------------|----------|
| 三项独立开关 | 各自可关 | ✓ (with free-text) |
| 一个总开关 | 一键全开全关 | |
| 总开关 + 展开细调 | UI 更重 | |

**User's choice:** 三个开关，后面加一个信息详情，点击可查看这个专业术语是什么意思（正常读者可能不懂术语）  
**Notes:** Info affordance + plain-language explanation is mandatory.

### 偏好范围

| Option | Description | Selected |
|--------|-------------|----------|
| 全局偏好，所有书共用 | 对齐 D-21 | ✓ |
| 按书偏好 | 扩 schema/UI | |
| 全局默认 + 预留按书接口 | 仅代码预留 | |

**User's choice:** 全局偏好，所有书共用

---

## CSS 管线与 JS 降级 shim

### CSS 策略

| Option | Description | Selected |
|--------|-------------|----------|
| 原生 CSS 优先 + feature-detect | 对齐 DEC-002 | ✓ |
| 始终走自有 JS 整形 | 一致但侵入大 | |
| 仅原生 CSS，无 shim | 旧引擎无差异化 | |

**User's choice:** 原生 CSS 优先 + feature-detect

### Shim 范围

| Option | Description | Selected |
|--------|-------------|----------|
| 优先盘古之白，其余尽量 CSS | 控制 DOM 侵入 | ✓ |
| 三项都做完整 JS 回退 | 观感齐、风险高 | |
| 你来定最小可行 shim | 研究矩阵决定 | |

**User's choice:** 优先盘古之白（autospace），其余尽量 CSS

### DOM 侵入

| Option | Description | Selected |
|--------|-------------|----------|
| 尽量不永久改 DOM | 保护选中/CFI | ✓ |
| 允许改写文本节点插空格 | 简单但伤锚点 | |
| 你来定，CFI/选中为硬约束 | 手法不锁 | |

**User's choice:** 尽量不永久改 DOM

### 降级预期

| Option | Description | Selected |
|--------|-------------|----------|
| 满血或静默降级 | 不弹升级墙 | ✓ |
| 设置里显示部分支持提示 | 更透明 | |
| 强制最低 WebView | 挡老设备 | |

**User's choice:** 有能力就满血，没有就静默降级

---

## 中文默认值（缩进/行高/引号）

### 作者样式

| Option | Description | Selected |
|--------|-------------|----------|
| 读者偏好优先，覆盖作者排版 | 与 !important 主题一致 | ✓ |
| 仅作者未指定时补默认 | 更尊重 EPUB | |
| 用户可选尊重原书/枕籍默认 | 多设置项 | |

**User's choice:** 读者偏好优先，覆盖作者排版

### 首行缩进

| Option | Description | Selected |
|--------|-------------|----------|
| 正文 2em，标题/引用不缩进 | 常见中文排版 | ✓ |
| 所有块级统一 2em | 规则简单 | |
| 可调缩进 | 多 UI | |

**User's choice:** 正文段落默认缩进 2em，标题/引用等不缩进

### 行高默认

| Option | Description | Selected |
|--------|-------------|----------|
| 保持 1.75 | 不改 DEFAULT_PREFS | ✓ |
| 抬到 ~1.8–2.0 | 改默认 | |
| 你来定 | 研究锁值 | |

**User's choice:** 保持 1.75 作为全局默认

### 全角引号

| Option | Description | Selected |
|--------|-------------|----------|
| 排版级：禁则/挤压，不改字符 | 保护搜索/CFI | ✓ |
| 显示时映射西文引号为中文引号 | 改文本风险高 | |
| 你来定，不破坏搜索/CFI | 手法不锁 | |

**User's choice:** 排版级：引号参与禁则/挤压，不强行改作者字符

---

## 内置字体与回退链

### 字体家族

| Option | Description | Selected |
|--------|-------------|----------|
| Noto Sans/Serif CJK 系 | 覆盖广 | ✓ |
| Source Han（思源）系 | 同源谱系 | |
| 你来定 OFL+体积 | 品牌不锁 | |

**User's choice:** Noto Sans/Serif CJK 系

### 简繁覆盖

| Option | Description | Selected |
|--------|-------------|----------|
| 先简体为主，繁体靠回退 | 控体积 | |
| 简繁都内置完整覆盖 | 包体更大 | ✓ |
| 按书语言选子集 | 实现复杂 | |

**User's choice:** 简繁都内置完整覆盖

### 体积策略

| Option | Description | Selected |
|--------|-------------|----------|
| 子集/分区打包控增量 | 体积优先 | |
| 可变字体/OTC 完整家庭，体积次要 | 质量优先 | ✓ |
| 完整覆盖但可选组件/按需装 | 近云端下载，需澄清 | |

**User's choice:** 可变字体/OTC 完整家庭，体积次要  
**Notes:** Still no cloud font download — ship in app assets.

### 回退策略

| Option | Description | Selected |
|--------|-------------|----------|
| 显式 fallback 链 + 覆盖自检表 | 可验收 | ✓ |
| 仅 CSS font-family 栈 | 轻但难验 | |
| 你来定，成功标准第 5 条硬验收 | 细节不锁 | |

**User's choice:** 显式 fallback 链 + 覆盖自检表（黄金图）

---

## Claude's Discretion

- Noto Sans vs Serif exact pin after license/size research
- Exact CSS selectors, migration column names, golden-image CI shape
- Info-panel microcopy wording (must be plain 简体中文)
- Feature-detect cache policy; kinsoku table source details

## Deferred Ideas

- Per-book typography overrides
- Vertical text, ruby, dictionary
- Cloud/first-run font download
- READER-POS (Phase 4/5)
- Bundled Chromium escape hatch (only if system WebView fails P3)
- Master “优化中文排版” single switch (rejected in favor of three toggles)
