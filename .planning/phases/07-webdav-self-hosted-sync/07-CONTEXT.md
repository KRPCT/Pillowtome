# Phase 7: WebDAV Self-Hosted Sync - Context

**Gathered:** 2026-07-18
**Status:** Ready for planning

<domain>
## Phase Boundary

把「在任意一端打开书都能继续」落地——进度、批注、可选的书籍文件经用户**自托管 WebDAV** 在多设备间同步，合并**永不静默丢数据**。这是第二 moat、核心价值的兑现点。架构研究已定为「对账」而非「重写」：change_log 脊柱（V1）与 annotation/sync_meta（V7）已就位，本阶段是接通传输与合并。

**In scope（SYNC-01..05 + roadmap success criteria）：**
- WebDAV 服务器配置/连接：地址+用户名+应用密码，凭据入 OS keychain，保存前强制测试
- 状态平面：阅读进度 + 批注（高亮/笔记/书签）+ 全书目目录，经逐设备 append-only change log 对账
- 文件平面：按书开启的选择性文件同步，阈值分块 + 断点续传，对端占位卡 + 点击下载
- 冲突合并：进度取最远、批注按 UUID 合并 + tombstone 去重（SYNC-05 已定规则）
- 同步触发：开书拉 + 合书推 + 手动按钮；同步状态可见性（状态点 + 设置页详情）

**Explicitly NOT in this phase：**
- Android 后台定时同步（WorkManager/前台服务）——已明确否决
- 阅读设置（字体/主题/CJK 开关）同步——v1 各端独立
- KOReader kosync 协议互通（v2 SYNC-06）、OPDS/Calibre（v2 LIB-05）
- 实时推送/WebSocket 式同步（WebDAV 是哑存储，无此能力）
- 端到端加密（凭据入 keychain + TLS 已够 v1 基线；E2EE 是另一个 phase 的事）

</domain>

<decisions>
## Implementation Decisions

### 承接锁定（不重新决定）
- **传输栈 = `reqwest_dav` 跑在 Rust core**（STACK.md 锁定）：双端共享一份实现；不做 JS 侧 WebDAV。
- **双平面架构**（ARCHITECTURE.md Pattern 3）：文件平面与状态平面独立通道——进度每会话都走，300MB 书文件只在用户开启时走一次。
- **合并规则已定（SYNC-05）**：进度取最远；批注按 UUID 集合并 + tombstone 去重；真正的冲突用明确的非破坏策略。**禁止整文件 LWW blob 同步**（PITFALLS #7）。
- **change_log 脊柱已在 schema V1**：UUID + device_id + 逐设备单调 logical_clock + payload；annotation（V7）带 revision/updated_at/content_hash/deleted tombstone——全部 sync-ready，本阶段是消费而非新建。
- **hash_algo 双算法警告**（annotation-store.ts 头注释）：work.content_hash 是 blake3，annotation content_hash 是 WebCrypto SHA-256——**同步必须按记录读 hash_algo，绝不假设单一算法**。
- **凭据入 OS keychain、永不同步**（SYNC-01 + roadmap）；**产品文案简体中文**（D-30）；**书字节不过 IPC**（D-06——同步引擎在 Rust core 直接读文件，与此兼容）。

### 同步触发时机
- **D-90：开书拉 + 合书推 + 手动按钮兜底（KOReader 式）**——打开书时拉取对账，合上书/退出阅读/切后台时推送本地 change log，书库页放手动「立即同步」。禁止变更即推的实时模型（电量与写入复杂度）。
- **D-91：不做 Android 后台定时同步**——同步只在 app 生命周期内发生（启动/开书/合书/手动）；不引入 WorkManager/前台服务/额外权限。阅读是长会话场景，后台偷跑价值低。
- **D-92：对端进度更远时：静默跳到最远 + 留痕迹 + 可撤回**——开书拉取后按 SYNC-05 静默取最远，不打断；界面留同步痕迹（如进度条旁「已从其他设备同步」提示），**点击该提示弹窗可撤回跳回原位**。
- **D-93：状态可见性 = 状态点 + 设置页详情**——书库同步按钮带状态点（同步中/失败）；设置页显示服务器、上次同步时间、失败原因；失败用 toast，**不弹模态**。

### 服务器矩阵与 TLS
- **D-94：兼容矩阵三类全过**——Nextcloud + 坚果云 Nutstore + 通用 RFC 4918 WebDAV（Apache mod_dav / rclone serve / 群晖）。客户端防御性编码（PROPFIND depth、尾斜杠、百分号编码、MOVE/COPY 差异）；坚果云限流怪癖需处理（PITFALLS #8）。验证矩阵须覆盖「真实代理后的 Nextcloud」而非只测本地裸服务器。
- **D-95：TLS 默认严格 + 显式放行开关**——默认 HTTPS 严格校验证书；设置页两个独立开关「允许 HTTP（明文，仅局域网）」「信任自签名证书」，开启时给简体中文警示文案。禁止全放行。
- **D-96：凭据 = 服务器地址 + 用户名 + 密码/应用密码**——TLS 下走 Basic（Nextcloud/坚果云均推荐应用密码），服务器要求 Digest 时自动协商；设置页引导文案提醒「用应用密码，不要用主密码」。凭据存 keychain（SYNC-01）。
- **D-97：保存前强制测试连接**——保存时执行 PROPFIND 探活 + 认证校验 + 远端目录（如 `pillowtome/`）自动创建；失败给出具体中文错误分类（地址不通 / 认证失败 / 证书问题 / 目录无权限）。不允许错误配置静默保存。

