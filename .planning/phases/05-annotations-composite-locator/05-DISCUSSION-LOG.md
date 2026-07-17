# Phase 5: Annotations & Composite Locator - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-17
**Phase:** 5-Annotations & Composite Locator
**Areas discussed:** 批注视觉与类型, 选区与触控交互, 复合定位自愈策略, 删除与同步就绪语义

> 前置：用户已手写 `docs/READER-PHASE5-ANNOTATIONS-PLAN.md`（数据模型 / foliate API / 挑战 A–E / 7 步序列），架构大量已定。本次讨论只聚焦该计划留白或标为 research 的**产品/健壮性叉路**，不重炒已定架构。用户指示「逐一讨论」。

---

## 批注视觉与类型

### 高亮配色
| Option | Description | Selected |
|--------|-------------|----------|
| 4 色小板 | 朱砂红为主 + 赭/黛绿/靛蓝 三色低饱和 | ✓ |
| 单色（只朱砂红） | 最简，但无法分类 | |
| 5–6 色 | 更细分类，但易花、纸感下难拉开区分度 | |

**User's choice:** 4 色小板
**Notes:** 具体色值留 UI 环节；对标 Apple Books/Readest 甜蜜区。

### 标注类型（下划线）
| Option | Description | Selected |
|--------|-------------|----------|
| 下划线作为独立类型 | type=highlight \| underline，共用 Overlayer + store | ✓ |
| 只做高亮 | YAGNI，但后补要再动 UI/store | |
| 高亮+下划线，波浪/删除线 later | 与前者实质相同，明写 later 边界 | |

**User's choice:** 下划线作为独立类型

### 气泡动作集
| Option | Description | Selected |
|--------|-------------|----------|
| 颜色·下划线·笔记·复制 | 4 核心动作，查词位预留不展示 | ✓ |
| …+查词(置灰) | 预告 v2 字典，但置灰按钮易被视为未完成品 | |
| 只颜色·笔记·复制 | 下划线降为二级，与「独立类型」矛盾 | |

**User's choice:** 颜色·下划线·笔记·复制（查词预留不展示，v2 CJKX-01）

### 点已有标注
| Option | Description | Selected |
|--------|-------------|----------|
| 重开气泡：改色/加笔记/删除 | 一套气泡承载新建 vs 编辑两语境 | ✓ |
| 有笔记→开笔记面板；无→气泡 | 区分更明确但两条路径、心智负担高 | |
| 你定 | | |

**User's choice:** 重开同一气泡（改色/加笔记/删除）

---

## 选区与触控交互

### 触发方式
| Option | Description | Selected |
|--------|-------------|----------|
| 原生选择手柄，选定后自动弹气泡 | 顺平台习惯；不盖全屏 pointer-events 层（合触控 gate） | ✓ |
| 长按弹自绘菜单 | 要自绘手柄、易与原生冲突、Android 触控坑多 | |
| 你定 | | |

**User's choice:** 原生选择手柄 + 自动气泡
**Notes:** 监听点与链接/autospace shim 同一 section-doc seam。

### 气泡定位/消失
| Option | Description | Selected |
|--------|-------------|----------|
| 贴选区上方、空间不够翻下；点空白/滚动/翻页即消 | 标准阅读器行为，不拦滚动 | ✓ |
| 固定底部 action bar | 不算坐标不遮正文，但手指下移、就地感弱 | |
| 你定 | | |

**User's choice:** 贴选区浮层（带箭头），点空白/滚动/翻页/切模式即消

### 桌面交互
| Option | Description | Selected |
|--------|-------------|----------|
| 同一套气泡（鼠标划选完即弹） | 两端一致、只维护一套；mouseup=pointerup | ✓ |
| 桌面走原生右键菜单 | 更桌面感但两套交互、语义重复 | |
| 你定 | | |

**User's choice:** 同一套气泡（右键作桌面可选加强）

---

## 复合定位自愈策略

### 自愈范围
| Option | Description | Selected |
|--------|-------------|----------|
| 阅读位置 + 批注都自愈（共用一个 resolver） | 一处实现两处调用；契合 ANNO-04 跨设备/抗重排 | ✓ |
| 只阅读位置自愈；批注仅 CFI | 更省，但批注跨设备/内容变更会掉锚，违背承诺 | |
| 你定 | | |

**User's choice:** 两者共用 resolver

### 回退链
| Option | Description | Selected |
|--------|-------------|----------|
| CFI → 文本搜索 → 进度分数，逐级静默降级 | 正常无感；fraction 只兜底不裸跳 | ✓ |
| 回退到 fraction 时给轻提示 | 更诚实但多一块 UI、可能打断沉浸 | |
| 你定 | | |

**User's choice:** CFI → text_context → progress_fraction 静默降级（沿用 never-a-bare-percentage）

### transform 稳定性（挑战 E）
| Option | Description | Selected |
|--------|-------------|----------|
| range-CFI 主锚 + text_context 兜底（统一走自愈） | 简繁长度守恒 CFI 稳；词不拆行 span-wrap 靠文本回退 | ✓ |
| 锚定到未转换原内容坐标 | 更纯，但要维护双向坐标映射、复杂度高，与 foliate 逆着来 | |
| 你定 | | |

**User's choice:** range-CFI 主 + text 兜底；「CFI 在词不拆行下存活性」= research 验证项

---

## 删除与同步就绪语义

### 删除语义
| Option | Description | Selected |
|--------|-------------|----------|
| 软删 tombstone（现在就落） | 删除是可合并操作，防跨端复活；P7 才能对账 | ✓ |
| 硬删，P7 再补 tombstone 层 | 省事但 P7 变打补丁、已删批注会被推回 | |
| 你定 | | |

**User's choice:** 软删 tombstone（现在就落）

### change_log 粒度
| Option | Description | Selected |
|--------|-------------|----------|
| 每次 create/update/delete 追一行 op（追加式账本） | op/uuid/device/clock/content_hash；本阶段交付物 | ✓ |
| 只在 annotation 行带 revision，change_log 留 P7 | 更轻但丢变更历史，与「落 change-log schema」目标不符 | |
| 你定 | | |

**User's choice:** 追加式 change_log 账本 + annotation 行带 revision/updated_at/content_hash

### 书签模型
| Option | Description | Selected |
|--------|-------------|----------|
| 同一 annotation 表 + 同一 sync 路径 | type=bookmark（point-CFI），一套 store/一条 sync 路径 | ✓ |
| 书签单独一张表 | 语义更纯但多一套表/store/sync，与最少代码相背 | |
| 你定 | | |

**User's choice:** 同一表同一路径（type=bookmark），顶栏 toggle 当前位置，列表并入批注 sheet

---

## Claude's Discretion

- scroll 模式高亮绘制技术选型（挑战 A：CSS Custom Highlight API vs 每 section foliate Overlayer）= **research 先定**，分页保持原生 overlayer
- text_context 窗口长度（pre/post 字符数）
- annotation 表列/索引（schema V7，append-only）；tombstone 保留/清理策略
- 笔记编辑 sheet / 批注管理 sheet 交互细节（沿用 ad-hoc plan）
- 具体朱砂 4 色色值

## Deferred Ideas

- 查词/字典（v2 CJKX-01）——气泡预留位置不展示
- 波浪线/删除线标注样式（Overlayer 已支持，按需加）
- 桌面右键上下文菜单（可选加强）
- 批注导出 / 多选批量删除（未纳入 ANNO-01..04）