### 书籍文件同步体验（SYNC-04）
- **D-98：默认不同步，按书开启**——每本书在详情/长按菜单里有「同步此书」开关；不做全局「自动上传全部」开关。带宽最小、符合 SYNC-04「非强制全量」。
- **D-99：对端占位卡 + 点击下载**——书单经状态平面同步后，对端书库显示云端书占位卡（封面 + 标题 + 云标记），点一下后台下载完成即可读；进度/批注在文件落地后即生效。
- **D-100：文件平面只传书文件本体**——对端下载后走现有 `import-pipeline` 本地重新解析元数据/封面。单一真相，禁止「书文件+元数据打包」的双真相模型。
- **D-101：阈值分块 + 断点续传**——超过阈值（约 10MB，具体值 planner 定）走分块：Nextcloud 用其 chunked upload v2 协议（Destination 头、整数块名、423 Locked 重试语义），通用服务器退化为大块 PUT 序列；中断可续传。必须抗住代理 100MB 体上限与 504（PITFALLS #8）；不做文件大小上限、不做「整 PUT 失败整体重试」。

### 同步范围与远端布局
- **D-102：全书目同步**——所有书目都上状态平面：开了文件同步的显示可下载占位卡（D-99），没开的显示灰态「未同步」。两端书库视图完全一致；进度/批注对所有书生效（SYNC-02/03 不受文件平面限制）。
- **D-103：v1 不同步阅读设置**——字体/主题/CJK 开关各设备独立（手机夜间 vs 桌面日间场景不同）。状态平面只含：书目目录、进度、批注、文件同步标志位。
- **D-104：远端默认 `pillowtome/`、路径可改**——默认在服务器根下建 `pillowtome/`（内含 `books/`、`state/`、`devices/` 子结构），设置里可改成任意路径（如坚果云已有文件夹）。**多设备必须指向同一路径**，设置页明示此约束。
- **D-105：远端文件人类可读命名**——`books/` 下用「作者 - 书名.格式」命名（重名追加短哈希）；`state/` 下 change log 按 `device_id` 命名。用户在网盘里能认出自己的书并可手动管理；书名明文上传在自托管场景下可接受（不做哈希乱码命名）。

### Claude's Discretion
- **分块阈值具体值**（约 10MB 起）与续传状态持久化格式——research 对真实 Nextcloud/坚果云验证后定。
- **change log 传输格式细节**（JSONL vs 单 JSON 数组、压缩与否、单文件 rotate 策略）——依 ARCHITECTURE.md per-device append-only 模型定。
- **keyring 具体实现**（`keyring` crate vs tauri-plugin-stronghold 等）——须双端可用 + 精确钉版本，research 定。
- **device_id 生成与用户可见设备名**——sync_meta 已有 device 行；是否在设置页显示可编辑设备名由 planner 定。
- **冲突展示的颗粒度**——D-92 的撤回弹窗内文案与布局细节（沿用 P2 UI-SPEC 纸感/朱砂语言）。
- **远端结构版本号**（远端 `pillowtome/` 内是否带 format version 以便未来迁移）。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 阶段范围与需求
- `.planning/ROADMAP.md` — Phase 7 目标 / 5 条成功标准 / 07-01..07-04 计划草图（连接+keychain+TLS → 状态平面 → 文件平面 → 冲突+调度）
- `.planning/REQUIREMENTS.md` — SYNC-01..05（v1）；SYNC-06 kosync 属 v2
- `.planning/PROJECT.md` — local-first、自托管优先、简体中文 UX charter

### 架构与坑（同步设计根基）
- `.planning/research/ARCHITECTURE.md` — **Pattern 3（Two-plane WebDAV Sync + Client-side Merge）**、per-device append-only change log、sync 单向依赖规则（sync 依赖数据模型，数据模型绝不依赖 sync）
- `.planning/research/STACK.md` — `reqwest_dav` 0.2.1 选型依据、Rust core 单实现双端共享、sqlx 直接用于重同步逻辑
- `.planning/research/PITFALLS.md` — **Pitfall 7**（LWW blob 丢数据 → 必须 merge 模型）、**Pitfall 8**（Nextcloud chunked v2 语义 / ETag-If-Match / 代理体上限 / 423/504 / 百分号编码 / 限流）、Pitfall（电池：长会话低交互，同步勿轮询）

### 前序阶段锁定
- `.planning/phases/01-foundation-cross-platform-skeleton/01-CONTEXT.md` — D-01..D-13（change-log 脊柱、pillow:// 书字节不过 IPC、supply-chain 精确钉版本）
- `.planning/phases/02-epub-reading-core/02-CONTEXT.md` — D-20..D-26（locator 进度表、work_id = blake3 content_hash、软失败中文）
- `.planning/phases/02-epub-reading-core/02-UI-SPEC.md` — 纸感/朱砂视觉语言（同步设置页、状态点沿用）
- `.planning/phases/03-cjk-typography-differentiation/03-CONTEXT.md` — D-30 产品文案简体中文
- `.planning/phases/04-local-library/04-CONTEXT.md` — D-50..D-65（书库目录、register-by-reference、content_hash dedup）
- `.planning/phases/05-annotations-composite-locator/05-CONTEXT.md` — D-70..D-82（tombstone 软删、change_log 追加账本、复合自愈 locator）

### 实现触点（code）
- `src-tauri/src/migrations.rs` — SCHEMA_V1（change_log）..V7（annotation + sync_meta device 行）；同步相关新表只能 append-only 追加更高版本
- `src/reader/annotation-store.ts` — change_log 写入路径、monotonic clock 计算、tombstone；**头注释 hash_algo 双算法警告（同步必读）**
- `src/reader/locator-store.ts` — 进度行 upsert 路径（text_pre/exact/post + progress_fraction）
- `src/library/import-pipeline.ts` — 对端下载后重解析复用点（D-100）
- `src/library/library-store.ts` — 书目目录模型（占位卡/灰态扩展点，D-99/D-102）
- `src-tauri/Cargo.toml` — 尚无 `reqwest_dav` / keyring 依赖；新增依赖须精确钉版本 + 提交 Cargo.lock（D-13）

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **change_log（schema V1）+ sync_meta（V7）**：同步账本已存在——本阶段是「把本地账本序列化上 WebDAV + 拉回对端账本合并入库」，不是新建账本
- **annotation 行 tombstone/revision/content_hash**：软删与修订已就绪，合并去重直接可用
- **import-pipeline.ts**：对端文件落地后的元数据/封面重解析管线已存在（D-100 复用）
- **library-store.ts / LibraryCard**：书库网格与卡片已有——占位卡/灰态是扩展而非新组件族
- **migrations.rs append-only 模式**：同步需要的新表（如远端状态跟踪）沿用同一迁移模式

### Established Patterns
- 软失败 + 简体中文用户文案；小结构走 SQL、书字节走 pillow:// 不过 IPC（同步引擎在 Rust core 读文件天然兼容 D-06）
- 精确钉版本 + 提交 lockfile 的 supply-chain 基线（新增 reqwest_dav/keyring 时遵守）
- 前端经 tauri-plugin-sql 持 SQL；**重同步/合并逻辑应下沉 Rust core（sqlx）**（STACK.md 已定）——注意单 SQLite binding 约束（Pitfall 6：不要引入第二个 SQLite 连接源）

### Integration Points
- **Rust core `core/` + `src-tauri/`**：sync 引擎模块（webdav 传输、对账、合并、调度）落点；ARCHITECTURE.md 预留 `sync/` 模块结构
- **设置页**：同步配置区（服务器/凭据/TLS 开关/路径/测试连接/状态详情）
- **书库页**：手动同步按钮 + 状态点、占位卡点击下载、按书「同步此书」开关
- **阅读生命周期钩子**：开书（拉取对账）/ 合书切后台（推送）挂接点

</code_context>

<specifics>
## Specific Ideas

- **用户明确的 UX 细化**：对端进度更远的处理 = 「静默跳 + 留痕迹 + **点击提示弹窗可撤回**」——撤回能力是这个交互的核心，不是可选项（D-92）。
- **坚果云 Nutstore 是一等公民**：中文读者/KOReader 圈事实标准，限流与怪癖处理必须进验证矩阵，不能「理论上兼容」（D-94）。
- **自托管现实场景**：家用 NAS / 树莓派 / docker 跑 rclone/dufs 常见 http 或自签名——默认严格但给用户显式放行路径（D-95）。

</specifics>

<deferred>
## Deferred Ideas

- **Android 后台定时同步（WorkManager）**——本阶段明确否决；若用户反馈「关着 app 也想同步」再立 v2 项。
- **阅读设置同步**——v1 各端独立（D-103）；v2 若做多端一致体验可重议（LWW per key 模型 ARCHITECTURE.md 已预留）。
- **KOReader kosync 协议互通**——已是 REQUIREMENTS v2 项（SYNC-06），本阶段不做但 per-device log 模型与之兼容。
- **端到端加密（E2EE）同步**——v1 基线 = keychain + TLS；加密同步是独立 phase 的事。
- **同步冲突的可视化管理界面**（如并列展示两端版本手动选）——v1 全部自动合并不丢数据；可视化只到 D-92 的进度撤回弹窗。

</deferred>

---

*Phase: 7-webdav-self-hosted-sync*
*Context gathered: 2026-07-18*
